import { Hono } from 'hono';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { tenants, branches, users, roles, rolePolicies, userPolicyOverrides, passwordResetTokens, sessions } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth.js';
import { seedTenant } from '../seed.js';
import { uid, now, bad, audit, ApiError, SUPPORT_EMAIL } from '../util.js';
import { effectivePolicies, POLICIES } from '../policies.js';
import { enforceRateLimit, clientIp } from '../ratelimit.js';
import { cleanStr, checkPassword, LIMITS } from '../security.js';
import { issueSession, refreshSession, revokeSession } from '../session.js';
import { issuePasswordReset, passwordResetTokenHash } from '../passwordReset.js';

export const authRoutes = new Hono();
const genericResetMessage = 'If an account exists for that email, a password reset link has been sent.';

// The client holds one opaque refresh credential: "<sessionId>.<secret>".
async function sessionResponse(db, env, c, user) {
  const { token, refreshToken, sessionId } = await issueSession(db, env, user, {
    ip: clientIp(c),
    userAgent: c.req.header('User-Agent') || null,
  });
  return { token, refresh_token: `${sessionId}.${refreshToken}` };
}

// Tenant onboarding wizard (spec §3): business → branch → template catalog →
// owner account. One call, live in under a minute.
// Rate limits are strict in production; relaxed (×20) in development so local
// testing doesn't trip them.
const rlMult = (c) => (c.env.ENVIRONMENT === 'production' ? 1 : 20);

authRoutes.post('/register', async (c) => {
  const db = getDb(c.env);
  // tenant creation is expensive and abusable — tight per-IP limit
  await enforceRateLimit(db, `register:ip:${clientIp(c)}`, 5 * rlMult(c), 3600,
    'Too many sign-ups from this network — please try again later');

  const b = await c.req.json();
  for (const f of ['business_name', 'branch_name', 'name', 'email', 'password']) {
    if (!b[f]?.trim?.()) bad(`Missing field: ${f}`);
  }
  checkPassword(b.password);
  b.business_name = cleanStr(b.business_name, LIMITS.name, 'Business name');
  b.branch_name = cleanStr(b.branch_name, LIMITS.name, 'Branch name');
  b.name = cleanStr(b.name, LIMITS.name, 'Name');
  b.phone = cleanStr(b.phone, LIMITS.phone, 'Phone');

  const email = cleanStr(b.email, LIMITS.email, 'Email').toLowerCase();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing.length) bad('An account with this email already exists');

  const tenantId = uid();
  await db.insert(tenants).values({
    id: tenantId,
    name: b.business_name.trim(),
    codePrefix: (b.code_prefix || b.business_name.trim().slice(0, 2)).toUpperCase().replace(/[^A-Z]/g, '') || 'WK',
    orderSeq: 0, // tags count from 0001
  });

  const branchId = uid();
  await db.insert(branches).values({
    id: branchId, tenantId, name: b.branch_name.trim(), location: b.branch_location || null,
  });

  const { roleIds } = await seedTenant(db, tenantId);

  const userId = uid();
  await db.insert(users).values({
    id: userId,
    tenantId,
    branchId,
    roleId: roleIds['Owner/Admin'],
    accessScope: 'tenant',
    name: b.name.trim(),
    phone: b.phone || null,
    email,
    passwordHash: await hashPassword(b.password),
  });

  return c.json(await sessionResponse(db, c.env, c, { id: userId, tenantId }), 201);
});

authRoutes.post('/login', async (c) => {
  const { email, password } = await c.req.json();
  if (!email || !password) bad('Email and password are required');
  if (typeof password !== 'string' || password.length > LIMITS.password) bad('Invalid email or password');
  const db = getDb(c.env);
  const normEmail = cleanStr(email, LIMITS.email, 'Email').toLowerCase();
  // brute-force protection: per-IP and per-account windows (D1-backed)
  await enforceRateLimit(db, `login:ip:${clientIp(c)}`, 20 * rlMult(c), 300,
    'Too many login attempts from this network — wait a few minutes');
  await enforceRateLimit(db, `login:email:${normEmail}`, 8 * rlMult(c), 900,
    'Too many attempts for this account — wait 15 minutes');

  const [user] = await db.select().from(users).where(eq(users.email, normEmail));
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError(401, 'Invalid email or password');
  }
  if (user.status !== 'active') throw new ApiError(403, 'This account has been deactivated');
  // tenant-level kill switch: a disabled business cannot sign in at all
  const [tenant] = await db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, user.tenantId));
  if (!tenant || tenant.status !== 'active') {
    throw new ApiError(403, `This business account is disabled. Contact support at ${SUPPORT_EMAIL}`);
  }
  return c.json(await sessionResponse(db, c.env, c, user));
});

