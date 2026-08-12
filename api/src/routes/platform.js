import { Hono } from 'hono';
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '../auth.js';
import {
  billingInvoiceItems, billingInvoices, billingPayments, branches, plans, planPrices,
  platformAuditLog, platformUsers, roles, sessions, tenantSubscriptions, tenants, users, orders, payments,
  expenses, expenseCategories,
} from '../db/schema.js';
import { getDb } from '../db/index.js';
import { clientIp, enforceRateLimit } from '../ratelimit.js';
import { cleanStr, LIMITS, validDate, validMonth } from '../security.js';
import {
  issuePlatformSession, PLATFORM_POLICIES, requirePlatformPolicy,
  revokePlatformSession, rotatePlatformSession,
} from '../platform.js';
import { ApiError, audit, bad, notFound, now, uid } from '../util.js';
import { issuePasswordReset } from '../passwordReset.js';

export const platformAuthRoutes = new Hono();
export const platformRoutes = new Hono();

const clampPage = (value, fallback, max) => Math.min(max, Math.max(0, Number.parseInt(value, 10) || fallback));
const cents = (value, field = 'Amount') => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100_000_000_00) bad(`${field} must be valid integer cents`);
  return parsed;
};
const platformAudit = (db, actorId, action, entity, entityId, { tenantId = null, reason = null, payload = null } = {}) =>
  db.insert(platformAuditLog).values({
    id: uid(), platformUserId: actorId, tenantId, action, entity, entityId,
    reason, payload: payload ? JSON.stringify(payload) : null,
  });

async function bootstrapOwner(db, env, email, password) {
  const count = await db.select({ count: sql`count(*)` }).from(platformUsers);
  if (Number(count[0]?.count) > 0) return null;
  const bootstrapEmail = String(env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();
  const bootstrapPassword = String(env.PLATFORM_ADMIN_PASSWORD || '');
  if (!bootstrapEmail || !bootstrapPassword || email !== bootstrapEmail || password !== bootstrapPassword) return null;
  const user = {
    id: uid(), name: env.PLATFORM_ADMIN_NAME || 'Platform Owner', email,
    passwordHash: await hashPassword(password), role: 'platform_owner', status: 'active',
  };
  await db.insert(platformUsers).values(user);
  return user;
}

// Default per-month rates by term — commit longer, pay less per month.
// Pure first-run defaults: every value is editable via PATCH /plans/:id.
const DEFAULT_MONTHLY_CENTS = { starter: 99_00, growth: 199_00, enterprise: 349_00 };
const DEFAULT_TERM_DISCOUNTS = [[1, 0], [3, 0.07], [6, 0.13], [12, 0.20]];

async function ensurePlans(db) {
  const existing = await db.select({ id: plans.id }).from(plans);
  if (!existing.length) {
    await db.insert(plans).values([
      { id: uid(), code: 'starter', name: 'Starter', priceCents: DEFAULT_MONTHLY_CENTS.starter, trialDays: 14 },
      { id: uid(), code: 'growth', name: 'Pro', priceCents: DEFAULT_MONTHLY_CENTS.growth, trialDays: 14 },
      { id: uid(), code: 'enterprise', name: 'Premium', priceCents: DEFAULT_MONTHLY_CENTS.enterprise, trialDays: 14 },
    ]);
  }
  // backfill term prices for any plan that has none (also covers pre-existing DBs)
  const [allPlans, priced] = await Promise.all([
    db.select({ id: plans.id, code: plans.code, priceCents: plans.priceCents }).from(plans),
    db.select({ planId: planPrices.planId }).from(planPrices),
  ]);
  const hasPrices = new Set(priced.map((p) => p.planId));
  const rows = allPlans.filter((p) => !hasPrices.has(p.id)).flatMap((p) => {
    const monthly = p.priceCents || DEFAULT_MONTHLY_CENTS[p.code] || 1500_00;
    return DEFAULT_TERM_DISCOUNTS.map(([term, discount]) => ({
      id: uid(), planId: p.id, termMonths: term,
      priceCents: Math.round(monthly * (1 - discount) * 100), // whole reais
    }));
  });
  if (rows.length) await db.insert(planPrices).values(rows);
}

const addDays = (dateStr, days) =>
  new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + days * 86400_000).toISOString().slice(0, 10);

// 'YYYY-MM-DD' + n calendar months (clamps to month end, e.g. 31 Jan + 1 → 28 Feb)
function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(d, lastDay));
  return date.toISOString().slice(0, 10);
}

platformAuthRoutes.post('/login', async (c) => {
  const body = await c.req.json();
  const email = cleanStr(body.email, LIMITS.email, 'Email')?.toLowerCase();
  const password = body.password;
  if (!email || typeof password !== 'string' || password.length > LIMITS.password) bad('Email and password are required');
  const db = getDb(c.env);
  await enforceRateLimit(db, `platform-login:ip:${clientIp(c)}`, 12, 300, 'Too many login attempts — wait a few minutes');
  let [user] = await db.select().from(platformUsers).where(eq(platformUsers.email, email));
  user ||= await bootstrapOwner(db, c.env, email, password);
  if (!user || user.status !== 'active' || !(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError(401, 'Invalid email or password');
  }
  return c.json(await issuePlatformSession(db, c.env, user, {
    ip: clientIp(c), userAgent: c.req.header('User-Agent'),
  }));
});

platformAuthRoutes.post('/refresh', async (c) => {
  const db = getDb(c.env);
  return c.json(await rotatePlatformSession(db, c.env, (await c.req.json()).refresh_token));
});

platformAuthRoutes.post('/logout', async (c) => {
  const db = getDb(c.env);
  const [sessionId] = String((await c.req.json().catch(() => ({}))).refresh_token || '').split('.');
  await revokePlatformSession(db, sessionId);
  return c.json({ ok: true });
});

platformRoutes.get('/me', (c) => {
  const user = c.get('platformUser');
  return c.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    policies: PLATFORM_POLICIES[user.role] || [],
  });
});

platformRoutes.get('/dashboard', requirePlatformPolicy('platform.dashboard.view'), async (c) => {
  const db = c.get('db');
  const [tenantCounts, invoiceTotals, recent] = await Promise.all([
    db.select({
      total: sql`count(*)`, active: sql`sum(case when ${tenants.status} = 'active' then 1 else 0 end)`,
      suspended: sql`sum(case when ${tenants.status} = 'suspended' then 1 else 0 end)`,
      cancelled: sql`sum(case when ${tenants.status} = 'cancelled' then 1 else 0 end)`,
    }).from(tenants),
    db.select({
      invoicedCents: sql`coalesce(sum(case when ${billingInvoices.status} != 'void' then ${billingInvoices.totalCents} else 0 end), 0)`,
      outstandingCents: sql`coalesce(sum(case when ${billingInvoices.status} in ('issued','partially_paid','overdue') then ${billingInvoices.totalCents} - coalesce((select sum(bp.amount_cents) from billing_payments bp where bp.invoice_id = ${billingInvoices}.id and bp.status = 'completed'), 0) else 0 end), 0)`,
    }).from(billingInvoices),
    db.select({ id: tenants.id, name: tenants.name, plan: tenants.plan, status: tenants.status, createdAt: tenants.createdAt })
      .from(tenants).orderBy(desc(tenants.createdAt)).limit(6),
  ]);
  return c.json({ ...tenantCounts[0], ...invoiceTotals[0], recent });
});

