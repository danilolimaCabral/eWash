// Per-isolate TTL memo cache. Workers isolates are long-lived and handle many
// requests, so memoizing hot read paths (auth context, catalog) eliminates
// whole D1 round trips. Rules:
//   - short TTLs + explicit invalidation on every write path
//   - NEVER cache the sessions table (revocation must be instant)
//   - bounded size with simple LRU-ish eviction (Map preserves insert order)
const store = new Map();
const MAX_ENTRIES = 2000;

export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

export function cacheSet(key, value, ttlSeconds) {
  if (store.size >= MAX_ENTRIES) {
    store.delete(store.keys().next().value); // evict oldest insertion
  }
  store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

export function cacheDelete(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

// memoize an async producer
export async function cached(key, ttlSeconds, produce) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const value = await produce();
  cacheSet(key, value, ttlSeconds);
  return value;
}

export const authCacheKey = (userId) => `auth:${userId}`;
export const catalogCacheKey = (tenantId) => `catalog:${tenantId}`;
