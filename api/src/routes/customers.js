import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import { customers, orders } from '../db/schema.js';
import { uid, bad, notFound, forbidden, audit } from '../util.js';
import { cleanStr, checkMoney, LIMITS } from '../security.js';
import { scopedBranchId } from '../branchAccess.js';

export const customerRoutes = new Hono();

export const normalizePhone = (p) => (p || '').replace(/[\s\-()]/g, '');

// List with the stats the Customers screen shows: order count, lifetime value
// (closed orders), last order date.
customerRoutes.get('/customers', async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const q = (c.req.query('q') || '').toLowerCase();
  const branchId = scopedBranchId(c, c.req.query('branch_id') || null);
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      notes: customers.notes,
      creditEnabled: customers.creditEnabled,
      creditLimitCents: customers.creditLimitCents,
      creditTermsDays: customers.creditTermsDays,
      createdAt: customers.createdAt,
      orderCount: sql`count(${orders.id})`.as('order_count'),
      lifetimeValueCents: sql`coalesce(sum(case when ${orders.status} = 'delivered' then ${orders.totalCents} else 0 end), 0)`.as('ltv'),
      lastOrderAt: sql`max(${orders.createdAt})`.as('last_order_at'),
    })
    .from(customers)
    .leftJoin(orders, and(eq(orders.customerId, customers.id), sql`${orders.status} != 'void'`,
      ...(branchId ? [eq(orders.branchId, branchId)] : [])))
    .where(and(eq(customers.tenantId, tenantId), ...(branchId ? [sql`${orders.id} is not null`] : [])))
    .groupBy(customers.id)
    .orderBy(desc(sql`last_order_at`));
  const filtered = q
    ? rows.filter((r) => r.name.toLowerCase().includes(q) || normalizePhone(r.phone).includes(normalizePhone(q)))
    : rows;
  // standard opt-in pagination ({ rows, total, limit, offset }); the q filter
  // needs JS phone normalization, so the page is sliced after filtering
  if (c.req.query('offset') != null) {
    const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100);
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);
    return c.json({ rows: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset });
  }
  return c.json(filtered);
});

customerRoutes.post('/customers', async (c) => {
  const b = await c.req.json();
  b.name = cleanStr(b.name, LIMITS.name, 'Name');
  b.phone = cleanStr(b.phone, LIMITS.phone, 'Phone');
  b.notes = cleanStr(b.notes, LIMITS.note, 'Notes');
  if (!b.name) bad('Customer name is required');
  if (!b.phone) bad('Phone number is required — it is the customer ID');
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const phone = normalizePhone(b.phone);
  const [dup] = await db.select().from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, phone)));
  if (dup) bad(`A customer with this phone already exists: ${dup.name}`);
  const row = { id: uid(), tenantId, name: b.name.trim(), phone, notes: b.notes || null };
  await db.insert(customers).values(row);
  return c.json(row, 201);
});

customerRoutes.get('/customers/:id', async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const branchId = scopedBranchId(c, c.req.query('branch_id') || null);
  const [cust] = await db.select().from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, c.req.param('id'))));
  if (!cust) notFound('Customer not found');
  const orderRows = await db.select().from(orders)
    .where(and(eq(orders.customerId, cust.id), ...(branchId ? [eq(orders.branchId, branchId)] : []))).orderBy(desc(orders.createdAt));
  if (branchId && !orderRows.length) notFound('Customer not found');
  return c.json({ ...cust, orders: orderRows });
});

customerRoutes.patch('/customers/:id', async (c) => {
  const b = await c.req.json();
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const branchId = scopedBranchId(c);
  const [cust] = await db.select().from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, c.req.param('id'))));
  if (!cust) notFound('Customer not found');
  if (branchId) {
    const [visible] = await db.select({ id: orders.id }).from(orders)
      .where(and(eq(orders.customerId, cust.id), eq(orders.branchId, branchId))).limit(1);
    if (!visible) notFound('Customer not found');
  }
  const patch = {
    name: b.name?.trim() || cust.name,
    phone: b.phone ? normalizePhone(b.phone) : cust.phone,
    notes: b.notes !== undefined ? b.notes : cust.notes,
  };
  if (b.credit_enabled !== undefined || b.credit_limit_cents !== undefined || b.credit_terms_days !== undefined) {
    if (!c.get('policies').has('finance.manage')) forbidden('You do not have permission to manage customer credit');
    const limit = Math.round(b.credit_limit_cents ?? cust.creditLimitCents);
    checkMoney(limit, 'Credit limit');
    const terms = Math.round(b.credit_terms_days ?? cust.creditTermsDays);
    if (terms < 1 || terms > 365) bad('Credit terms must be between 1 and 365 days');
    patch.creditEnabled = b.credit_enabled ? 1 : 0;
    patch.creditLimitCents = limit;
    patch.creditTermsDays = terms;
    await audit(db, tenantId, c.get('user').id, 'customer.credit_update', 'customers', cust.id, {
      before: { enabled: !!cust.creditEnabled, limit_cents: cust.creditLimitCents, terms_days: cust.creditTermsDays },
      after: { enabled: !!patch.creditEnabled, limit_cents: limit, terms_days: terms },
    });
  }
  await db.update(customers).set(patch).where(eq(customers.id, cust.id));
  return c.json({ ok: true });
});

// Find-or-create at intake (phone is the natural ID in this market).
export async function resolveCustomer(db, tenantId, body) {
  if (body.customer_id) {
    const [cust] = await db.select().from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, body.customer_id)));
    if (!cust) bad('Unknown customer');
    return cust;
  }
  const info = body.customer || {};
  if (!info.name?.trim() || !info.phone?.trim()) bad('New orders need a customer (name + phone) or customer_id');
  const phone = normalizePhone(info.phone);
  const [existing] = await db.select().from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, phone)));
  if (existing) return existing;
  const row = { id: uid(), tenantId, name: info.name.trim(), phone, notes: null };
  await db.insert(customers).values(row);
  return row;
}