platformRoutes.get('/revenue', requirePlatformPolicy('platform.billing.view'), async (c) => {
  const db = c.get('db');
  const limit = clampPage(c.req.query('limit'), 10, 100);
  const offset = clampPage(c.req.query('offset'), 0, 1_000_000);
  const month = validMonth(c.req.query('month'), null);
  const closedAtMonth = month ? sql`and substr(o.closed_at, 1, 7) = ${month}` : sql``;
  const paidAtMonth = month ? sql`and substr(p.at, 1, 7) = ${month}` : sql``;

  // NB: correlated subqueries must reference the outer table QUALIFIED
  // (`${tenants}.id`, not `${tenants.id}`) — drizzle renders the latter as a
  // bare `"id"` in single-table selects, which SQLite binds to the inner
  // table's own id column and the correlation silently matches nothing.
  const grossExpr = sql`coalesce((select sum(o.total_cents) from orders o where o.tenant_id = ${tenants}.id and o.status = 'delivered' ${closedAtMonth}), 0)`;
  const collectedExpr = sql`coalesce((select sum(p.amount_cents) from payments p where p.tenant_id = ${tenants}.id and p.status = 'completed' ${paidAtMonth}), 0)`;
  const closedExpr = sql`coalesce((select count(*) from orders o where o.tenant_id = ${tenants}.id and o.status = 'delivered' ${closedAtMonth}), 0)`;

  const [rows, total, [summary]] = await Promise.all([
    db.select({
      id: tenants.id,
      name: tenants.name,
      plan: tenants.plan,
      status: tenants.status,
      grossCents: grossExpr,
      collectedCents: collectedExpr,
      closedOrders: closedExpr,
    }).from(tenants)
      .orderBy(desc(grossExpr), desc(tenants.createdAt))
      .limit(limit).offset(offset),
    db.select({ count: sql`count(*)` }).from(tenants),
    db.select({
      grossCents: sql`coalesce(sum(case when ${orders.status} = 'delivered' ${month ? sql`and substr(${orders.closedAt}, 1, 7) = ${month}` : sql``} then ${orders.totalCents} else 0 end), 0)`,
      closedOrders: sql`coalesce(sum(case when ${orders.status} = 'delivered' ${month ? sql`and substr(${orders.closedAt}, 1, 7) = ${month}` : sql``} then 1 else 0 end), 0)`,
      collectedCents: sql`coalesce((select sum(p.amount_cents) from payments p where p.status = 'completed' ${paidAtMonth}), 0)`,
    }).from(orders),
  ]);

  return c.json({
    rows,
    total: Number(total[0]?.count || 0),
    limit,
    offset,
    grossCents: Number(summary?.grossCents || 0),
    collectedCents: Number(summary?.collectedCents || 0),
    closedOrders: Number(summary?.closedOrders || 0),
  });
});

// Accounting: the platform's own billing income — active (receivable), closed
// (paid) and total invoices plus cash actually collected, for one month, one
// specific day, or all time. Drafts have no issued_at and are reported
// separately; void invoices never count as income.
const ACTIVE_INVOICE_STATUSES = ['issued', 'partially_paid', 'overdue'];

platformRoutes.get('/accounting', requirePlatformPolicy('platform.billing.view'), async (c) => {
  const db = c.get('db');
  const limit = clampPage(c.req.query('limit'), 12, 100);
  const offset = clampPage(c.req.query('offset'), 0, 1_000_000);
  const month = validMonth(c.req.query('month'), null);
  const day = c.req.query('day') ? validDate(c.req.query('day'), null) : null;
  if (c.req.query('day') && !day) bad('Invalid day — use YYYY-MM-DD');

  // invoices window on issued_at; income window on payments.paid_at
  const invWindow = month ? sql`substr(${billingInvoices.issuedAt}, 1, 7) = ${month}`
    : day ? sql`substr(${billingInvoices.issuedAt}, 1, 10) = ${day}` : sql`1 = 1`;
  const payWindow = month ? sql`substr(${billingPayments.paidAt}, 1, 7) = ${month}`
    : day ? sql`substr(${billingPayments.paidAt}, 1, 10) = ${day}` : sql`1 = 1`;
  // breakdown buckets: per-day inside a month (or the chosen day), per-month all-time
  const bucketLen = month || day ? 10 : 7;

  const [byStatus, [payments], [activePaid], [drafts], invPeriods, payPeriods] = await Promise.all([
    db.select({
      status: billingInvoices.status,
      n: sql`count(*)`,
      totalCents: sql`coalesce(sum(${billingInvoices.totalCents}), 0)`,
    }).from(billingInvoices)
      .where(and(sql`${billingInvoices.issuedAt} is not null`, invWindow))
      .groupBy(billingInvoices.status),
    db.select({ n: sql`count(*)`, amountCents: sql`coalesce(sum(${billingPayments.amountCents}), 0)` })
      .from(billingPayments).where(and(eq(billingPayments.status, 'completed'), payWindow)),
    db.select({ amountCents: sql`coalesce(sum(${billingPayments.amountCents}), 0)` })
      .from(billingPayments)
      .innerJoin(billingInvoices, eq(billingInvoices.id, billingPayments.invoiceId))
      .where(and(
        eq(billingPayments.status, 'completed'),
        inArray(billingInvoices.status, ACTIVE_INVOICE_STATUSES),
        sql`${billingInvoices.issuedAt} is not null`, invWindow,
      )),
    db.select({ n: sql`count(*)` }).from(billingInvoices).where(eq(billingInvoices.status, 'draft')),
    db.select({
      period: sql`substr(${billingInvoices.issuedAt}, 1, ${bucketLen})`.as('period'),
      invoicedCents: sql`coalesce(sum(case when ${billingInvoices.status} != 'void' then ${billingInvoices.totalCents} else 0 end), 0)`,
      activeCount: sql`sum(case when ${billingInvoices.status} in ('issued','partially_paid','overdue') then 1 else 0 end)`,
      closedCount: sql`sum(case when ${billingInvoices.status} = 'paid' then 1 else 0 end)`,
      totalCount: sql`sum(case when ${billingInvoices.status} != 'void' then 1 else 0 end)`,
    }).from(billingInvoices)
      .where(and(sql`${billingInvoices.issuedAt} is not null`, invWindow))
      .groupBy(sql`period`),
    db.select({
      period: sql`substr(${billingPayments.paidAt}, 1, ${bucketLen})`.as('period'),
      collectedCents: sql`coalesce(sum(${billingPayments.amountCents}), 0)`,
    }).from(billingPayments)
      .where(and(eq(billingPayments.status, 'completed'), payWindow))
      .groupBy(sql`period`),
  ]);

  const stat = (statuses) => byStatus
    .filter((r) => statuses.includes(r.status))
    .reduce((acc, r) => ({ count: acc.count + Number(r.n), invoicedCents: acc.invoicedCents + Number(r.totalCents) }),
      { count: 0, invoicedCents: 0 });
  const active = stat(ACTIVE_INVOICE_STATUSES);
  const activePaidCents = Number(activePaid?.amountCents || 0);

  // union of invoice-activity and payment-activity periods, newest first
  const periods = new Map();
  const periodRow = (p) => periods.get(p) || periods.set(p, {
    period: p, invoicedCents: 0, collectedCents: 0, activeCount: 0, closedCount: 0, totalCount: 0,
  }).get(p);
  for (const r of invPeriods) {
    Object.assign(periodRow(r.period), {
      invoicedCents: Number(r.invoicedCents), activeCount: Number(r.activeCount),
      closedCount: Number(r.closedCount), totalCount: Number(r.totalCount),
    });
  }
  for (const r of payPeriods) periodRow(r.period).collectedCents = Number(r.collectedCents);
  const breakdown = [...periods.values()].sort((a, b) => b.period.localeCompare(a.period));

  return c.json({
    scope: month ? { month } : day ? { day } : { allTime: true },
    collectedCents: Number(payments?.amountCents || 0),
    paymentsCount: Number(payments?.n || 0),
    active: { ...active, paidCents: activePaidCents, outstandingCents: active.invoicedCents - activePaidCents },
    closed: stat(['paid']),
    total: stat([...ACTIVE_INVOICE_STATUSES, 'paid']),
    voidCount: stat(['void']).count,
    draftCount: Number(drafts?.n || 0),
    breakdown: {
      rows: breakdown.slice(offset, offset + limit),
      total: breakdown.length,
      limit,
      offset,
    },
  });
});

