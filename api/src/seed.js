// Tenant onboarding: seed role templates, a typical Kenyan laundry template
// catalog (the activation key — spec §3), and default expense categories.
import { uid } from './util.js';
import { ROLE_TEMPLATES } from './policies.js';
import {
  roles, rolePolicies, serviceCategories, services, serviceVariants,
  pricingTiers, addonRules, expenseCategories,
} from './db/schema.js';

export const EXPENSE_CATEGORIES = [
  'Detergents & supplies', 'Water', 'Electricity', 'Rent',
  'Salaries & wages', 'Delivery/fuel', 'Equipment & repairs', 'Other',
];

export async function seedTenant(db, tenantId) {
  // --- roles + policies ---
  const roleIds = {};
  const roleRows = [];
  const policyRows = [];
  for (const [name, keys] of Object.entries(ROLE_TEMPLATES)) {
    const rid = uid();
    roleIds[name] = rid;
    roleRows.push({ id: rid, tenantId, name, isSystem: 1 });
    for (const key of keys) policyRows.push({ id: uid(), roleId: rid, policyKey: key, allow: 1 });
  }
  await db.insert(roles).values(roleRows);
  await db.insert(rolePolicies).values(policyRows);

  // --- expense categories ---
  await db.insert(expenseCategories).values(
    EXPENSE_CATEGORIES.map((name) => ({ id: uid(), tenantId, name, isDefault: 1 }))
  );

  // --- template catalog ---
  const catIds = {};
  const cats = ['Washing', 'Ironing', 'Dry Cleaning', 'Special Items', 'Household'];
  await db.insert(serviceCategories).values(
    cats.map((name, i) => {
      const cid = uid();
      catIds[name] = cid;
      return { id: cid, tenantId, name, sortOrder: i };
    })
  );

  const svc = (categoryName, name, pricingModel, rateKes, opts = {}) => ({
    id: uid(),
    tenantId,
    categoryId: catIds[categoryName],
    name,
    pricingModel,
    baseRateCents: rateKes * 100,
    minChargeCents: (opts.min || 0) * 100,
    expressPct: opts.expressPct ?? 50,
    unit: opts.unit || (pricingModel === 'PER_KG' ? 'kg' : pricingModel === 'FLAT' ? 'flat' : 'item'),
    active: 1,
  });

  const washKg = svc('Washing', 'Wash & Fold (per kg)', 'PER_KG', 150, { min: 500 });
  const iron = svc('Ironing', 'Ironing', 'PER_KG', 70);
  const stain = svc('Washing', 'Stain Treatment', 'PER_ITEM', 100);
  const duvet = svc('Household', 'Duvet Wash', 'PER_ITEM', 800);
  const suit = svc('Dry Cleaning', 'Suit Dry Clean', 'PER_ITEM', 500);
  const bag = svc('Washing', 'Bag Wash (any weight)', 'FLAT', 1200);
  const bedding = svc('Household', 'Bedding Bundle', 'TIERED', 800, { unit: 'kg' });
  await db.insert(services).values([washKg, iron, stain, duvet, suit, bag, bedding]);

  await db.insert(serviceVariants).values([
    { id: uid(), serviceId: duvet.id, attribute: 'size', label: 'Single', priceCents: 60000, sortOrder: 0 },
    { id: uid(), serviceId: duvet.id, attribute: 'size', label: 'Double', priceCents: 80000, sortOrder: 1 },
    { id: uid(), serviceId: duvet.id, attribute: 'size', label: 'King', priceCents: 100000, sortOrder: 2 },
  ]);

  await db.insert(pricingTiers).values([
    // Wash & Fold volume break: 10+ kg drops to 130/kg
    { id: uid(), serviceId: washKg.id, minQty: 10, maxQty: null, rateCents: 13000, bandPriceCents: null },
    // Bedding Bundle bands: 1–5 kg 800 flat, 6–10 kg 1,400 flat, 10+ kg 2,200 flat
    { id: uid(), serviceId: bedding.id, minQty: 0, maxQty: 5, rateCents: null, bandPriceCents: 80000 },
    { id: uid(), serviceId: bedding.id, minQty: 5.01, maxQty: 10, rateCents: null, bandPriceCents: 140000 },
    { id: uid(), serviceId: bedding.id, minQty: 10.01, maxQty: null, rateCents: null, bandPriceCents: 220000 },
  ]);

  await db.insert(addonRules).values([
    // Ironing rides on a wash line at a bundled 50/kg (standalone 70/kg), inherits kg
    { id: uid(), tenantId, parentServiceId: washKg.id, addonServiceId: iron.id, overrideRateCents: 5000, inheritQty: 1 },
    { id: uid(), tenantId, parentServiceId: washKg.id, addonServiceId: stain.id, overrideRateCents: null, inheritQty: 0 },
    { id: uid(), tenantId, parentServiceId: duvet.id, addonServiceId: stain.id, overrideRateCents: null, inheritQty: 1 },
  ]);

  return { roleIds };
}
