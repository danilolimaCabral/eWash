import { Hono } from 'hono';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import {
  orders, orderItems, orderItemAddons, payments, users, customers,
  services, serviceCategories, notifications, auditLog,
} from '../db/schema.js';
import { requirePolicy } from '../middleware.js';
import { today, monthOf, forbidden } from '../util.js';
import { validMonth, validDate } from '../security.js';
import { isTenantWide, scopedBranchId } from '../branchAccess.js';

export const reportRoutes = new Hono();

// Dashboard is split into per-component endpoints so each panel loads (and
// shows its skeleton) independently. Each endpoint is a single D1 round trip.

reportRoutes.get('/dashboard/kpis', async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const d = today();
  const branchId = scopedBranchId(c, c.req.query('branch_id') || null);

  const [[todayStats], [paidToday], [counts]] = await db.batch([
    db.select({
      orders: sql`count(*)`,
      revenue: sql`coalesce(sum(${orders.totalCents}), 0)`,
    }).from(orders).where(and(
      eq(orders.tenantId, tenantId),
      sql`substr(${orders.createdAt}, 1, 10) = ${d}`,
      sql`${orders.status} != 'void'`,
      ...(branchId ? [eq(orders.branchId, branchId)] : []),
    )),
    db.select({
      collected: sql`coalesce(sum(${payments.amountCents}), 0)`,
    }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).where(and(
      eq(payments.tenantId, tenantId),
      eq(payments.status, 'completed'),
      sql`substr(${payments.at}, 1, 10) = ${d}`,
      ...(branchId ? [eq(orders.branchId, branchId)] : []),
    )),
    db.select({
      inProgress: sql`coalesce(sum(case when ${orders.status} in ('received','washing','ironing') then 1 else 0 end), 0)`,
      ready: sql`coalesce(sum(case when ${orders.status} = 'ready' then 1 else 0 end), 0)`,
      readyOverdue: sql`coalesce(sum(case when ${orders.status} = 'ready' and ${orders.createdAt} < datetime('now', '-2 days') then 1 else 0 end), 0)`,
      dueSoon: sql`coalesce(sum(case when ${orders.status} in ('received','washing','ironing') and ${orders.dueAt} is not null and ${orders.dueAt} < datetime('now', '+3 hours') then 1 else 0 end), 0)`,
      unpaidReady: sql`coalesce(sum(case when ${orders.status} = 'ready' and ${orders.paymentStatus} != 'paid' then 1 else 0 end), 0)`,
    }).from(orders).where(and(eq(orders.tenantId, tenantId), ...(branchId ? [eq(orders.branchId, branchId)] : []))),
  ]);

  return c.json({
    todayOrders: todayStats.orders,
    todayRevenueCents: todayStats.revenue,
    todayCollectedCents: paidToday.collected,
    inProgress: counts.inProgress,
    ready: counts.ready,
    readyOverdue: counts.readyOverdue,
    dueSoon: counts.dueSoon,
    unpaidReady: counts.unpaidReady,
  });
});

reportRoutes.get('/dashboard/active-orders', async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const branchId = scopedBranchId(c, c.req.query('branch_id') || null);
  const active = await db.select({
    id: orders.id, code: orders.code, status: orders.status,
    paymentStatus: orders.paymentStatus, totalCents: orders.totalCents,
    dueAt: orders.dueAt, createdAt: orders.createdAt, express: orders.express,
    customerName: customers.name, customerPhone: customers.phone,
    itemCount: sql`(select count(*) from order_items oi where oi.order_id = ${orders.id})`.as('item_count'),
    itemSummary: sql`(select group_concat(oi.service_name, ', ') from order_items oi where oi.order_id = ${orders.id})`.as('item_summary'),
    kgTotal: sql`(select coalesce(sum(oi.qty), 0) from order_items oi where oi.order_id = ${orders.id} and oi.unit = 'kg')`.as('kg_total'),
  }).from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(and(eq(orders.tenantId, tenantId), inArray(orders.status, ['received', 'washing', 'ironing', 'ready']),
      ...(branchId ? [eq(orders.branchId, branchId)] : [])))
    .orderBy(desc(orders.createdAt))
    .limit(12);
  return c.json(active);
});

