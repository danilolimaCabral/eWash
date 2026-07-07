// Session lifecycle: short-lived access JWTs (carry the session id) + opaque
// rotating refresh tokens stored only as SHA-256 hashes. Rotation with reuse
// detection: presenting a stale refresh token revokes the whole session.
// last_seen_at heartbeats (throttled) power online/offline presence.
import { eq, and, isNull, sql } from 'drizzle-orm';
import { sessions } from './db/schema.js';
import { signJwt } from './auth.js';
import { uid, now, ApiError } from './util.js';

export const ACCESS_TTL_SECONDS = 15 * 60;       // access JWT
export const REFRESH_TTL_DAYS = 30;              // absolute session lifetime
export const ONLINE_WINDOW_MINUTES = 2;          // "online" = seen within this
const HEARTBEAT_THROTTLE_SECONDS = 60;           // min gap between last_seen writes

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function hashToken(token) {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

const newRefreshToken = () => b64url(crypto.getRandomValues(new Uint8Array(48)));

const expiryFromNow = () =>
  new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000).toISOString().slice(0, 19).replace('T', ' ');

export async function issueSession(db, env, user, { ip = null, userAgent = null } = {}) {
  const refreshToken = newRefreshToken();
  const session = {
    id: uid(),
    userId: user.id,
    tenantId: user.tenantId,
    refreshTokenHash: await hashToken(refreshToken),
    ip,
    userAgent: userAgent ? userAgent.slice(0, 250) : null,
    expiresAt: expiryFromNow(),
  };
  await db.insert(sessions).values(session);
  const token = await signJwt({ uid: user.id, tid: user.tenantId, sid: session.id }, env.JWT_SECRET, ACCESS_TTL_SECONDS);
  return { token, refreshToken, sessionId: session.id };
}

// Rotate: valid refresh token → new access + refresh pair. A stale token for
// an active session means theft/replay — revoke the session outright.
export async function refreshSession(db, env, sessionId, refreshToken) {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  const deny = () => { throw new ApiError(401, 'Session expired — please sign in again'); };
  if (!session || session.revokedAt || session.expiresAt <= now()) deny();
  if (session.refreshTokenHash !== await hashToken(refreshToken)) {
    await db.update(sessions).set({ revokedAt: now() }).where(eq(sessions.id, session.id));
    deny();
  }
  const nextToken = newRefreshToken();
  await db.update(sessions)
    .set({ refreshTokenHash: await hashToken(nextToken), lastSeenAt: now() })
    .where(eq(sessions.id, session.id));
  const token = await signJwt(
    { uid: session.userId, tid: session.tenantId, sid: session.id },
    env.JWT_SECRET,
    ACCESS_TTL_SECONDS
  );
  return { token, refreshToken: nextToken, userId: session.userId };
}

export async function revokeSession(db, sessionId) {
  await db.update(sessions).set({ revokedAt: now() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

// Validates the session behind an access token (instant revocation) and
// heartbeats last_seen_at at most once per throttle window.
export async function touchSession(db, sessionId) {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session || session.revokedAt || session.expiresAt <= now()) return null;
  await db.update(sessions)
    .set({ lastSeenAt: now() })
    .where(and(
      eq(sessions.id, sessionId),
      sql`${sessions.lastSeenAt} < datetime('now', '-${sql.raw(String(HEARTBEAT_THROTTLE_SECONDS))} seconds')`,
    ));
  return session;
}

// Presence for a tenant. presenceQuery is batchable (db.batch); presenceMap
// converts rows to userId → { online, lastSeenAt }.
export function presenceQuery(db, tenantId) {
  return db.select({
    userId: sessions.userId,
    lastSeen: sql`max(${sessions.lastSeenAt})`.as('last_seen'),
    online: sql`max(case when ${sessions.revokedAt} is null and ${sessions.expiresAt} > datetime('now')
      and ${sessions.lastSeenAt} > datetime('now', '-${sql.raw(String(ONLINE_WINDOW_MINUTES))} minutes')
      then 1 else 0 end)`.as('online'),
  }).from(sessions)
    .where(eq(sessions.tenantId, tenantId))
    .groupBy(sessions.userId);
}

export const presenceMap = (rows) =>
  new Map(rows.map((r) => [r.userId, { online: r.online === 1, lastSeenAt: r.lastSeen }]));
