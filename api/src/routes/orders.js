import { Hono } from 'hono';
import { eq, and, desc, inArray, like, or, sql } from 'drizzle-orm';
import {
  tenants, branches, customers, orders, orderItems, orderItemAddons,
  itemTags, orderStatusHistory, payments,
} from '../db/schema.js';
import { requirePolicy } from '../middleware.js';
import { uid, now, bad, notFound, forbidden, audit, fmtMoney } from '../util.js';
import { priceOrder } from '../pricing.js';
import { loadCatalog, catalogMaps } from './catalog.js';
import { resolveCustomer } from './customers.js';
import { sendNotification, renderTemplate, describeOrderItems } from '../notify.js';
import { cleanStr, validDate, LIMITS } from '../security.js';
import { assertBranchAccess, scopedBranchId } from '../branchAccess.js';

export const orderRoutes = new Hono();

export const PIPELINE = ['received', 'washing', 'ironing', 'ready', 'delivered'];

// ---------- helpers ----------

async function priceRequest(c, body) {
  const catalog = await loadCatalog(c.get('db'), c.get('tenant').id);
  const { serviceMap, ruleMap } = catalogMaps(catalog);
  return priceOrder(
    {
      items: body.items,
      express: !!body.express,
      discountCents: body.discount_cents || 0,
    },
    serviceMap,
    ruleMap
  );
}

export async function loadOrderDetail(db, tenantId, orderId) {
  // one D1 round trip: everything keys off order_id (addons/tags join through
  // order_items), and the customer joins through the order row
  const [orderRows, items, addons, tags, custRows, history, paymentRows] = await db.batch([
    db.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId))),
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
    db.select({
      id: orderItemAddons.id, orderItemId: orderItemAddons.orderItemId,
      addonServiceId: orderItemAddons.addonServiceId, addonName: orderItemAddons.addonName,
      qty: orderItemAddons.qty, qtyInherited: orderItemAddons.qtyInherited,
      unit: orderItemAddons.unit, unitPriceCents: orderItemAddons.unitPriceCents,
      totalCents: orderItemAddons.totalCents,
    }).from(orderItemAddons)
      .innerJoin(orderItems, eq(orderItems.id, orderItemAddons.orderItemId))
      .where(eq(orderItems.orderId, orderId)),
    db.select({
      id: itemTags.id, orderItemId: itemTags.orderItemId,
      tagCode: itemTags.tagCode, status: itemTags.status,
    }).from(itemTags)
      .innerJoin(orderItems, eq(orderItems.id, itemTags.orderItemId))
      .where(eq(orderItems.orderId, orderId)),
    db.select({
      id: customers.id, tenantId: customers.tenantId, name: customers.name,
      phone: customers.phone, notes: customers.notes, createdAt: customers.createdAt,
      creditEnabled: customers.creditEnabled, creditLimitCents: customers.creditLimitCents,
      creditTermsDays: customers.creditTermsDays,
    }).from(customers)
      .innerJoin(orders, eq(orders.customerId, customers.id))
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId))),
    db.select().from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId)).orderBy(desc(orderStatusHistory.at)),
    db.select().from(payments)
      .where(eq(payments.orderId, orderId)).orderBy(desc(payments.at)),
  ]);
  const order = orderRows[0];
  if (!order) return null;
  const cust = custRows[0];
  const paidCents = paymentRows.filter((p) => p.status === 'completed').reduce((t, p) => t + p.amountCents, 0);
  return {
    ...order,
    customer: cust,
    items: items.map((i) => ({
      ...i,
      addons: addons.filter((a) => a.orderItemId === i.id),
      tags: tags.filter((t) => t.orderItemId === i.id),
    })),
    history,
    payments: paymentRows,
    paidCents,
    balanceCents: Math.max(0, order.totalCents - paidCents),
  };
}