reportRoutes.get('/dashboard/notifications', async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const branchId = scopedBranchId(c, c.req.query('branch_id') || null);
  const rows = await db.select({ notification: notifications }).from(notifications)
    .leftJoin(orders, eq(orders.id, notifications.orderId))
    .where(and(eq(notifications.tenantId, tenantId), ...(branchId ? [eq(orders.branchId, branchId)] : [])))
    .orderBy(desc(notifications.sentAt)).limit(6);
  return c.json(rows.map((row) => row.notification));
});

// Daily register (spec §8): per attendant — orders taken, cash vs M-Pesa
// collected. Reconciles the till at close of day.
reportRoutes.get('/reports/daily-register', requirePolicy('finance.view'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const d = validDate(c.req.query('date'), today());
  const branchId = scopedBranchId(c, c.req.query('branch_id') || null);

  const byAttendant = await db.select({
    attendantId: users.id,
    attendant: users.name,
    cash: sql`coalesce(sum(case when ${payments.method} = 'cash' then ${payments.amountCents} else 0 end), 0)`,
    mpesa: sql`coalesce(sum(case when ${payments.method} != 'cash' then ${payments.amountCents} else 0 end), 0)`,
    payments: sql`count(*)`,
  }).from(payments)
    .innerJoin(users, eq(users.id, payments.receivedBy))
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(and(
      eq(payments.tenantId, tenantId),
      eq(payments.status, 'completed'),
      sql`substr(${payments.at}, 1, 10) = ${d}`,
      ...(branchId ? [eq(orders.branchId, branchId)] : []),
    ))
    .groupBy(users.id);

  const orderCounts = await db.select({
    attendantId: orders.createdBy,
    orders: sql`count(*)`,
  }).from(orders)
    .where(and(
      eq(orders.tenantId, tenantId),
      sql`substr(${orders.createdAt}, 1, 10) = ${d}`,
      sql`${orders.status} != 'void'`,
      ...(branchId ? [eq(orders.branchId, branchId)] : []),
    ))
    .groupBy(orders.createdBy);
  const countMap = new Map(orderCounts.map((o) => [o.attendantId, o.orders]));
  const seen = new Set(byAttendant.map((r) => r.attendantId));
  const rows = byAttendant.map((r) => ({ ...r, orders: countMap.get(r.attendantId) || 0 }));
  for (const [attendantId, n] of countMap) {
    if (!seen.has(attendantId)) {
      const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, attendantId));
      rows.push({ attendantId, attendant: u?.name || '?', cash: 0, mpesa: 0, payments: 0, orders: n });
    }
  }
  return c.json({ date: d, rows });
});

