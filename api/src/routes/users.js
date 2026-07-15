import { Hono } from 'hono';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { users, roles, rolePolicies, userPolicyOverrides, branches, orders } from '../db/schema.js';
import { requirePolicy } from '../middleware.js';
import { uid, bad, notFound, audit, forbidden, ApiError } from '../util.js';
import { INVITED_PASSWORD } from '../auth.js';
import { issueStaffInvite, appOrigin } from '../passwordReset.js';
import { enforceRateLimit, clientIp } from '../ratelimit.js';
import { POLICY_KEYS, effectivePolicies } from '../policies.js';
import { presenceQuery, presenceMap } from '../session.js';
import { cleanStr, validEmail, LIMITS } from '../security.js';
import { cacheDelete, authCacheKey } from '../cache.js';
import { isTenantWide, scopedBranchId } from '../branchAccess.js';

export const userRoutes = new Hono();

userRoutes.get('/roles', async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const roleRows = await db.select().from(roles).where(eq(roles.tenantId, tenantId));
  const policyRows = roleRows.length
    ? await db.select().from(rolePolicies).where(inArray(rolePolicies.roleId, roleRows.map((r) => r.id)))
    : [];
  return c.json(roleRows.map((r) => ({
    ...r,
    policies: policyRows.filter((p) => p.roleId === r.id && p.allow).map((p) => p.policyKey),
  })));
});

// Custom roles built from the policy catalog (spec §7.1).
userRoutes.post('/roles', requirePolicy('users.manage'), async (c) => {
  const b = await c.req.json();
  if (!b.name?.trim()) bad('Role name is required');
  const keys = (b.policies || []).filter((k) => POLICY_KEYS.includes(k));
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const role = { id: uid(), tenantId, name: b.name.trim(), isSystem: 0 };
  await db.insert(roles).values(role);
  if (keys.length) {
    await db.insert(rolePolicies).values(keys.map((k) => ({ id: uid(), roleId: role.id, policyKey: k, allow: 1 })));
  }
  await audit(db, tenantId, c.get('user').id, 'role.create', 'roles', role.id, { name: role.name, policies: keys });
  return c.json({ ...role, policies: keys }, 201);
});

userRoutes.get('/users', requirePolicy('users.manage'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  // one D1 round trip: overrides/policies join through tenant-scoped users/roles.
  // Role names come from their own query — D1 batch rows are keyed by column
  // name, so joining users.name with roles.name would silently collide.
  const [userRows, roleRows, overrides, policyRows, presence] = await db.batch([
    db.select({
      id: users.id, name: users.name, email: users.email, phone: users.phone,
      status: users.status, branchId: users.branchId, roleId: users.roleId, accessScope: users.accessScope,
      passwordHash: users.passwordHash,
    }).from(users)
      .where(and(eq(users.tenantId, tenantId), ...(isTenantWide(c) ? [] : [eq(users.branchId, c.get('user').branchId)]))),
    db.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.tenantId, tenantId)),
    db.select({
      userId: userPolicyOverrides.userId,
      policyKey: userPolicyOverrides.policyKey,
      effect: userPolicyOverrides.effect,
    }).from(userPolicyOverrides)
      .innerJoin(users, eq(users.id, userPolicyOverrides.userId))
      .where(eq(users.tenantId, tenantId)),
    db.select({
      roleId: rolePolicies.roleId,
      policyKey: rolePolicies.policyKey,
      allow: rolePolicies.allow,
    }).from(rolePolicies)
      .innerJoin(roles, eq(roles.id, rolePolicies.roleId))
      .where(eq(roles.tenantId, tenantId)),
    presenceQuery(db, tenantId),
  ]).then(([u, r, o, p, pres]) => [u, r, o, p, presenceMap(pres)]);

  const roleNames = new Map(roleRows.map((r) => [r.id, r.name]));
  return c.json(userRows.map(({ passwordHash, ...u }) => {
    const rolePolicyKeys = policyRows.filter((p) => p.roleId === u.roleId && p.allow).map((p) => p.policyKey);
    const userOverrides = overrides.filter((o) => o.userId === u.id);
    const seen = presence.get(u.id);
    return {
      ...u,
      roleName: roleNames.get(u.roleId) || '',
      invited: passwordHash === INVITED_PASSWORD, // hasn't accepted the invite yet
      rolePolicies: rolePolicyKeys,
      overrides: Object.fromEntries(userOverrides.map((o) => [o.policyKey, o.effect])),
      effectivePolicies: effectivePolicies(rolePolicyKeys, userOverrides),
      online: seen?.online ?? false,
      lastSeenAt: seen?.lastSeenAt ?? null,
    };
  }));
});