platformRoutes.get('/tenants', requirePlatformPolicy('platform.tenants.view'), async (c) => {
  const db = c.get('db');
  const limit = clampPage(c.req.query('limit'), 20, 100);
  const offset = clampPage(c.req.query('offset'), 0, 1_000_000);
  const q = String(c.req.query('q') || '').trim();
  const status = c.req.query('status');
  const conds = [];
  if (q) conds.push(or(like(tenants.name, `%${q}%`), like(tenants.billingEmail, `%${q}%`)));
  if (status) conds.push(eq(tenants.status, status));
  const where = conds.length ? and(...conds) : undefined;
  const [rows, total] = await Promise.all([
    db.select({
      id: tenants.id, name: tenants.name, plan: tenants.plan, status: tenants.status,
      billingEmail: tenants.billingEmail, createdAt: tenants.createdAt,
      branches: sql`(select count(*) from branches b where b.tenant_id = ${tenants}.id)`,
      users: sql`(select count(*) from users u where u.tenant_id = ${tenants}.id)`,
      outstandingCents: sql`coalesce((select sum(i.total_cents - coalesce((select sum(p.amount_cents) from billing_payments p where p.invoice_id = i.id and p.status = 'completed'), 0)) from billing_invoices i where i.tenant_id = ${tenants}.id and i.status in ('issued','partially_paid','overdue')), 0)`,
    }).from(tenants).where(where).orderBy(desc(tenants.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql`count(*)` }).from(tenants).where(where),
  ]);
  return c.json({ rows, total: Number(total[0]?.count || 0), limit, offset });
});

platformRoutes.get('/tenants/:id', requirePlatformPolicy('platform.tenants.view'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const [[tenant], branchRows, ownerRows, subscriptions, invoices] = await Promise.all([
    db.select().from(tenants).where(eq(tenants.id, id)),
    db.select().from(branches).where(eq(branches.tenantId, id)),
    db.select({ id: users.id, name: users.name, email: users.email, status: users.status }).from(users).where(eq(users.tenantId, id)).limit(20),
    db.select({
      id: tenantSubscriptions.id, status: tenantSubscriptions.status, planId: tenantSubscriptions.planId,
      planName: plans.name, termMonths: tenantSubscriptions.termMonths, customPriceCents: tenantSubscriptions.customPriceCents,
      currentPeriodStart: tenantSubscriptions.currentPeriodStart, currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: tenantSubscriptions.cancelAtPeriodEnd,
    }).from(tenantSubscriptions).innerJoin(plans, eq(plans.id, tenantSubscriptions.planId))
      .where(eq(tenantSubscriptions.tenantId, id)).orderBy(desc(tenantSubscriptions.createdAt)),
    db.select().from(billingInvoices).where(eq(billingInvoices.tenantId, id)).orderBy(desc(billingInvoices.createdAt)).limit(20),
  ]);
  if (!tenant) notFound('Tenant not found');
  return c.json({ tenant, branches: branchRows, users: ownerRows, subscriptions, invoices });
});

platformRoutes.get('/tenants/:id/members', requirePlatformPolicy('platform.tenants.view'), async (c) => {
  const db = c.get('db');
  const tenantId = c.req.param('id');
  const limit = clampPage(c.req.query('limit'), 20, 100);
  const offset = clampPage(c.req.query('offset'), 0, 1_000_000);
  const q = String(c.req.query('q') || '').trim();
  const status = c.req.query('status');
  const conds = [eq(users.tenantId, tenantId)];
  if (q) conds.push(or(like(users.name, `%${q}%`), like(users.email, `%${q}%`), like(users.phone, `%${q}%`)));
  if (status) conds.push(eq(users.status, status));
  const where = and(...conds);
  const [[tenant], rows, total, roleRows, branchRows] = await Promise.all([
    db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)),
    db.select({
      id: users.id, name: users.name, email: users.email, phone: users.phone, accessScope: users.accessScope,
      status: users.status, roleId: users.roleId, roleName: roles.name,
      branchId: users.branchId, branchName: branches.name, createdAt: users.createdAt,
    }).from(users).innerJoin(roles, eq(roles.id, users.roleId))
      .leftJoin(branches, eq(branches.id, users.branchId))
      .where(where).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql`count(*)` }).from(users).where(where),
    db.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.tenantId, tenantId)).orderBy(roles.name),
    db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.tenantId, tenantId)).orderBy(branches.name),
  ]);
  if (!tenant) notFound('Tenant not found');
  return c.json({ rows, total: Number(total[0]?.count || 0), limit, offset, roles: roleRows, branches: branchRows });
});

