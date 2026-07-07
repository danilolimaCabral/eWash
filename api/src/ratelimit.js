// D1-backed fixed-window rate limiter — holds across worker isolates, unlike
// in-memory counters. Fails CLOSED on the caller's decision: callers throw 429
// when this returns false.
import { sql } from 'drizzle-orm';
import { rateLimits } from './db/schema.js';
import { ApiError } from './util.js';

export async function rateLimit(db, key, limit, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  // One atomic upsert: reset the window if stale, else increment.
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} = ${windowStart} then ${rateLimits.count} + 1 else 1 end`,
        windowStart,
      },
    })
    .returning({ count: rateLimits.count });
  return row.count <= limit;
}

export async function enforceRateLimit(db, key, limit, windowSeconds, message) {
  if (!(await rateLimit(db, key, limit, windowSeconds))) {
    throw new ApiError(429, message || 'Too many attempts — please wait a moment and try again');
  }
}

export const clientIp = (c) =>
  c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