// payment_status is a cached projection of the payments table.
export async function recomputePaymentStatus(db, orderId) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  const rows = await db.select().from(payments).where(eq(payments.orderId, orderId));
  const paid = rows.filter((p) => p.status === 'completed').reduce((t, p) => t + p.amountCents, 0);
  const refunded = rows.filter((p) => p.status === 'refunded').reduce((t, p) => t + p.amountCents, 0);
  let status = 'unpaid';
  if (refunded > 0 && paid === 0) status = 'refunded';
  else if (paid >= order.totalCents && order.totalCents > 0) status = 'paid';
  else if (paid > 0) status = 'partially_paid';
  else if (order.totalCents === 0) status = 'paid'; // zero-priced re-wash
  await db.update(orders).set({ paymentStatus: status }).where(eq(orders.id, orderId));
  return status;
}

// ---------- routes ----------

// Live pricing for the New Order screen — nothing is saved.
orderRoutes.post('/orders/preview', requirePolicy('orders.create'), async (c) => {
  const body = await c.req.json();
  return c.json(await priceRequest(c, body));
});

orderRoutes.post('/orders', requirePolicy('orders.create'), async (c) => {
  const body = await c.req.json();
  const db = c.get('db');
  const tenant = c.get('tenant');
  const user = c.get('user');
  const historical = !!body.historical;
  if (historical && !c.get('policies').has('finance.manage')) forbidden('Historical orders require finance management permission');
  if (historical) {
    if (!body.order_date || !body.fulfilled_date) bad('Historical order and fulfillment dates are required');
    validDate(body.order_date);
    validDate(body.fulfilled_date);
    if (body.payment?.amount_cents > 0) {
      if (!body.payment.date) bad('Historical payment date is required');
      validDate(body.payment.date);
      // validate the whole payment up front — nothing may fail after order
      // rows start being written
      if (body.payment.method !== 'cash' && !cleanStr(body.payment.mpesa_ref, 40, 'M-Pesa code')) {
        bad('M-Pesa code is required');
      }
    }
  }

  const branchId = scopedBranchId(c, body.branch_id || user.branchId);
  const [branch] = await db.select().from(branches)
    .where(and(eq(branches.tenantId, tenant.id), eq(branches.id, branchId), eq(branches.active, 1)));
  if (!branch) bad('Unknown branch');

  if (body.discount_cents > 0 && !c.get('policies').has('orders.discount')) {
    bad('You do not have permission to apply discounts');
  }

  let rewashOf = null;
  if (body.rewash_of_order_id) {
    const [orig] = await db.select().from(orders)
      .where(and(eq(orders.tenantId, tenant.id), eq(orders.id, body.rewash_of_order_id)));
    if (!orig) bad('Original order for re-wash not found');
    rewashOf = orig.id;
  }

  const customer = await resolveCustomer(db, tenant.id, body);
  const priced = await priceRequest(c, body);
  // Zero-priced redo: full discount, linked to the original (spec §10)
  if (rewashOf && body.zero_priced) {
    priced.discountCents = priced.subtotalCents + priced.expressCents;
    priced.totalCents = 0;
  }
  let historicalCreditDueAt = null;
  if (historical && Math.round(body.payment?.amount_cents || 0) < priced.totalCents) {
    if (!customer.creditEnabled) bad('Unpaid historical orders require an approved credit customer');
    const balance = priced.totalCents - Math.round(body.payment?.amount_cents || 0);
    if (balance > customer.creditLimitCents) bad('Historical order exceeds the customer credit limit');
    const due = new Date(`${body.fulfilled_date}T12:00:00Z`);
    due.setUTCDate(due.getUTCDate() + customer.creditTermsDays);
    historicalCreditDueAt = due.toISOString().slice(0, 19).replace('T', ' ');
  }

  // Order tag: the customer's two-name initials + a business-wide incremental
  // number — e.g. Mary Lucy → ML-0001. The counter never resets, so every tag
  // is unique across the tenant regardless of initials.
  const [seqRow] = await db.update(tenants)
    .set({ orderSeq: sql`${tenants.orderSeq} + 1` })
    .where(eq(tenants.id, tenant.id))
    .returning({ seq: tenants.orderSeq });
  const words = customer.name.trim().split(/\s+/);
  const initials = (words.length >= 2
    ? words[0][0] + words[1][0]
    : (words[0] || 'XX').slice(0, 2)
  ).toUpperCase().replace(/[^A-Z]/g, '') || 'XX';
  const code = `${initials}-${String(seqRow.seq).padStart(4, '0')}`;

  const orderId = uid();
  await db.insert(orders).values({
    id: orderId,
    tenantId: tenant.id,
    branchId,
    customerId: customer.id,
    code,
    status: historical ? 'delivered' : 'received',
    express: body.express ? 1 : 0,
    subtotalCents: priced.subtotalCents,
    expressCents: priced.expressCents,
    discountCents: priced.discountCents,
    totalCents: priced.totalCents,
    notes: body.notes || null,
    rewashOfOrderId: rewashOf,
    confirmedAt: historical ? `${body.order_date} 12:00:00` : body.confirm_now ? now() : null,
    closedAt: historical ? `${body.fulfilled_date} 12:00:00` : null,
    collectedAt: historical ? `${body.fulfilled_date} 12:00:00` : null,
    collectedByName: historical ? cleanStr(body.collected_by_name, LIMITS.name, 'Collector name') || customer.name : null,
    handoffType: historical ? (body.handoff_type === 'delivery' ? 'delivery' : 'pickup') : null,
    historical: historical ? 1 : 0,
    creditDueAt: historicalCreditDueAt,
    dueAt: body.due_at || null,
    createdBy: user.id,
    createdAt: historical ? `${body.order_date} 12:00:00` : undefined,
  });

  // snapshot line items, riders, and per-item tags
  let tagSeq = 1;
  for (const line of priced.lines) {
    const itemId = uid();
    await db.insert(orderItems).values({
      id: itemId, orderId,
      serviceId: line.serviceId, variantId: line.variantId,
      serviceName: line.serviceName, variantLabel: line.variantLabel,
      qty: line.qty, unit: line.unit,
      unitPriceCents: line.unitPriceCents, minApplied: line.minApplied,
      lineTotalCents: line.lineTotalCents,
    });
    // tag_code is globally unique (QR scans resolve without tenant context) —
    // order codes repeat across tenants, so add a short random suffix
    await db.insert(itemTags).values({
      id: uid(), orderItemId: itemId,
      tagCode: `${code}-T${tagSeq++}-${uid().slice(0, 4).toUpperCase()}`,
      status: 'attached',
    });
    if (line.addons.length) {
      await db.insert(orderItemAddons).values(line.addons.map((a) => ({
        id: uid(), orderItemId: itemId,
        addonServiceId: a.addonServiceId, addonName: a.addonName,
        qty: a.qty, qtyInherited: a.qtyInherited, unit: a.unit,
        unitPriceCents: a.unitPriceCents, totalCents: a.totalCents,
      })));
    }
  }

  await db.insert(orderStatusHistory).values({
    id: uid(), orderId, fromStatus: null, toStatus: historical ? 'delivered' : 'received', userId: user.id,
  });
  if (historical && body.payment?.amount_cents > 0) {
    const amount = Math.round(body.payment.amount_cents);
    if (amount > priced.totalCents) bad('Historical payment exceeds the order total');
    const method = body.payment.method === 'cash' ? 'cash' : 'mpesa_manual';
    const ref = cleanStr(body.payment.mpesa_ref, 40, 'M-Pesa code');
    if (method === 'mpesa_manual' && !ref) bad('M-Pesa code is required');
    await db.insert(payments).values({
      id: uid(), tenantId: tenant.id, orderId, method, amountCents: amount,
      mpesaRef: ref || null, status: 'completed', receivedBy: user.id,
      at: `${body.payment.date} 12:00:00`,
    });
  }
  await recomputePaymentStatus(db, orderId);

  // quote notification (assessment done → itemized quote, spec §6)
  const message = renderTemplate(tenant, 'quote_ready', {
    customer: customer.name.split(' ')[0],
    order_code: code,
    items: describeOrderItems(priced.lines, tenant.currency),
    total: fmtMoney(priced.totalCents, tenant.currency),
  });
  if (!historical) {
    await sendNotification(db, c.env, {
      tenantId: tenant.id, orderId, templateKey: 'quote_ready', toPhone: customer.phone, message,
    });
  }

  await audit(db, tenant.id, user.id, 'order.create', 'orders', orderId, {
    code, total_cents: priced.totalCents, discount_cents: priced.discountCents, rewash_of: rewashOf,
    historical, order_date: body.order_date || null, fulfilled_date: body.fulfilled_date || null,
  });

  return c.json(await loadOrderDetail(db, tenant.id, orderId), 201);
});