platformRoutes.get('/tenants/:id/branches', requirePlatformPolicy('platform.tenants.view'), async (c) => {
  const db = c.get('db');
  const tenantId = c.req.param('id');
  const limit = clampPage(c.req.query('limit'), 10, 100);
  const offset = clampPage(c.req.query('offset'), 0, 1_000_000);
  const [[tenant], rows, total] = await Promise.all([
    db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)),
    db.select({
      id: branches.id, name: branches.name, location: branches.location, active: branches.active,
      createdAt: branches.createdAt,
      users: sql`(select count(*) from users u where u.branch_id = ${branches}.id and u.status = 'active')`,
      openOrders: sql`(select count(*) from orders o where o.branch_id = ${branches}.id and o.status not in ('delivered','void'))`,
    }).from(branches).where(eq(branches.tenantId, tenantId))
      .orderBy(desc(branches.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql`count(*)` }).from(branches).where(eq(branches.tenantId, tenantId)),
  ]);
  if (!tenant) notFound('Tenant not found');
  return c.json({ rows, total: Number(total[0]?.count || 0), limit, offset });
});

platformRoutes.post('/tenants/:id/branches', requirePlatformPolicy('platform.tenants.manage'), async (c) => {
  const db = c.get('db');
  const actor = c.get('platformUser');
  const tenantId = c.req.param('id');
  const body = await c.req.json();
  const name = cleanStr(body.name, LIMITS.name, 'Branch name');
  if (!name) bad('Branch name is required');
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) notFound('Tenant not found');
  const branch = { id: uid(), tenantId, name, location: cleanStr(body.location, 200, 'Location') || null };
  await db.insert(branches).values(branch);
  await platformAudit(db, actor.id, 'tenant_branch.create', 'branches', branch.id, { tenantId, payload: branch });
  return c.json(branch, 201);
});

platformRoutes.patch('/tenants/:tenantId/branches/:branchId', requirePlatformPolicy('platform.tenants.manage'), async (c) => {
  const db = c.get('db');
  const actor = c.get('platformUser');
  const tenantId = c.req.param('tenantId');
  const [branch] = await db.select().from(branches)
    .where(and(eq(branches.id, c.req.param('branchId')), eq(branches.tenantId, tenantId)));
  if (!branch) notFound('Branch not found');
  const body = await c.req.json();
  const patch = {};
  if (body.name !== undefined) patch.name = cleanStr(body.name, LIMITS.name, 'Branch name') || branch.name;
  if (body.location !== undefined) patch.location = cleanStr(body.location, 200, 'Location') || null;
  if (body.active !== undefined) {
    if (body.active === false) {
      const [[activeUsers], [openOrders]] = await db.batch([
        db.select({ count: sql`count(*)` }).from(users)
          .where(and(eq(users.branchId, branch.id), eq(users.status, 'active'))),
        db.select({ count: sql`count(*)` }).from(orders)
          .where(and(eq(orders.branchId, branch.id), sql`${orders.status} not in ('delivered','void')`)),
      ]);
      if (Number(activeUsers.count) || Number(openOrders.count)) bad('Reassign active users and complete open orders before deactivating this branch');
    }
    patch.active = body.active ? 1 : 0;
  }
  await db.update(branches).set(patch).where(eq(branches.id, branch.id));
  await platformAudit(db, actor.id, 'tenant_branch.update', 'branches', branch.id, {
    tenantId, reason: cleanStr(body.reason, 500, 'Reason'), payload: { before: branch, changes: patch },
  });
  return c.json({ ...branch, ...patch });
});

platformRoutes.post('/tenants/:id/members', requirePlatformPolicy('platform.tenants.manage'), async (c) => {
  const db = c.get('db');
  const actor = c.get('platformUser');
  const tenantId = c.req.param('id');
  const body = await c.req.json();
  const name = cleanStr(body.name, LIMITS.name, 'Name');
  const email = cleanStr(body.email, LIMITS.email, 'Email')?.toLowerCase();
  const phone = cleanStr(body.phone, LIMITS.phone, 'Phone');
  if (!name || !email || !body.role_id) bad('Name, email and role are required');
  const [[tenant], [role], branch, existing] = await Promise.all([
    db.select().from(tenants).where(eq(tenants.id, tenantId)),
    db.select().from(roles).where(and(eq(roles.id, body.role_id), eq(roles.tenantId, tenantId))),
    body.branch_id
      ? db.select().from(branches).where(and(eq(branches.id, body.branch_id), eq(branches.tenantId, tenantId)))
      : Promise.resolve([null]),
    db.select({ id: users.id }).from(users).where(eq(users.email, email)),
  ]);
  if (!tenant) notFound('Tenant not found');
  if (!role) bad('Unknown tenant role');
  if (body.branch_id && !branch[0]) bad('Unknown tenant branch');
  if (existing.length) bad('An account with this email already exists');
  const temporaryPassword = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const member = {
    id: uid(), tenantId, branchId: body.branch_id || null, roleId: role.id,
    accessScope: body.access_scope === 'tenant' || role.name === 'Dono/Admin' ? 'tenant' : 'branch',
    name, email, phone: phone || null, passwordHash: await hashPassword(temporaryPassword), status: 'active',
  };
  if (member.accessScope === 'branch' && !member.branchId) bad('Branch-scoped users require a branch');
  await db.insert(users).values(member);
  const emailSent = await issuePasswordReset(db, c.env, member, clientIp(c));
  await platformAudit(db, actor.id, 'tenant_member.create', 'users', member.id, {
    tenantId, payload: { name, email, role: role.name, branch_id: member.branchId, reset_email_sent: emailSent },
  });
  return c.json({ id: member.id, name, email, phone: member.phone, status: member.status, roleId: role.id, roleName: role.name, branchId: member.branchId, emailSent }, 201);
});