authRoutes.post('/forgot-password', async (c) => {
  const db = getDb(c.env);
  const email = cleanStr((await c.req.json()).email, LIMITS.email, 'Email')?.toLowerCase();
  await enforceRateLimit(db, `password-reset:ip:${clientIp(c)}`, 5 * rlMult(c), 3600,
    'Too many reset requests — please try again later');
  if (!email) return c.json({ message: genericResetMessage });
  await enforceRateLimit(db, `password-reset:email:${email}`, 3 * rlMult(c), 3600,
    'Too many reset requests — please try again later');
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user || user.status !== 'active') return c.json({ message: genericResetMessage });

  await issuePasswordReset(db, c.env, user, clientIp(c));
  return c.json({ message: genericResetMessage });
});

authRoutes.post('/reset-password', async (c) => {
  const db = getDb(c.env);
  await enforceRateLimit(db, `password-reset-submit:ip:${clientIp(c)}`, 10 * rlMult(c), 900,
    'Too many reset attempts — please try again later');
  const { token, password } = await c.req.json();
  if (typeof token !== 'string' || token.length < 32) bad('Invalid or expired reset link');
  checkPassword(password);
  const [reset] = await db.select().from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tokenHash, await passwordResetTokenHash(token)), isNull(passwordResetTokens.usedAt)));
  if (!reset || reset.expiresAt < now()) bad('Invalid or expired reset link');
  const consumed = await db.update(passwordResetTokens).set({ usedAt: now() })
    .where(and(eq(passwordResetTokens.id, reset.id), isNull(passwordResetTokens.usedAt)))
    .returning({ id: passwordResetTokens.id });
  if (!consumed.length) bad('Invalid or expired reset link');
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, reset.userId));
  await db.update(sessions).set({ revokedAt: now() }).where(eq(sessions.userId, reset.userId));
  const [user] = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, reset.userId));
  if (user) await audit(db, user.tenantId, reset.userId, 'password.reset', 'users', reset.userId, {});
  return c.json({ ok: true });
});

// Rotate the refresh token → fresh access + refresh pair. Reuse of an old
// refresh token revokes the session (theft detection).
authRoutes.post('/refresh', async (c) => {
  const db = getDb(c.env);
  await enforceRateLimit(db, `refresh:ip:${clientIp(c)}`, 60 * rlMult(c), 300);
  const { refresh_token } = await c.req.json();
  const [sessionId, secret] = String(refresh_token || '').split('.');
  if (!sessionId || !secret) throw new ApiError(401, 'Session expired — please sign in again');
  const { token, refreshToken, userId } = await refreshSession(db, c.env, sessionId, secret);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.status !== 'active') throw new ApiError(401, 'Account is not active');
  const [tenant] = await db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, user.tenantId));
  if (!tenant || tenant.status !== 'active') {
    throw new ApiError(403, `This business account is disabled. Contact support at ${SUPPORT_EMAIL}`);
  }
  return c.json({ token, refresh_token: `${sessionId}.${refreshToken}` });
});

// Server-side sign-out: the session is revoked immediately on all devices
// holding its tokens.
authRoutes.post('/logout', async (c) => {
  const db = getDb(c.env);
  const { refresh_token } = await c.req.json().catch(() => ({}));
  const [sessionId] = String(refresh_token || '').split('.');
  if (sessionId) await revokeSession(db, sessionId);
  return c.json({ ok: true });
});

// Idle-lock unlock: re-verify the signed-in user's password. Authenticated
// (mounted behind authRequired) and rate-limited — a lock screen must not be
// a password-guessing oracle.
export async function unlockHandler(c) {
  const db = c.get('db');
  const user = c.get('user');
  const { password } = await c.req.json();
  if (typeof password !== 'string' || password.length > LIMITS.password) {
    throw new ApiError(401, 'Wrong password');
  }
  await enforceRateLimit(db, `unlock:user:${user.id}`, 5, 300,
    'Too many unlock attempts — wait 5 minutes or sign out');
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError(401, 'Wrong password');
  }
  return c.json({ ok: true });
}

// Session bootstrap for the SPA: who am I, what can I do, which branches exist.
export async function meHandler(c) {
  const db = c.get('db');
  const user = c.get('user');
  const tenant = c.get('tenant');
  const role = c.get('role');
  const branchList = await db.select().from(branches).where(
    user.accessScope === 'tenant'
      ? eq(branches.tenantId, tenant.id)
      : and(eq(branches.tenantId, tenant.id), eq(branches.id, user.branchId))
  );
  return c.json({
    user: {
      id: user.id, name: user.name, email: user.email, phone: user.phone, branchId: user.branchId,
      accessScope: user.accessScope,
      // google-only accounts have no usable password (lock screen adapts)
      hasPassword: user.passwordHash !== 'google-only',
      googleLinked: !!user.googleSub,
    },
    role: { id: role.id, name: role.name },
    tenant: {
      id: tenant.id, name: tenant.name, plan: tenant.plan, currency: tenant.currency,
      codePrefix: tenant.codePrefix, settings: JSON.parse(tenant.settings || '{}'),
    },
    branches: branchList,
    policies: [...c.get('policies')],
    policyCatalog: POLICIES.map(([key, label]) => ({ key, label })),
  });
}