// Invite a staff member: the invitee gets an emailed link where they set
// their own password — the admin never knows or chooses it.
async function sendInvite(c, targetUser) {
  const db = c.get('db');
  const tenant = c.get('tenant');
  // authed + policy-checked, but still cap outbound invite email per tenant
  await enforceRateLimit(db, `invite:tenant:${tenant.id}`, 30, 3600,
    'Too many invitations this hour — please try again later');
  const { sent, inviteUrl } = await issueStaffInvite(db, c.env, {
    user: targetUser, business: tenant.name, inviter: c.get('user').name,
  }, appOrigin(c), clientIp(c));
  if (!sent && c.env.ENVIRONMENT === 'production') {
    throw new ApiError(500, 'The invitation could not be emailed — please try again shortly.');
  }
  return inviteUrl;
}

userRoutes.post('/users', requirePolicy('users.manage'), async (c) => {
  const b = await c.req.json();
  for (const f of ['name', 'email', 'role_id']) if (!b[f]?.trim?.()) bad(`Missing field: ${f}`);
  b.name = cleanStr(b.name, LIMITS.name, 'Name');
  b.phone = cleanStr(b.phone, LIMITS.phone, 'Phone');
  const db = c.get('db');
  const tenant = c.get('tenant');
  const email = validEmail(b.email);
  const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (dup) bad('An account with this email already exists');
  const [role] = await db.select().from(roles)
    .where(and(eq(roles.tenantId, tenant.id), eq(roles.id, b.role_id)));
  if (!role) bad('Unknown role');
  const accessScope = b.access_scope === 'tenant' ? 'tenant' : 'branch';
  if (accessScope === 'tenant' && !isTenantWide(c)) forbidden('Only tenant-wide administrators can create tenant-wide users');
  let branchId = scopedBranchId(c, b.branch_id || c.get('user').branchId);
  if (accessScope === 'branch' && !branchId) bad('Branch-scoped users require a branch');
  if (branchId) {
    const [branch] = await db.select().from(branches)
      .where(and(eq(branches.tenantId, tenant.id), eq(branches.id, branchId)));
    if (!branch) bad('Unknown branch');
  }
  const row = {
    id: uid(), tenantId: tenant.id, branchId, roleId: role.id, accessScope,
    name: b.name.trim(), phone: b.phone || null, email,
    passwordHash: INVITED_PASSWORD, // set by the invitee when they accept
    status: 'pending',
  };
  await db.insert(users).values(row);
  const inviteUrl = await sendInvite(c, row);
  await audit(db, tenant.id, c.get('user').id, 'user.invite', 'users', row.id, { name: row.name, role: role.name });
  return c.json({
    id: row.id,
    message: `Invitation sent to ${email} — they'll choose their own password.`,
    ...(c.env.ENVIRONMENT !== 'production' ? { invite_url: inviteUrl } : {}),
  }, 201);
});

// Re-send (or revive a revoked) invitation for a user who hasn't accepted yet.
userRoutes.post('/users/:id/resend-invite', requirePolicy('users.manage'), async (c) => {
  const db = c.get('db');
  const tenant = c.get('tenant');
  const [target] = await db.select().from(users)
    .where(and(eq(users.tenantId, tenant.id), eq(users.id, c.req.param('id'))));
  if (!target) notFound('User not found');
  if (!isTenantWide(c) && target.branchId !== c.get('user').branchId) notFound('User not found');
  if (target.passwordHash !== INVITED_PASSWORD || target.status === 'active') {
    bad('This user has already accepted their invitation');
  }
  if (target.status !== 'pending') {
    await db.update(users).set({ status: 'pending' }).where(eq(users.id, target.id));
  }
  const inviteUrl = await sendInvite(c, target);
  await audit(db, tenant.id, c.get('user').id, 'user.invite_resend', 'users', target.id, { name: target.name });
  return c.json({
    message: `Invitation re-sent to ${target.email}.`,
    ...(c.env.ENVIRONMENT !== 'production' ? { invite_url: inviteUrl } : {}),
  });
});