platformRoutes.patch('/tenants/:tenantId/members/:userId', requirePlatformPolicy('platform.tenants.manage'), async (c) => {
  const db = c.get('db');
  const actor = c.get('platformUser');
  const tenantId = c.req.param('tenantId');
  const body = await c.req.json();
  const [member] = await db.select({
    id: users.id, status: users.status, roleId: users.roleId, branchId: users.branchId, accessScope: users.accessScope,
    roleName: roles.name, name: users.name,
  }).from(users).innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.id, c.req.param('userId')), eq(users.tenantId, tenantId)));
  if (!member) notFound('Tenant member not found');

  const patch = {};
  if (body.status != null) {
    if (!['active', 'disabled'].includes(body.status)) bad('Invalid member status');
    patch.status = body.status;
  }
  let nextRole = null;
  if (body.role_id != null) {
    [nextRole] = await db.select().from(roles)
      .where(and(eq(roles.id, body.role_id), eq(roles.tenantId, tenantId)));
    if (!nextRole) bad('Unknown tenant role');
    patch.roleId = nextRole.id;
  }
  if (body.branch_id !== undefined) {
    if (body.branch_id) {
      const [branch] = await db.select().from(branches)
        .where(and(eq(branches.id, body.branch_id), eq(branches.tenantId, tenantId)));
      if (!branch) bad('Unknown tenant branch');
    }
    patch.branchId = body.branch_id || null;
  }
  if (body.access_scope && ['tenant', 'branch'].includes(body.access_scope)) {
    if (body.access_scope === 'branch' && !(body.branch_id || member.branchId)) bad('Branch-scoped users require a branch');
    patch.accessScope = body.access_scope;
  }
  const removingOwner = member.roleName === 'Dono/Admin'
    && (patch.status === 'disabled' || (nextRole && nextRole.name !== 'Dono/Admin'));
  if (removingOwner) {
    const [owners] = await db.select({ count: sql`count(*)` }).from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.tenantId, tenantId), eq(users.status, 'active'), eq(roles.name, 'Dono/Admin')));
    if (Number(owners?.count || 0) <= 1) bad('O último Dono/Admin ativo não pode ser desativado ou reatribuído');
  }
  if (!Object.keys(patch).length) bad('No changes supplied');
  await db.update(users).set(patch).where(and(eq(users.id, member.id), eq(users.tenantId, tenantId)));
  if (patch.status === 'disabled') {
    await db.update(sessions).set({ revokedAt: now() }).where(eq(sessions.userId, member.id));
  }
  await platformAudit(db, actor.id, 'tenant_member.update', 'users', member.id, {
    tenantId, reason: cleanStr(body.reason, 500, 'Reason'),
    payload: { before: member, changes: patch, next_role: nextRole?.name || member.roleName },
  });
  return c.json({ ...member, ...patch, roleName: nextRole?.name || member.roleName });
});

platformRoutes.post('/tenants/:tenantId/members/:userId/reset-password', requirePlatformPolicy('platform.tenants.manage'), async (c) => {
  const db = c.get('db');
  const actor = c.get('platformUser');
  const tenantId = c.req.param('tenantId');
  const [member] = await db.select().from(users)
    .where(and(eq(users.id, c.req.param('userId')), eq(users.tenantId, tenantId)));
  if (!member) notFound('Tenant member not found');
  if (member.status !== 'active') bad('Activate the member before sending a password reset');
  const emailSent = await issuePasswordReset(db, c.env, member, clientIp(c));
  await platformAudit(db, actor.id, 'tenant_member.password_reset', 'users', member.id, {
    tenantId, payload: { email: member.email, email_sent: emailSent },
  });
  if (!emailSent) throw new ApiError(502, 'The reset email could not be sent');
  return c.json({ ok: true });
});

platformRoutes.patch('/tenants/:id/status', requirePlatformPolicy('platform.tenants.manage'), async (c) => {
  const db = c.get('db');
  const actor = c.get('platformUser');
  const id = c.req.param('id');
  const body = await c.req.json();
  if (!['active', 'suspended', 'cancelled'].includes(body.status)) bad('Invalid tenant status');
  const reason = cleanStr(body.reason, 500, 'Reason');
  if (body.status !== 'active' && !reason) bad('A reason is required');
  const [existing] = await db.select().from(tenants).where(eq(tenants.id, id));
  if (!existing) notFound('Tenant not found');
  const [subscription] = body.status === 'cancelled'
    ? await db.select().from(tenantSubscriptions)
      .where(and(eq(tenantSubscriptions.tenantId, id), sql`${tenantSubscriptions.status} != 'cancelled'`))
      .orderBy(desc(tenantSubscriptions.createdAt)).limit(1)
    : [];
  const cancellationDate = subscription?.currentPeriodEnd && subscription.currentPeriodEnd > now().slice(0, 10)
    ? subscription.currentPeriodEnd
    : null;
  const patch = {
    status: cancellationDate ? 'active' : body.status,
    suspendedAt: body.status === 'suspended' ? now() : null,
    cancelledAt: body.status === 'cancelled' ? (cancellationDate || now()) : null,
    cancellationReason: body.status === 'cancelled' ? reason : null,
  };
  await db.update(tenants).set(patch).where(eq(tenants.id, id));
  if (cancellationDate) {
    await db.update(tenantSubscriptions).set({ cancelAtPeriodEnd: 1 }).where(eq(tenantSubscriptions.id, subscription.id));
  } else if (body.status !== 'active') {
    await db.update(sessions).set({ revokedAt: now() }).where(eq(sessions.tenantId, id));
  }
  await platformAudit(db, actor.id, cancellationDate ? 'tenant.cancellation_scheduled' : `tenant.${body.status}`, 'tenants', id, {
    tenantId: id, reason, payload: { previous_status: existing.status, effective_date: cancellationDate },
  });
  return c.json({ ...existing, ...patch });
});

platformRoutes.patch('/tenants/:id/billing', requirePlatformPolicy('platform.tenants.manage'), async (c) => {
  const db = c.get('db');
  const actor = c.get('platformUser');
  const tenantId = c.req.param('id');
  const body = await c.req.json();
  const billingEmail = cleanStr(body.billing_email, LIMITS.email, 'Billing email')?.toLowerCase() || null;
  if (billingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail)) bad('Enter a valid billing email');
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) notFound('Tenant not found');
  await db.update(tenants).set({ billingEmail }).where(eq(tenants.id, tenantId));
  await platformAudit(db, actor.id, 'tenant.billing_email_update', 'tenants', tenantId, {
    tenantId, payload: { previous_billing_email: tenant.billingEmail, billing_email: billingEmail },
  });
  return c.json({ ...tenant, billingEmail });
});

platformRoutes.get('/plans', requirePlatformPolicy('platform.billing.view'), async (c) => {
  const db = c.get('db');
  await ensurePlans(db);
  const [planRows, priceRows] = await Promise.all([
    db.select().from(plans).orderBy(plans.name),
    db.select().from(planPrices).orderBy(planPrices.termMonths),
  ]);
  return c.json(planRows.map((p) => ({
    ...p,
    prices: priceRows.filter((r) => r.planId === p.id)
      .map((r) => ({ termMonths: r.termMonths, priceCents: r.priceCents })),
  })));
});