orderRoutes.get('/orders', async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const status = c.req.query('status');
  const q = (c.req.query('q') || '').toLowerCase();
  const limit = Math.min(parseInt(c.req.query('limit') || '200', 10), 500);
  // opt-in server-side pagination: with `offset` the response becomes
  // { rows, total, limit, offset } and q filters in SQL (correct totals);
  // without it the legacy plain-array shape is preserved for existing callers
  const paginated = c.req.query('offset') != null;
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);

  const conds = [eq(orders.tenantId, tenantId)];
  const scoped = scopedBranchId(c);
  if (scoped) conds.push(eq(orders.branchId, scoped));
  if (status === 'open') conds.push(inArray(orders.status, ['received', 'washing', 'ironing', 'ready']));
  else if (status) conds.push(eq(orders.status, status));
  if (paginated && q) {
    conds.push(or(
      like(orders.code, `%${q}%`),
      like(customers.name, `%${q}%`),
      like(customers.phone, `%${q}%`),
    ));
  }

  const rows = await db
    .select({
      id: orders.id, code: orders.code, status: orders.status,
      paymentStatus: orders.paymentStatus, express: orders.express,
      totalCents: orders.totalCents, discountCents: orders.discountCents,
      createdAt: orders.createdAt, confirmedAt: orders.confirmedAt,
      closedAt: orders.closedAt, dueAt: orders.dueAt, branchId: orders.branchId,
      handoffType: orders.handoffType, collectedByName: orders.collectedByName,
      collectedAt: orders.collectedAt,
      rewashOfOrderId: orders.rewashOfOrderId,
      customerName: customers.name, customerPhone: customers.phone,
      itemCount: sql`(select count(*) from order_items oi where oi.order_id = ${orders.id})`.as('item_count'),
      itemSummary: sql`(select group_concat(oi.service_name, ', ') from order_items oi where oi.order_id = ${orders.id})`.as('item_summary'),
      // per-service detail for the pipeline board: "name · qty unit" per line
      // item, '|'-separated (qty rendered without a trailing .0)
      itemsDetail: sql`(select group_concat(oi.service_name || ' · ' || (case when oi.qty = cast(oi.qty as integer) then cast(cast(oi.qty as integer) as text) else cast(oi.qty as text) end) || ' ' || oi.unit, '|') from order_items oi where oi.order_id = ${orders.id})`.as('items_detail'),
      paidCents: sql`coalesce((select sum(p.amount_cents) from payments p where p.order_id = ${orders.id} and p.status = 'completed'), 0)`.as('paid_cents'),
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(and(...conds))
    // delivered = pickup/delivery history → most recently closed first
    .orderBy(status === 'delivered' ? desc(orders.closedAt) : desc(orders.createdAt))
    .limit(limit)
    .offset(paginated ? offset : 0);

  if (paginated) {
    const [{ count }] = await db.select({ count: sql`count(*)` }).from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(and(...conds));
    return c.json({ rows, total: Number(count || 0), limit, offset });
  }

  const filtered = q
    ? rows.filter((r) =>
        r.code.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        (r.customerPhone || '').includes(q))
    : rows;
  return c.json(filtered);
});

