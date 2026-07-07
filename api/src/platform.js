import { and, eq, isNull } from 'drizzle-orm';
import { verifyJwt, signJwt } from './auth.js';
import { getDb } from './db/index.js';
import { platformSessions, platformUsers } from './db/schema.js';
import { hashToken } from './session.js';
import { ApiError, forbidden, now, uid } from './util.js';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_DAYS = 30;

export const PLATFORM_POLICIES = {
  platform_owner: ['platform.dashboard.view', 'platform.tenants.view', 'platform.tenants.manage', 'platform.billing.view', 'platform.billing.manage', 'platform.audit.view'],
  platform_admin: ['platform.dashboard.view', 'platform.tenants.view', 'platform.tenants.manage', 'platform.billing.view', 'platform.billing.manage', 'platform.audit.view'],
  platform_billing: ['platform.dashboard.view', 'platform.tenants.view', 'platform.billing.view', 'platform.billing.manage'],
};

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const refreshSecret = () => b64url(crypto.getRandomValues(new Uint8Array(48)));
const expiry = () => new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000).toISOString().slice(0, 19).replace('T', ' ');

export async function issuePlatformSession(db, env, user, request = {}) {
  const secret = refreshSecret();
  const session = {
    id: uid(),
    userId: user.id,
    refreshTokenHash: await hashToken(secret),
    ip: request.ip || null,
    userAgent: request.userAgent?.slice(0, 250) || null,
    expiresAt: expiry(),
  };
  await db.insert(platformSessions).values(session);
  const token = await signJwt({ puid: user.id, psid: session.id, actor: 'platform' }, env.JWT_SECRET, ACCESS_TTL_SECONDS);
  return { token, refresh_token: `${session.id}.${secret}` };
}

export async function platformAuthRequired(c, next) {
  const token = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
  const payload = await verifyJwt(token, c.env.JWT_SECRET);
  if (!payload?.puid || !payload?.psid || payload.actor !== 'platform') throw new ApiError(401, 'Not signed in');
  const db = getDb(c.env);
  const [[user], [session]] = await db.batch([
    db.select().from(platformUsers).where(eq(platformUsers.id, payload.puid)),
    db.select().from(platformSessions).where(eq(platformSessions.id, payload.psid)),
  ]);
  if (!user || user.status !== 'active') throw new ApiError(401, 'Account not active');
  if (!session || session.userId !== user.id || session.revokedAt || session.expiresAt <= now()) {
    throw new ApiError(401, 'Session expired — please sign in again');
  }
  c.set('db', db);
  c.set('platformUser', user);
  c.set('platformSessionId', session.id);
  c.set('platformPolicies', new Set(PLATFORM_POLICIES[user.role] || []));
  await next();
}

export const requirePlatformPolicy = (key) => async (c, next) => {
  if (!c.get('platformPolicies').has(key)) forbidden(`Missing permission: ${key}`);
  await next();
};

export async function rotatePlatformSession(db, env, refreshToken) {
  const [sessionId, secret] = String(refreshToken || '').split('.');
  if (!sessionId || !secret) throw new ApiError(401, 'Session expired — please sign in again');
  const [session] = await db.select().from(platformSessions).where(eq(platformSessions.id, sessionId));
  if (!session || session.revokedAt || session.expiresAt <= now() || session.refreshTokenHash !== await hashToken(secret)) {
    if (session) await db.update(platformSessions).set({ revokedAt: now() }).where(eq(platformSessions.id, session.id));
    throw new ApiError(401, 'Session expired — please sign in again');
  }
  const nextSecret = refreshSecret();
  await db.update(platformSessions).set({ refreshTokenHash: await hashToken(nextSecret), lastSeenAt: now() })
    .where(eq(platformSessions.id, session.id));
  const token = await signJwt({ puid: session.userId, psid: session.id, actor: 'platform' }, env.JWT_SECRET, ACCESS_TTL_SECONDS);
  return { token, refresh_token: `${session.id}.${nextSecret}` };
}

export async function revokePlatformSession(db, sessionId) {
  if (!sessionId) return;
  await db.update(platformSessions).set({ revokedAt: now() })
    .where(and(eq(platformSessions.id, sessionId), isNull(platformSessions.revokedAt)));
}