// Dynamic plan configuration: rename, trial days, active flag and the full
// per-term price list. Only affects invoices generated AFTER the change.
platformRoutes.patch('/plans/:id', requirePlatformPolicy('platform.billing.manage'), async (c) => {
  const db = c.get('db');
  const actor = c.get('platformUser');
  const body = await c.req.json();
  const [plan] = await db.select().from(plans).where(eq(plans.id, c.req.param('id')));
  if (!plan) notFound('Plan not found');

  const patch = {};
  if (body.name != null) {
    patch.name = cleanStr(body.name, LIMITS.name, 'Plan name');
    if (!patch.name) bad('Plan name is required');
  }
  if (body.trial_days != null) {
    const days = Number(body.trial_days);
    if (!Number.isInteger(days) || days < 0 || days > 90) bad('Trial days must be 0–90');
    patch.trialDays = days;
  }
  if (body.active != null) patch.active = body.active ? 1 : 0;

  let prices = null;
  if (body.prices != null) {
    if (!Array.isArray(body.prices) || !body.prices.length) bad('Provide at least one term price');
    const seen = new Set();
    prices = body.prices.map((p) => {
      const term = Number(p.term_months);
      if (!Number.isInteger(term) || term < 1 || term > 24) bad('Term must be 1–24 months');
      if (seen.has(term)) bad(`Duplicate term: ${term} months`);
      seen.add(term);
      return { id: uid(), planId: plan.id, termMonths: term, priceCents: cents(p.price_cents, 'Term price') };
    }).sort((a, b) => a.termMonths - b.termMonths);
    // monthly headline price follows the 1-month rate (or shortest term)
    patch.priceCents = prices[0].priceCents;
  }

  if (Object.keys(patch).length) await db.update(plans).set(patch).where(eq(plans.id, plan.id));
  if (prices) {
    await db.delete(planPrices).where(eq(planPrices.planId, plan.id));
    await db.insert(planPrices).values(prices);
  }
  await platformAudit(db, actor.id, 'plan.update', 'plans', plan.id, {
    payload: {
      ...patch,
      ...(prices ? { prices: prices.map((p) => ({ term_months: p.termMonths, price_cents: p.priceCents })) } : {}),
    },
  });
  return c.json({
    ...plan, ...patch,
    prices: (prices || (await db.select().from(planPrices).where(eq(planPrices.planId, plan.id)).orderBy(planPrices.termMonths)))
      .map((p) => ({ termMonths: p.termMonths, priceCents: p.priceCents })),
  });
});

platformRoutes.put('/tenants/:id/subscription', requirePlatformPolicy('platform.billing.manage'), async (c) => {
  const db = c.get('db');
  const actor = c.get('platformUser');
  const tenantId = c.req.param('id');
  const body = await c.req.json();
  const [[tenant], [plan]] = await Promise.all([
    db.select().from(tenants).where(eq(tenants.id, tenantId)),
    db.select().from(plans).where(eq(plans.id, body.plan_id)),
  ]);
  if (!tenant || !plan) notFound('Tenant or plan not found');
  if (!['trial', 'active', 'past_due', 'suspended', 'cancelled'].includes(body.status || 'trial')) bad('Invalid subscription status');
  const termMonths = Number(body.term_months ?? 1);
  const [termPrice] = await db.select().from(planPrices)
    .where(and(eq(planPrices.planId, plan.id), eq(planPrices.termMonths, termMonths)));
  if (!termPrice) bad(`${plan.name} has no ${termMonths}-month term — configure it under Plans & pricing first`);
  const current = await db.select().from(tenantSubscriptions)
    .where(and(eq(tenantSubscriptions.tenantId, tenantId), sql`${tenantSubscriptions.status} != 'cancelled'`))
    .orderBy(desc(tenantSubscriptions.createdAt)).limit(1);
  const price = body.custom_price_cents == null ? null : cents(body.custom_price_cents, 'Custom price');
  let subscription;
  if (current[0]) {
    const periodStart = current[0].currentPeriodStart || now().slice(0, 10);
    [subscription] = await db.update(tenantSubscriptions)
      .set({
        planId: plan.id, customPriceCents: price, termMonths,
        status: body.status || current[0].status,
        currentPeriodEnd: addMonths(periodStart, termMonths),
      })
      .where(eq(tenantSubscriptions.id, current[0].id)).returning();
  } else {
    const periodStart = now().slice(0, 10);
    subscription = {
      id: uid(), tenantId, planId: plan.id, customPriceCents: price, termMonths,
      status: body.status || 'trial', currentPeriodStart: periodStart,
      currentPeriodEnd: addMonths(periodStart, termMonths),
    };
    await db.insert(tenantSubscriptions).values(subscription);
  }
  await db.update(tenants).set({ plan: plan.code }).where(eq(tenants.id, tenantId));
  await platformAudit(db, actor.id, 'subscription.update', 'tenant_subscriptions', subscription.id, {
    tenantId, payload: { plan: plan.code, term_months: termMonths, custom_price_cents: price },
  });
  return c.json(subscription);
});

platformRoutes.get('/invoices', requirePlatformPolicy('platform.billing.view'), async (c) => {
  const db = c.get('db');
  const limit = clampPage(c.req.query('limit'), 20, 100);
  const offset = clampPage(c.req.query('offset'), 0, 1_000_000);
  const status = c.req.query('status');
  const tenantId = c.req.query('tenant_id');
  const period = c.req.query('period'); // YYYY-MM or YYYY-MM-DD
  const conds = [];
  if (status) conds.push(eq(billingInvoices.status, status));
  if (tenantId) conds.push(eq(billingInvoices.tenantId, tenantId));
  if (period) {
    // the invoices "involved in the income" of a period: issued in it, or
    // holding completed payments received in it
    const valid = /^\d{4}-\d{2}$/.test(period) ? validMonth(period, null) : validDate(period, null);
    if (!valid) bad('Invalid period — use YYYY-MM or YYYY-MM-DD');
    const len = period.length;
    conds.push(or(
      sql`substr(${billingInvoices.issuedAt}, 1, ${len}) = ${period}`,
      sql`${billingInvoices.id} in (select invoice_id from billing_payments where status = 'completed' and substr(paid_at, 1, ${len}) = ${period})`,
    ));
  }
  const where = conds.length ? and(...conds) : undefined;
  const [rows, total] = await Promise.all([
    db.select({
      id: billingInvoices.id, number: billingInvoices.number, tenantId: billingInvoices.tenantId,
      tenantName: tenants.name, status: billingInvoices.status, currency: billingInvoices.currency,
      totalCents: billingInvoices.totalCents, issuedAt: billingInvoices.issuedAt,
      dueAt: billingInvoices.dueAt, createdAt: billingInvoices.createdAt,
      paidCents: sql`coalesce((select sum(p.amount_cents) from billing_payments p where p.invoice_id = ${billingInvoices.id} and p.status = 'completed'), 0)`,
    }).from(billingInvoices).innerJoin(tenants, eq(tenants.id, billingInvoices.tenantId))
      .where(where).orderBy(desc(billingInvoices.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql`count(*)` }).from(billingInvoices).where(where),
  ]);
  return c.json({ rows, total: Number(total[0]?.count || 0), limit, offset });
});