orderRoutes.get('/orders/:id', async (c) => {
  const detail = await loadOrderDetail(c.get('db'), c.get('tenant').id, c.req.param('id'));
  if (!detail) notFound('Order not found');
  assertBranchAccess(c, detail.branchId);
  return c.json(detail);
});

// Customer approved the quote — the price snapshot is locked (spec §4.3).
orderRoutes.post('/orders/:id/confirm', requirePolicy('orders.create'), async (c) => {
  const db = c.get('db');
  const tenant = c.get('tenant');
  const detail = await loadOrderDetail(db, tenant.id, c.req.param('id'));
  if (!detail) notFound('Order not found');
  assertBranchAccess(c, detail.branchId);
  if (detail.status === 'void') bad('Order is void');
  if (detail.confirmedAt) return c.json({ ok: true, already: true });
  await db.update(orders).set({ confirmedAt: now() }).where(eq(orders.id, detail.id));
  await audit(db, tenant.id, c.get('user').id, 'order.confirm', 'orders', detail.id, { code: detail.code });
  return c.json({ ok: true });
});

// Move an order down the pipeline. Notifies the customer at "ready";
// closing (delivered) stamps closed_at — the P&L revenue-recognition event.
orderRoutes.post('/orders/:id/advance', requirePolicy('orders.advance'), async (c) => {
  const db = c.get('db');
  const tenant = c.get('tenant');
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const detail = await loadOrderDetail(db, tenant.id, c.req.param('id'));
  if (!detail) notFound('Order not found');
  assertBranchAccess(c, detail.branchId);
  if (detail.status === 'void') bad('Order is void');
  if (detail.status === 'delivered') bad('Order is already closed');

  const idx = PIPELINE.indexOf(detail.status);
  let to = body.to || PIPELINE[idx + 1];
  if (!PIPELINE.includes(to)) bad('Invalid target status');
  const toIdx = PIPELINE.indexOf(to);
  if (toIdx <= idx) bad(`Order is already at or past "${to}"`);

  const patch = { status: to };
  if (to === 'delivered') {
    if (detail.balanceCents > 0) {
      if (!detail.customer.creditEnabled) {
        bad(`Order must be fully paid before collection. Balance due: ${fmtMoney(detail.balanceCents, tenant.currency)}`);
      }
      const [credit] = await db.select({
        // ${orders}.id (qualified) — a bare ${orders.id} renders as `"id"` in
        // this single-table select and would bind to payments.id instead
        outstanding: sql`coalesce(sum(${orders.totalCents} - coalesce((select sum(p.amount_cents) from payments p where p.order_id = ${orders}.id and p.status = 'completed'), 0)), 0)`,
      }).from(orders).where(and(
        eq(orders.tenantId, tenant.id),
        eq(orders.customerId, detail.customer.id),
        eq(orders.status, 'delivered'),
      ));
      if ((credit.outstanding + detail.balanceCents) > detail.customer.creditLimitCents) {
        bad(`Credit limit exceeded. Available credit is ${fmtMoney(Math.max(0, detail.customer.creditLimitCents - credit.outstanding), tenant.currency)}`);
      }
    }
    const handoffType = body.handoff_type;
    if (!['pickup', 'delivery'].includes(handoffType)) {
      bad('Choose whether the order was picked up or taken for delivery');
    }
    const collectedByName = cleanStr(body.collected_by_name, LIMITS.name, 'Collector name');
    if (!collectedByName) bad('Record who collected the order or took it for delivery');
    patch.closedAt = now();
    patch.collectedAt = patch.closedAt;
    patch.handoffType = handoffType;
    patch.collectedByName = collectedByName;
    if (detail.balanceCents > 0) {
      const due = new Date();
      due.setDate(due.getDate() + detail.customer.creditTermsDays);
      patch.creditDueAt = due.toISOString().slice(0, 19).replace('T', ' ');
    }
  }
  await db.update(orders).set(patch).where(eq(orders.id, detail.id));
  await db.insert(orderStatusHistory).values({
    id: uid(), orderId: detail.id, fromStatus: detail.status, toStatus: to, userId: user.id,
  });

  if (to === 'ready') {
    const balanceNote = detail.balanceCents > 0
      ? `Balance due: ${fmtMoney(detail.balanceCents, tenant.currency)}. `
      : '';
    await sendNotification(db, c.env, {
      tenantId: tenant.id, orderId: detail.id, templateKey: 'order_ready',
      toPhone: detail.customer.phone,
      message: renderTemplate(tenant, 'order_ready', {
        customer: detail.customer.name.split(' ')[0],
        order_code: detail.code,
        balance_note: balanceNote,
      }),
    });
  }
  if (to === 'delivered') {
    await sendNotification(db, c.env, {
      tenantId: tenant.id, orderId: detail.id, templateKey: 'order_delivered',
      toPhone: detail.customer.phone,
      message: renderTemplate(tenant, 'order_delivered', {
        customer: detail.customer.name.split(' ')[0],
        order_code: detail.code,
      }),
    });
  }

  await audit(db, tenant.id, user.id, 'order.advance', 'orders', detail.id, {
    code: detail.code, from: detail.status, to,
    ...(to === 'delivered' ? {
      handoff_type: patch.handoffType,
      collected_by_name: patch.collectedByName,
      collected_at: patch.collectedAt,
      credit_due_at: patch.creditDueAt || null,
    } : {}),
  });
  return c.json(await loadOrderDetail(db, tenant.id, detail.id));
});

