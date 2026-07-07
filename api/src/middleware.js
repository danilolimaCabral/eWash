import { and, eq, sql } from 'drizzle-orm';
import { verifyJwt } from './auth.js';
import { getDb } from './db/index.js';
import { users, roles, rolePolicies, userPolicyOverrides, tenants, sessions, branches } from './db/schema.js';
import { effectivePolicies } from './policies.js';
import { ApiError, forbidden, now, SUPPORT_EMAIL } from './util.js';
import { cached, authCacheKey } from './cache.js';

const HEARTBEAT_THROTTLE_SECONDS = 60;
const AUTH_CACHE_TTL_SECONDS = 60;

async function loadAuthContext(db, uid) {
  const [[user], [role], rp, overrides] = await db.batch([
    db.select().from(users).where(eq(users.id, uid)),
    db.select({ id: roles.id, name: roles.name, isSystem: roles.isSystem })
      .from(roles).innerJoin(users, eq(users.roleId, roles.id)).where(eq(users.id, uid)),
    db.select({ policyKey: rolePolicies.policyKey, allow: rolePolicies.allow })
      .from(rolePolicies).innerJoin(users, eq(users.roleId, rolePolicies.roleId)).where(eq(users.id, uid)),
    db.select().from(userPolicyOverrides).where(eq(userPolicyOverrides.userId, uid)),
  ]);
  if (!user) return null;
  return {
    user, role,
    policies: effectivePolicies(rp.filter((p) => p.allow).map((p) => p.policyKey), overrides),
  };
}

// Bearer-token auth — the hottest path in the API.
// The auth context (user/tenant/role/policies) is memoized per isolate for a
// short TTL and invalidated on user/permission writes; the SESSION row is
// always read live so server-side revocation is instant. Net cost per request
// once warm: one indexed point-read. The last_seen presence heartbeat is
// throttled and deferred off the request path.
export async function authRequired(c, next) {
  const token = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
  const payload = await verifyJwt(token, c.env.JWT_SECRET);
  if (!payload || !payload.sid) throw new ApiError(401, 'Not signed in');

  const db = getDb(c.env);
  // session AND tenant status are always read live (one batched round trip):
  // both are kill switches — logout/revocation and tenant disable must take
  // effect immediately, never after a cache TTL.
  const [[[session], [tenant]], ctx] = await Promise.all([
    db.batch([
      db.select().from(sessions).where(eq(sessions.id, payload.sid)),
      db.select().from(tenants).where(eq(tenants.id, payload.tid)),
    ]),
    cached(authCacheKey(payload.uid), AUTH_CACHE_TTL_SECONDS, () => loadAuthContext(db, payload.uid)),
  ]);

  if (!ctx || ctx.user.status !== 'active') throw new ApiError(401, 'Account not active');
  if (!session || session.userId !== ctx.user.id || session.revokedAt || session.expiresAt <= now()) {
    throw new ApiError(401, 'Session expired — please sign in again');
  }
  if (!tenant || tenant.status !== 'active' || tenant.id !== ctx.user.tenantId) {
    throw new ApiError(403, `This business account is disabled. Contact support at ${SUPPORT_EMAIL}`);
  }
  if (ctx.user.accessScope === 'branch') {
    const [branch] = await db.select({ id: branches.id }).from(branches)
      .where(and(eq(branches.id, ctx.user.branchId), eq(branches.tenantId, tenant.id), eq(branches.active, 1)));
    if (!branch) throw new ApiError(403, 'Your account is not assigned to an active branch');
  }

  // presence heartbeat: throttled and off the critical path
  c.executionCtx.waitUntil(
    db.update(sessions)
      .set({ lastSeenAt: now() })
      .where(sql`${sessions.id} = ${session.id} and ${sessions.lastSeenAt} < datetime('now', '-${sql.raw(String(HEARTBEAT_THROTTLE_SECONDS))} seconds')`)
      .catch(() => {})
  );

  c.set('db', db);
  c.set('user', ctx.user);
  c.set('tenant', tenant);
  c.set('role', ctx.role);
  c.set('sessionId', session.id);
  c.set('policies', new Set(ctx.policies));
  await next();
}

export const requirePolicy = (key) => async (c, next) => {
  if (!c.get('policies').has(key)) forbidden(`Missing permission: ${key}`);
  await next();
};