platformRoutes.get('/invoices/:id', requirePlatformPolicy('platform.billing.view'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const [[invoice], items, payments] = await Promise.all([
    db.select({
      id: billingInvoices.id, number: billingInvoices.number, status: billingInvoices.status,
      currency: billingInvoices.currency, periodStart: billingInvoices.periodStart, periodEnd: billingInvoices.periodEnd,
      issuedAt: billingInvoices.issuedAt, dueAt: billingInvoices.dueAt, subtotalCents: billingInvoices.subtotalCents,
      taxCents: billingInvoices.taxCents, totalCents: billingInvoices.totalCents, notes: billingInvoices.notes,
      tenantId: tenants.id, tenantName: tenants.name, billingEmail: tenants.billingEmail,
    }).from(billingInvoices).innerJoin(tenants, eq(tenants.id, billingInvoices.tenantId))
      .where(eq(billingInvoices.id, id)),
    db.select().from(billingInvoiceItems).where(eq(billingInvoiceItems.invoiceId, id)),
    db.select().from(billingPayments).where(and(eq(billingPayments.invoiceId, id), eq(billingPayments.status, 'completed')))
      .orderBy(desc(billingPayments.paidAt)),
  ]);
  if (!invoice) notFound('Invoice not found');
  return c.json({ invoice, items, payments });
});

// Shared by manual creation and plan-driven generation — one insert path.
async function createInvoice(db, actor, tenant, { items, taxCents = 0, dueAt = null, periodStart = null, periodEnd = null, notes = null, subscriptionId = null }) {
  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const sequence = await db.select({ count: sql`count(*)` }).from(billingInvoices);
  const invoice = {
    id: uid(), tenantId: tenant.id, subscriptionId,
    number: `EWI-${String(Number(sequence[0]?.count || 0) + 1).padStart(6, '0')}`,
    currency: tenant.currency, dueAt, periodStart, periodEnd,
    subtotalCents, taxCents, totalCents: subtotalCents + taxCents,
    notes, createdBy: actor.id,
  };
  await db.insert(billingInvoices).values(invoice);
  await db.insert(billingInvoiceItems).values(items.map((item) => ({ ...item, invoiceId: invoice.id })));
  await platformAudit(db, actor.id, 'invoice.create', 'billing_invoices', invoice.id, {
    tenantId: tenant.id, payload: { number: invoice.number, total_cents: invoice.totalCents, subscription_id: subscriptionId },
  });
  return { ...invoice, items };
}

platformRoutes.post('/invoices', requirePlatformPolicy('platform.billing.manage'), async (c) => {
  const db = c.get('db');
  const body = await c.req.json();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, body.tenant_id));
  if (!tenant) notFound('Tenant not found');
  if (!Array.isArray(body.items) || !body.items.length) bad('At least one invoice item is required');
  const items = body.items.map((item) => {
    const quantity = Math.max(1, Number.parseInt(item.quantity, 10) || 1);
    const unitAmountCents = cents(item.unit_amount_cents, 'Unit amount');
    const description = cleanStr(item.description, 200, 'Description');
    if (!description) bad('Item description is required');
    return { id: uid(), description, quantity, unitAmountCents, lineTotalCents: quantity * unitAmountCents };
  });
  const invoice = await createInvoice(db, c.get('platformUser'), tenant, {
    items,
    taxCents: cents(body.tax_cents || 0, 'Tax'),
    dueAt: validDate(body.due_at, null),
    periodStart: validDate(body.period_start, null),
    periodEnd: validDate(body.period_end, null),
    notes: cleanStr(body.notes, 1000, 'Notes'),
  });
  return c.json(invoice, 201);
});

// Plan-driven generation: the invoice lines are computed HERE, from the plan's
// current term pricing (custom per-month override wins) — editing a plan
// changes what gets generated next, never what was already issued.
platformRoutes.post('/invoices/generate', requirePlatformPolicy('platform.billing.manage'), async (c) => {
  const db = c.get('db');
  const body = await c.req.json();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, body.tenant_id));
  if (!tenant) notFound('Tenant not found');
  const [subscription] = await db.select().from(tenantSubscriptions)
    .where(and(eq(tenantSubscriptions.tenantId, tenant.id), sql`${tenantSubscriptions.status} != 'cancelled'`))
    .orderBy(desc(tenantSubscriptions.createdAt)).limit(1);
  if (!subscription) bad('This tenant has no subscription — assign a plan first');
  const [plan] = await db.select().from(plans).where(eq(plans.id, subscription.planId));
  if (!plan) bad('Subscription plan no longer exists');
  const [termPrice] = await db.select().from(planPrices)
    .where(and(eq(planPrices.planId, plan.id), eq(planPrices.termMonths, subscription.termMonths)));
  if (termPrice == null && subscription.customPriceCents == null) {
    bad(`${plan.name} has no ${subscription.termMonths}-month price — configure it under Plans & pricing first`);
  }

  const periodStart = subscription.currentPeriodStart || now().slice(0, 10);
  const periodEnd = subscription.currentPeriodEnd || addMonths(periodStart, subscription.termMonths);
  const [duplicate] = await db.select({ id: billingInvoices.id, number: billingInvoices.number }).from(billingInvoices)
    .where(and(
      eq(billingInvoices.subscriptionId, subscription.id),
      eq(billingInvoices.periodStart, periodStart),
      sql`${billingInvoices.status} != 'void'`,
    ));
  if (duplicate) bad(`Invoice ${duplicate.number} already covers this period — void it first to regenerate`);

  const perMonthCents = subscription.customPriceCents ?? termPrice.priceCents;
  const invoice = await createInvoice(db, c.get('platformUser'), tenant, {
    items: [{
      id: uid(),
      description: `${plan.name} plan — ${subscription.termMonths}-month subscription (${periodStart} → ${periodEnd})`,
      quantity: subscription.termMonths,
      unitAmountCents: perMonthCents,
      lineTotalCents: subscription.termMonths * perMonthCents,
    }],
    dueAt: validDate(body.due_at, null) || addDays(periodStart, 7),
    periodStart, periodEnd,
    subscriptionId: subscription.id,
  });
  return c.json(invoice, 201);
});