orderRoutes.post('/orders/:id/void', requirePolicy('orders.void'), async (c) => {
  const db = c.get('db');
  const tenant = c.get('tenant');
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const detail = await loadOrderDetail(db, tenant.id, c.req.param('id'));
  if (!detail) notFound('Order not found');
  assertBranchAccess(c, detail.branchId);
  if (detail.status === 'delivered') bad('Closed orders cannot be voided — issue a refund instead');
  if (detail.status === 'void') bad('Order is already void');
  await db.update(orders).set({ status: 'void' }).where(eq(orders.id, detail.id));
  await db.insert(orderStatusHistory).values({
    id: uid(), orderId: detail.id, fromStatus: detail.status, toStatus: 'void', userId: user.id,
  });
  await audit(db, tenant.id, user.id, 'order.void', 'orders', detail.id, {
    code: detail.code, reason: body.reason || null, total_cents: detail.totalCents,
  });
  return c.json({ ok: true });
});

// Manual discount on an existing (still-open) order. Audit-logged — leakage
// must be measurable (spec §9.1).
orderRoutes.post('/orders/:id/discount', requirePolicy('orders.discount'), async (c) => {
  const db = c.get('db');
  const tenant = c.get('tenant');
  const user = c.get('user');
  const body = await c.req.json();
  const amount = Math.round(body.amount_cents || 0);
  if (!(amount > 0)) bad('Discount amount must be positive');
  const detail = await loadOrderDetail(db, tenant.id, c.req.param('id'));
  if (!detail) notFound('Order not found');
  assertBranchAccess(c, detail.branchId);
  if (['delivered', 'void'].includes(detail.status)) bad('This order can no longer be discounted');
  const newDiscount = detail.discountCents + amount;
  if (newDiscount > detail.subtotalCents + detail.expressCents) bad('Discount cannot exceed the order amount');
  const newTotal = detail.subtotalCents + detail.expressCents - newDiscount;
  await db.update(orders).set({ discountCents: newDiscount, totalCents: newTotal }).where(eq(orders.id, detail.id));
  await recomputePaymentStatus(db, detail.id);
  await audit(db, tenant.id, user.id, 'order.discount', 'orders', detail.id, {
    code: detail.code, amount_cents: amount, reason: body.reason || null,
    before: detail.totalCents, after: newTotal,
  });
  return c.json(await loadOrderDetail(db, tenant.id, detail.id));
});