// Update role and/or per-user policy overrides. Override semantics: sending
// { "payments.refund": "grant", "orders.create": null } grants one and clears
// the other back to the role default. Changing role clears all overrides.
userRoutes.patch('/users/:id', requirePolicy('users.manage'), async (c) => {
  const b = await c.req.json();
  const db = c.get('db');
  const tenant = c.get('tenant');
  const actor = c.get('user');
  const [target] = await db.select().from(users)
    .where(and(eq(users.tenantId, tenant.id), eq(users.id, c.req.param('id'))));
  if (!target) notFound('User not found');
  if (!isTenantWide(c) && target.branchId !== actor.branchId) notFound('User not found');

  const changes = {};
  if (b.role_id && b.role_id !== target.roleId) {
    const [role] = await db.select().from(roles)
      .where(and(eq(roles.tenantId, tenant.id), eq(roles.id, b.role_id)));
    if (!role) bad('Unknown role');
    await db.update(users).set({ roleId: role.id }).where(eq(users.id, target.id));
    await db.delete(userPolicyOverrides).where(eq(userPolicyOverrides.userId, target.id));
    changes.role = role.name;
    changes.overrides_cleared = true;
  }

  if (b.overrides && typeof b.overrides === 'object') {
    for (const [key, effect] of Object.entries(b.overrides)) {
      if (!POLICY_KEYS.includes(key)) continue;
      await db.delete(userPolicyOverrides).where(and(
        eq(userPolicyOverrides.userId, target.id),
        eq(userPolicyOverrides.policyKey, key),
      ));
      if (effect === 'grant' || effect === 'deny') {
        await db.insert(userPolicyOverrides).values({ id: uid(), userId: target.id, policyKey: key, effect });
      }
    }
    changes.overrides = b.overrides;
  }

  if (b.status && ['active', 'disabled'].includes(b.status)) {
    if (target.id === actor.id && b.status === 'disabled') bad('You cannot deactivate yourself');
    if (b.status === 'active' && target.passwordHash === INVITED_PASSWORD) {
      bad('This user has not accepted their invitation yet — resend the invite instead');
    }
    await db.update(users).set({ status: b.status }).where(eq(users.id, target.id));
    changes.status = b.status;
  }

  if (b.branch_id) {
    scopedBranchId(c, b.branch_id);
    const [branch] = await db.select().from(branches)
      .where(and(eq(branches.tenantId, tenant.id), eq(branches.id, b.branch_id)));
    if (!branch) bad('Unknown branch');
    await db.update(users).set({ branchId: branch.id }).where(eq(users.id, target.id));
    changes.branch = branch.name;
  }
  if (b.access_scope && ['tenant', 'branch'].includes(b.access_scope)) {
    if (!isTenantWide(c)) forbidden('Only tenant-wide administrators can change access scope');
    if (b.access_scope === 'branch' && !(b.branch_id || target.branchId)) bad('Branch-scoped users require a branch');
    await db.update(users).set({ accessScope: b.access_scope }).where(eq(users.id, target.id));
    changes.access_scope = b.access_scope;
  }

  await audit(db, tenant.id, actor.id, 'user.update', 'users', target.id, { name: target.name, ...changes });
  cacheDelete(authCacheKey(target.id)); // permissions changed — drop cached auth context
  return c.json({ ok: true });
});

userRoutes.get('/branches', async (c) => {
  const rows = await c.get('db').select().from(branches)
    .where(and(eq(branches.tenantId, c.get('tenant').id), ...(isTenantWide(c) ? [] : [eq(branches.id, c.get('user').branchId)])));
  return c.json(rows);
});

userRoutes.post('/branches', requirePolicy('branches.manage'), async (c) => {
  if (!isTenantWide(c)) forbidden('Only tenant-wide administrators can create branches');
  const b = await c.req.json();
  if (!b.name?.trim()) bad('Branch name is required');
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const row = { id: uid(), tenantId, name: b.name.trim(), location: b.location || null };
  await db.insert(branches).values(row);
  await audit(db, tenantId, c.get('user').id, 'branch.create', 'branches', row.id, { name: row.name });
  return c.json(row, 201);
});

userRoutes.patch('/branches/:id', requirePolicy('branches.manage'), async (c) => {
  if (!isTenantWide(c)) forbidden('Only tenant-wide administrators can manage branches');
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const [branch] = await db.select().from(branches)
    .where(and(eq(branches.id, c.req.param('id')), eq(branches.tenantId, tenantId)));
  if (!branch) notFound('Branch not found');
  const b = await c.req.json();
  const patch = {};
  if (b.name !== undefined) patch.name = cleanStr(b.name, LIMITS.name, 'Branch name') || branch.name;
  if (b.location !== undefined) patch.location = cleanStr(b.location, 200, 'Location') || null;
  if (b.active !== undefined) {
    if (b.active === false) {
      const [[activeUsers], [openOrders]] = await db.batch([
        db.select({ count: sql`count(*)` }).from(users).where(and(eq(users.branchId, branch.id), eq(users.status, 'active'))),
        db.select({ count: sql`count(*)` }).from(orders)
          .where(and(eq(orders.branchId, branch.id), sql`${orders.status} not in ('delivered','void')`)),
      ]);
      if (Number(activeUsers.count) || Number(openOrders.count)) bad('Reassign active users and complete open orders before deactivating this branch');
    }
    patch.active = b.active ? 1 : 0;
  }
  await db.update(branches).set(patch).where(eq(branches.id, branch.id));
  await audit(db, tenantId, c.get('user').id, 'branch.update', 'branches', branch.id, { before: branch, changes: patch });
  return c.json({ ...branch, ...patch });
});