// Revenue mix + operational KPIs for the Reports screen.
reportRoutes.get('/reports/summary', requirePolicy('finance.view'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const month = validMonth(c.req.query('month'), monthOf());
  const branchId = scopedBranchId(c, c.req.query('branch_id') || null);

  const closedThisMonth = and(
    eq(orders.tenantId, tenantId),
    eq(orders.status, 'delivered'),
    sql`substr(${orders.closedAt}, 1, 7) = ${month}`,
    ...(branchId ? [eq(orders.branchId, branchId)] : []),
  );

  // one D1 round trip for the whole summary
  const [[rev], lineRevenue, addonRevenue, [attach], [monthOrders], [discountAudit], [turnaround]] = await db.batch([
    db.select({
      total: sql`coalesce(sum(${orders.totalCents}), 0)`,
      count: sql`count(*)`,
      discounts: sql`coalesce(sum(${orders.discountCents}), 0)`,
    }).from(orders).where(closedThisMonth),
    db.select({
      category: serviceCategories.name,
      revenue: sql`coalesce(sum(${orderItems.lineTotalCents}), 0)`.as('revenue'),
    }).from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(services, eq(services.id, orderItems.serviceId))
      .innerJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
      .where(closedThisMonth)
      .groupBy(serviceCategories.name),
    // rider revenue counts toward the rider service's own category
    db.select({
      category: serviceCategories.name,
      revenue: sql`coalesce(sum(${orderItemAddons.totalCents}), 0)`.as('revenue'),
    }).from(orderItemAddons)
      .innerJoin(orderItems, eq(orderItems.id, orderItemAddons.orderItemId))
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(services, eq(services.id, orderItemAddons.addonServiceId))
      .innerJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
      .where(closedThisMonth)
      .groupBy(serviceCategories.name),
    db.select({
      ordersWithAddons: sql`count(distinct ${orders.id})`,
    }).from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .innerJoin(orderItemAddons, eq(orderItemAddons.orderItemId, orderItems.id))
      .where(and(
        eq(orders.tenantId, tenantId),
        sql`${orders.status} != 'void'`,
        sql`substr(${orders.createdAt}, 1, 7) = ${month}`,
        ...(branchId ? [eq(orders.branchId, branchId)] : []),
      )),
    db.select({ count: sql`count(*)` }).from(orders)
      .where(and(
        eq(orders.tenantId, tenantId),
        sql`${orders.status} != 'void'`,
        sql`substr(${orders.createdAt}, 1, 7) = ${month}`,
        ...(branchId ? [eq(orders.branchId, branchId)] : []),
      )),
    db.select({
      entries: sql`count(*)`,
      staff: sql`count(distinct ${auditLog.userId})`,
    }).from(auditLog)
      .innerJoin(orders, eq(orders.id, auditLog.entityId))
      .where(and(
      eq(auditLog.tenantId, tenantId),
      eq(auditLog.action, 'order.discount'),
      sql`substr(${auditLog.at}, 1, 7) = ${month}`,
      ...(branchId ? [eq(orders.branchId, branchId)] : []),
    )),
    db.select({
      avgHours: sql`coalesce(avg((julianday(${orders.closedAt}) - julianday(${orders.createdAt})) * 24), 0)`,
    }).from(orders).where(closedThisMonth),
  ]);

  const catTotals = new Map();
  for (const r of [...lineRevenue, ...addonRevenue]) {
    catTotals.set(r.category, (catTotals.get(r.category) || 0) + r.revenue);
  }
  const byCategory = [...catTotals.entries()]
    .map(([category, revenue]) => ({ category, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  return c.json({
    month,
    revenueCents: rev.total,
    closedOrders: rev.count,
    discountsCents: rev.discounts,
    byCategory: byCategory.map((r) => ({ category: r.category, revenueCents: r.revenue })),
    addonAttachRatePct: monthOrders.count ? Math.round((attach.ordersWithAddons / monthOrders.count) * 100) : 0,
    discountAuditEntries: discountAudit.entries,
    discountAuditStaff: discountAudit.staff,
    avgTurnaroundHours: Math.round(turnaround.avgHours * 10) / 10,
  });
});

reportRoutes.get('/notifications', async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const orderId = c.req.query('order_id');
  const branchId = scopedBranchId(c, c.req.query('branch_id') || null);
  const conds = [eq(notifications.tenantId, tenantId)];
  if (orderId) conds.push(eq(notifications.orderId, orderId));
  const rows = await db.select({ notification: notifications }).from(notifications)
    .leftJoin(orders, eq(orders.id, notifications.orderId))
    .where(and(...conds, ...(branchId ? [eq(orders.branchId, branchId)] : [])))
    .orderBy(desc(notifications.sentAt)).limit(100);
  return c.json(rows.map((row) => row.notification));
});

reportRoutes.get('/audit-log', requirePolicy('finance.view'), async (c) => {
  if (!isTenantWide(c)) forbidden('Tenant-wide access is required to view the audit log');
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const rows = await db.select({
    id: auditLog.id, action: auditLog.action, entity: auditLog.entity,
    entityId: auditLog.entityId, payload: auditLog.payload, at: auditLog.at,
    userName: users.name,
  }).from(auditLog)
    .innerJoin(users, eq(users.id, auditLog.userId))
    .where(eq(auditLog.tenantId, tenantId))
    .orderBy(desc(auditLog.at))
    .limit(200);
  return c.json(rows.map((r) => ({ ...r, payload: r.payload ? JSON.parse(r.payload) : null })));
});
