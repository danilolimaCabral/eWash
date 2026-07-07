import { Hono } from 'hono';
import { eq, and, inArray, asc } from 'drizzle-orm';
import {
  serviceCategories, services, serviceVariants, pricingTiers, addonRules,
} from '../db/schema.js';
import { requirePolicy } from '../middleware.js';
import { uid, bad, notFound, audit } from '../util.js';
import { cached, cacheDelete, catalogCacheKey } from '../cache.js';

export const catalogRoutes = new Hono();

const CATALOG_CACHE_TTL_SECONDS = 60;

// Load the whole tenant catalog: categories + services with variants, tiers
// and addon rules — the single source for the New Order screen and the
// Service Builder. Memoized per isolate; every catalog write invalidates.
export function loadCatalog(db, tenantId, { includeInactive = false } = {}) {
  return cached(
    `${catalogCacheKey(tenantId)}:${includeInactive ? 'all' : 'active'}`,
    CATALOG_CACHE_TTL_SECONDS,
    () => loadCatalogUncached(db, tenantId, { includeInactive })
  );
}

async function loadCatalogUncached(db, tenantId, { includeInactive = false } = {}) {
  // one D1 round trip: satellites join through services on tenant_id
  const [cats, allSvcRows, variants, tiers, rules] = await db.batch([
    db.select().from(serviceCategories)
      .where(eq(serviceCategories.tenantId, tenantId))
      .orderBy(asc(serviceCategories.sortOrder)),
    db.select().from(services).where(eq(services.tenantId, tenantId)),
    db.select({
      id: serviceVariants.id, serviceId: serviceVariants.serviceId,
      attribute: serviceVariants.attribute, label: serviceVariants.label,
      priceCents: serviceVariants.priceCents, sortOrder: serviceVariants.sortOrder,
    }).from(serviceVariants)
      .innerJoin(services, eq(services.id, serviceVariants.serviceId))
      .where(eq(services.tenantId, tenantId))
      .orderBy(asc(serviceVariants.sortOrder)),
    db.select({
      id: pricingTiers.id, serviceId: pricingTiers.serviceId,
      minQty: pricingTiers.minQty, maxQty: pricingTiers.maxQty,
      rateCents: pricingTiers.rateCents, bandPriceCents: pricingTiers.bandPriceCents,
    }).from(pricingTiers)
      .innerJoin(services, eq(services.id, pricingTiers.serviceId))
      .where(eq(services.tenantId, tenantId))
      .orderBy(asc(pricingTiers.minQty)),
    db.select().from(addonRules).where(eq(addonRules.tenantId, tenantId)),
  ]);
  const svcRows = includeInactive ? allSvcRows : allSvcRows.filter((s) => s.active === 1);
  const ids = svcRows.map((s) => s.id);
  const svcList = svcRows.map((s) => ({
    ...s,
    variants: variants.filter((v) => v.serviceId === s.id),
    tiers: tiers.filter((t) => t.serviceId === s.id),
    // rules where this service is the parent (what can ride on it)
    addonRules: rules.filter((r) => r.parentServiceId === s.id && ids.includes(r.addonServiceId)),
    // rules where this service is the rider (what it can attach to)
    attachableTo: rules.filter((r) => r.addonServiceId === s.id && ids.includes(r.parentServiceId)),
  }));
  return { categories: cats, services: svcList };
}

export function catalogMaps(catalog) {
  const serviceMap = new Map(catalog.services.map((s) => [s.id, s]));
  const ruleMap = new Map();
  for (const s of catalog.services) {
    for (const r of s.addonRules) ruleMap.set(`${r.parentServiceId}:${r.addonServiceId}`, r);
  }
  return { serviceMap, ruleMap };
}

catalogRoutes.get('/catalog', async (c) => {
  const includeInactive = c.req.query('all') === '1';
  return c.json(await loadCatalog(c.get('db'), c.get('tenant').id, { includeInactive }));
});

catalogRoutes.post('/categories', requirePolicy('catalog.edit'), async (c) => {
  const { name } = await c.req.json();
  if (!name?.trim()) bad('Category name is required');
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const row = { id: uid(), tenantId, name: name.trim(), sortOrder: 99 };
  await db.insert(serviceCategories).values(row);
  await audit(db, tenantId, c.get('user').id, 'category.create', 'service_categories', row.id, { name: row.name });
  cacheDelete(catalogCacheKey(tenantId));
  return c.json(row, 201);
});

function validateServicePayload(b) {
  if (!b.name?.trim()) bad('Service name is required');
  if (!['PER_KG', 'PER_ITEM', 'FLAT', 'TIERED'].includes(b.pricing_model)) bad('Invalid pricing model');
  if (!(b.base_rate_cents >= 0)) bad('Base rate must be zero or more');
  const unit = b.unit || (b.pricing_model === 'PER_KG' ? 'kg' : b.pricing_model === 'FLAT' ? 'flat' : 'item');
  if (!['kg', 'item', 'flat'].includes(unit)) bad('Invalid unit');
  return unit;
}