platformRoutes.patch('/invoices/:id', requirePlatformPolicy('platform.billing.manage'), async (c) => {
  const db = c.get('db');
  const actor = c.get('platformUser');
  const body = await c.req.json();
  if (!['issued', 'void'].includes(body.status)) bad('Invoice can only be issued or voided');
  const [invoice] = await db.select().from(billingInvoices).where(eq(billingInvoices.id, c.req.param('id')));
  if (!invoice) notFound('Invoice not found');
  if (invoice.status !== 'draft' && body.status === 'issued') bad('Only draft invoices can be issued');
  const reason = cleanStr(body.reason, 500, 'Reason');
  if (body.status === 'void' && !reason) bad('A reason is required');
  const patch = { status: body.status, issuedAt: body.status === 'issued' ? now() : invoice.issuedAt };
  await db.update(billingInvoices).set(patch).where(eq(billingInvoices.id, invoice.id));
  await platformAudit(db, actor.id, `invoice.${body.status}`, 'billing_invoices', invoice.id, {
    tenantId: invoice.tenantId, reason, payload: { number: invoice.number },
  });
  return c.json({ ...invoice, ...patch });
});

// A fully-paid subscription invoice is an operating cost for the tenant —
// post it automatically into their expense register (idempotent per invoice,
// attributed to the tenant's first user/branch, category auto-created).
const SUBSCRIPTION_EXPENSE_CATEGORY = 'Subscriptions & software';

async function postSubscriptionExpense(db, invoice, paidDate, method) {
  const note = `LavTr subscription — invoice ${invoice.number}`;
  const [dup] = await db.select({ id: expenses.id }).from(expenses).where(and(
    eq(expenses.tenantId, invoice.tenantId), eq(expenses.note, note), eq(expenses.status, 'active'),
  ));
  if (dup) return;
  const [[category], [branch], [owner]] = await Promise.all([
    db.select({ id: expenseCategories.id }).from(expenseCategories).where(and(
      eq(expenseCategories.tenantId, invoice.tenantId), eq(expenseCategories.name, SUBSCRIPTION_EXPENSE_CATEGORY),
    )),
    db.select({ id: branches.id }).from(branches)
      .where(eq(branches.tenantId, invoice.tenantId)).orderBy(branches.createdAt).limit(1),
    db.select({ id: users.id }).from(users)
      .where(and(eq(users.tenantId, invoice.tenantId), eq(users.status, 'active')))
      .orderBy(users.createdAt).limit(1),
  ]);
  if (!branch || !owner) throw new Error(`tenant ${invoice.tenantId} has no branch/user to attribute the expense to`);
  let categoryId = category?.id;
  if (!categoryId) {
    categoryId = uid();
    await db.insert(expenseCategories).values({ id: categoryId, tenantId: invoice.tenantId, name: SUBSCRIPTION_EXPENSE_CATEGORY });
  }
  const row = {
    id: uid(), tenantId: invoice.tenantId, branchId: branch.id, categoryId,
    amountCents: invoice.totalCents,
    paidVia: method === 'mpesa_manual' ? 'mpesa' : 'cash',
    expenseDate: paidDate, note, recordedBy: owner.id,
  };
  await db.insert(expenses).values(row);
  await audit(db, invoice.tenantId, owner.id, 'expense.create', 'expenses', row.id, {
    category: SUBSCRIPTION_EXPENSE_CATEGORY, amount_cents: invoice.totalCents,
    source: 'billing_invoice', invoice: invoice.number,
  });
}

platformRoutes.post('/invoices/:id/payments', requirePlatformPolicy('platform.billing.manage'), async (c) => {
  const db = c.get('db');
  const actor = c.get('platformUser');
  const body = await c.req.json();
  const [invoice] = await db.select().from(billingInvoices).where(eq(billingInvoices.id, c.req.param('id')));
  if (!invoice || !['issued', 'partially_paid', 'overdue'].includes(invoice.status)) bad('Invoice is not payable');
  if (!['cash', 'bank', 'mpesa_manual'].includes(body.method)) bad('Invalid payment method');
  const amountCents = cents(body.amount_cents);
  if (!amountCents) bad('Payment amount must be greater than zero');
  const paid = await db.select({ total: sql`coalesce(sum(${billingPayments.amountCents}), 0)` }).from(billingPayments)
    .where(and(eq(billingPayments.invoiceId, invoice.id), eq(billingPayments.status, 'completed')));
  if (Number(paid[0]?.total || 0) + amountCents > invoice.totalCents) bad('Payment exceeds invoice balance');
  const payment = {
    id: uid(), tenantId: invoice.tenantId, invoiceId: invoice.id, amountCents,
    method: body.method, reference: cleanStr(body.reference, 100, 'Reference') || null,
    paidAt: validDate(body.paid_at, now().slice(0, 10)), recordedBy: actor.id,
  };
  await db.insert(billingPayments).values(payment);
  const totalPaid = Number(paid[0]?.total || 0) + amountCents;
  await db.update(billingInvoices).set({ status: totalPaid === invoice.totalCents ? 'paid' : 'partially_paid' })
    .where(eq(billingInvoices.id, invoice.id));
  if (totalPaid === invoice.totalCents) {
    // never let expense bookkeeping break payment recording — log and continue
    try { await postSubscriptionExpense(db, invoice, payment.paidAt, payment.method); }
    catch (error) { console.error('subscription expense post failed:', error.message); }
  }
  await platformAudit(db, actor.id, 'billing_payment.record', 'billing_payments', payment.id, {
    tenantId: invoice.tenantId, payload: { invoice: invoice.number, amount_cents: amountCents, method: body.method },
  });
  return c.json(payment, 201);
});

platformRoutes.get('/audit', requirePlatformPolicy('platform.audit.view'), async (c) => {
  const db = c.get('db');
  const limit = clampPage(c.req.query('limit'), 30, 100);
  const offset = clampPage(c.req.query('offset'), 0, 1_000_000);
  const [rows, total] = await Promise.all([
    db.select({
      id: platformAuditLog.id, action: platformAuditLog.action, entity: platformAuditLog.entity,
      entityId: platformAuditLog.entityId, tenantId: platformAuditLog.tenantId,
      tenantName: tenants.name, actorName: platformUsers.name, reason: platformAuditLog.reason,
      payload: platformAuditLog.payload, at: platformAuditLog.at,
    }).from(platformAuditLog).innerJoin(platformUsers, eq(platformUsers.id, platformAuditLog.platformUserId))
      .leftJoin(tenants, eq(tenants.id, platformAuditLog.tenantId))
      .orderBy(desc(platformAuditLog.at)).limit(limit).offset(offset),
    db.select({ count: sql`count(*)` }).from(platformAuditLog),
  ]);
  return c.json({ rows, total: Number(total[0]?.count || 0), limit, offset });
});
