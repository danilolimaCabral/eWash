import { Hono } from 'hono';
import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '../auth.js';
import {
  billingInvoiceItems, billingInvoices, billingPayments, branches, plans,
  platformAuditLog, platformUsers, roles, sessions, tenantSubscriptions, tenants, users, orders, payments,
} from '../db/schema.js';
import { getDb } from '../db/index.js';
import { clientIp, enforceRateLimit } from '../ratelimit.js';
import { cleanStr, LIMITS, validDate, validMonth } from '../security.js';
import {
  issuePlatformSession, PLATFORM_POLICIES, requirePlatformPolicy,
  revokePlatformSession, rotatePlatformSession,
} from '../platform.js';
import { ApiError, bad, notFound, now, uid } from '../util.js';
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

async function ensurePlans(db) {
  const existing = await db.select({ id: plans.id }).from(plans);
  if (existing.length) return;
  await db.insert(plans).values([
    { id: uid(), code: 'starter', name: 'Starter', priceCents: 0, trialDays: 14 },
    { id: uid(), code: 'growth', name: 'Growth', priceCents: 0, trialDays: 14 },
    { id: uid(), code: 'enterprise', name: 'Enterprise', priceCents: 0, trialDays: 14 },
  ]);
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
      outstandingCents: sql`coalesce(sum(case when ${billingInvoices.status} in ('issued','partially_paid','overdue') then ${billingInvoices.totalCents} - coalesce((select sum(bp.amount_cents) from billing_payments bp where bp.invoice_id = ${billingInvoices.id} and bp.status = 'completed'), 0) else 0 end), 0)`,
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

  const grossExpr = sql`coalesce((select sum(o.total_cents) from orders o where o.tenant_id = ${tenants.id} and o.status = 'delivered' ${closedAtMonth}), 0)`;
  const collectedExpr = sql`coalesce((select sum(p.amount_cents) from payments p where p.tenant_id = ${tenants.id} and p.status = 'completed' ${paidAtMonth}), 0)`;
  const closedExpr = sql`coalesce((select count(*) from orders o where o.tenant_id = ${tenants.id} and o.status = 'delivered' ${closedAtMonth}), 0)`;

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
      branches: sql`(select count(*) from branches b where b.tenant_id = ${tenants.id})`,
      users: sql`(select count(*) from users u where u.tenant_id = ${tenants.id})`,
      outstandingCents: sql`coalesce((select sum(i.total_cents - coalesce((select sum(p.amount_cents) from billing_payments p where p.invoice_id = i.id and p.status = 'completed'), 0)) from billing_invoices i where i.tenant_id = ${tenants.id} and i.status in ('issued','partially_paid','overdue')), 0)`,
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
      planName: plans.name, customPriceCents: tenantSubscriptions.customPriceCents,
      currentPeriodEnd: tenantSubscriptions.currentPeriodEnd, cancelAtPeriodEnd: tenantSubscriptions.cancelAtPeriodEnd,
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
      users: sql`(select count(*) from users u where u.branch_id = ${branches.id} and u.status = 'active')`,
      openOrders: sql`(select count(*) from orders o where o.branch_id = ${branches.id} and o.status not in ('delivered','void'))`,
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
    accessScope: body.access_scope === 'tenant' || role.name === 'Owner/Admin' ? 'tenant' : 'branch',
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
  const removingOwner = member.roleName === 'Owner/Admin'
    && (patch.status === 'disabled' || (nextRole && nextRole.name !== 'Owner/Admin'));
  if (removingOwner) {
    const [owners] = await db.select({ count: sql`count(*)` }).from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.tenantId, tenantId), eq(users.status, 'active'), eq(roles.name, 'Owner/Admin')));
    if (Number(owners?.count || 0) <= 1) bad('The final active Owner/Admin cannot be deactivated or reassigned');
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
  await ensurePlans(c.get('db'));
  return c.json(await c.get('db').select().from(plans).orderBy(plans.name));
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
  const current = await db.select().from(tenantSubscriptions)
    .where(and(eq(tenantSubscriptions.tenantId, tenantId), sql`${tenantSubscriptions.status} != 'cancelled'`))
    .orderBy(desc(tenantSubscriptions.createdAt)).limit(1);
  const price = body.custom_price_cents == null ? null : cents(body.custom_price_cents, 'Custom price');
  let subscription;
  if (current[0]) {
    [subscription] = await db.update(tenantSubscriptions)
      .set({ planId: plan.id, customPriceCents: price, status: body.status || current[0].status })
      .where(eq(tenantSubscriptions.id, current[0].id)).returning();
  } else {
    subscription = {
      id: uid(), tenantId, planId: plan.id, customPriceCents: price,
      status: body.status || 'trial', currentPeriodStart: now().slice(0, 10),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
    };
    await db.insert(tenantSubscriptions).values(subscription);
  }
  await db.update(tenants).set({ plan: plan.code }).where(eq(tenants.id, tenantId));
  await platformAudit(db, actor.id, 'subscription.update', 'tenant_subscriptions', subscription.id, {
    tenantId, payload: { plan: plan.code, custom_price_cents: price },
  });
  return c.json(subscription);
});

platformRoutes.get('/invoices', requirePlatformPolicy('platform.billing.view'), async (c) => {
  const db = c.get('db');
  const limit = clampPage(c.req.query('limit'), 20, 100);
  const offset = clampPage(c.req.query('offset'), 0, 1_000_000);
  const status = c.req.query('status');
  const tenantId = c.req.query('tenant_id');
  const conds = [];
  if (status) conds.push(eq(billingInvoices.status, status));
  if (tenantId) conds.push(eq(billingInvoices.tenantId, tenantId));
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

platformRoutes.post('/invoices', requirePlatformPolicy('platform.billing.manage'), async (c) => {
  const db = c.get('db');
  const actor = c.get('platformUser');
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
  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const taxCents = cents(body.tax_cents || 0, 'Tax');
  const sequence = await db.select({ count: sql`count(*)` }).from(billingInvoices);
  const invoice = {
    id: uid(), tenantId: tenant.id, number: `EWI-${String(Number(sequence[0]?.count || 0) + 1).padStart(6, '0')}`,
    currency: tenant.currency, dueAt: validDate(body.due_at, null), periodStart: validDate(body.period_start, null),
    periodEnd: validDate(body.period_end, null), subtotalCents, taxCents, totalCents: subtotalCents + taxCents,
    notes: cleanStr(body.notes, 1000, 'Notes'), createdBy: actor.id,
  };
  await db.insert(billingInvoices).values(invoice);
  await db.insert(billingInvoiceItems).values(items.map((item) => ({ ...item, invoiceId: invoice.id })));
  await platformAudit(db, actor.id, 'invoice.create', 'billing_invoices', invoice.id, {
    tenantId: tenant.id, payload: { number: invoice.number, total_cents: invoice.totalCents },
  });
  return c.json({ ...invoice, items }, 201);
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