// Replace variant/tier/attachment satellites wholesale — the builder always
// saves the full service definition. Existing orders are untouched (snapshots).
async function writeSatellites(db, tenantId, serviceId, b) {
  await db.delete(serviceVariants).where(eq(serviceVariants.serviceId, serviceId));
  await db.delete(pricingTiers).where(eq(pricingTiers.serviceId, serviceId));
  await db.delete(addonRules).where(and(eq(addonRules.tenantId, tenantId), eq(addonRules.addonServiceId, serviceId)));

  if (b.variants?.length) {
    await db.insert(serviceVariants).values(b.variants.map((v, i) => {
      if (!v.label?.trim() || !(v.price_cents >= 0)) bad('Each variant needs a label and price');
      return { id: uid(), serviceId, attribute: v.attribute || 'size', label: v.label.trim(), priceCents: Math.round(v.price_cents), sortOrder: i };
    }));
  }
  if (b.tiers?.length) {
    await db.insert(pricingTiers).values(b.tiers.map((t) => {
      if (t.min_qty == null) bad('Each tier needs a minimum quantity');
      return {
        id: uid(), serviceId,
        minQty: Number(t.min_qty), maxQty: t.max_qty == null || t.max_qty === '' ? null : Number(t.max_qty),
        rateCents: t.rate_cents == null ? null : Math.round(t.rate_cents),
        bandPriceCents: t.band_price_cents == null ? null : Math.round(t.band_price_cents),
      };
    }));
  }
  if (b.attach_to?.length) {
    const parents = await db.select({ id: services.id }).from(services)
      .where(and(eq(services.tenantId, tenantId), inArray(services.id, b.attach_to.map((a) => a.parent_service_id))));
    const validParents = new Set(parents.map((p) => p.id));
    const rows = b.attach_to
      .filter((a) => validParents.has(a.parent_service_id) && a.parent_service_id !== serviceId)
      .map((a) => ({
        id: uid(), tenantId,
        parentServiceId: a.parent_service_id,
        addonServiceId: serviceId,
        overrideRateCents: a.override_rate_cents == null || a.override_rate_cents === '' ? null : Math.round(a.override_rate_cents),
        inheritQty: a.inherit_qty ? 1 : 0,
      }));
    if (rows.length) await db.insert(addonRules).values(rows);
  }
}

catalogRoutes.post('/services', requirePolicy('catalog.edit'), async (c) => {
  const b = await c.req.json();
  const unit = validateServicePayload(b);
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const [cat] = await db.select().from(serviceCategories)
    .where(and(eq(serviceCategories.tenantId, tenantId), eq(serviceCategories.id, b.category_id)));
  if (!cat) bad('Unknown category');

  const row = {
    id: uid(), tenantId, categoryId: b.category_id, name: b.name.trim(),
    pricingModel: b.pricing_model,
    baseRateCents: Math.round(b.base_rate_cents),
    minChargeCents: Math.round(b.min_charge_cents || 0),
    expressPct: Math.round(b.express_pct ?? 50),
    unit, active: 1,
  };
  await db.insert(services).values(row);
  await writeSatellites(db, tenantId, row.id, b);
  await audit(db, tenantId, c.get('user').id, 'service.create', 'services', row.id, { name: row.name, pricing_model: row.pricingModel });
  cacheDelete(catalogCacheKey(tenantId));
  return c.json({ id: row.id }, 201);
});

catalogRoutes.put('/services/:id', requirePolicy('catalog.edit'), async (c) => {
  const b = await c.req.json();
  const unit = validateServicePayload(b);
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const sid = c.req.param('id');
  const [existing] = await db.select().from(services)
    .where(and(eq(services.tenantId, tenantId), eq(services.id, sid)));
  if (!existing) notFound('Service not found');
  const [cat] = await db.select().from(serviceCategories)
    .where(and(eq(serviceCategories.tenantId, tenantId), eq(serviceCategories.id, b.category_id)));
  if (!cat) bad('Unknown category');

  await db.update(services).set({
    categoryId: b.category_id, name: b.name.trim(), pricingModel: b.pricing_model,
    baseRateCents: Math.round(b.base_rate_cents),
    minChargeCents: Math.round(b.min_charge_cents || 0),
    expressPct: Math.round(b.express_pct ?? 50),
    unit,
    active: b.active === 0 || b.active === false ? 0 : 1,
  }).where(eq(services.id, sid));
  await writeSatellites(db, tenantId, sid, b);
  await audit(db, tenantId, c.get('user').id, 'service.update', 'services', sid, {
    before: { name: existing.name, base_rate_cents: existing.baseRateCents, pricing_model: existing.pricingModel },
    after: { name: b.name, base_rate_cents: b.base_rate_cents, pricing_model: b.pricing_model },
  });
  cacheDelete(catalogCacheKey(tenantId));
  return c.json({ ok: true });
});

// Retire (soft-delete): existing orders keep their snapshots; the service just
// stops being sellable.
catalogRoutes.delete('/services/:id', requirePolicy('catalog.edit'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const sid = c.req.param('id');
  const [existing] = await db.select().from(services)
    .where(and(eq(services.tenantId, tenantId), eq(services.id, sid)));
  if (!existing) notFound('Service not found');
  await db.update(services).set({ active: 0 }).where(eq(services.id, sid));
  await audit(db, tenantId, c.get('user').id, 'service.retire', 'services', sid, { name: existing.name });
  cacheDelete(catalogCacheKey(tenantId));
  return c.json({ ok: true });
});
