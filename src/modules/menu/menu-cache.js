/**
 * In-memory menu cache, always keyed by store_id.
 * Never share entries across tenants.
 *
 * Phase 9: Redis L2 when REDIS_URL is set (fire-and-forget for sync path,
 * awaitable via async helpers).
 * Key shape: menu:store:{storeId}
 */

const store = new Map(); // key -> { expiresAt, payload }

const DEFAULT_TTL_MS = Number(process.env.MENU_CACHE_TTL_MS) || 60_000;

function keyFor(storeId) {
  return `menu:store:${storeId}`;
}

export function getCachedMenu(storeId) {
  const key = keyFor(storeId);
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.payload;
}

export function setCachedMenu(storeId, payload, ttlMs = DEFAULT_TTL_MS) {
  store.set(keyFor(storeId), {
    payload,
    expiresAt: Date.now() + ttlMs,
  });
  // Fire-and-forget Redis L2
  import('../../infrastructure/redis.js')
    .then(({ setCache }) => setCache(keyFor(storeId), payload, ttlMs))
    .catch(() => {});
}

export function invalidateMenuCache(storeId) {
  store.delete(keyFor(storeId));
  import('../../infrastructure/redis.js')
    .then(({ delCache }) => delCache(keyFor(storeId)))
    .catch(() => {});
}

export function clearAllMenuCache() {
  store.clear();
  import('../../infrastructure/redis.js')
    .then(({ clearAllCache }) => clearAllCache())
    .catch(() => {});
}

// Async helpers (Redis-aware)
export async function getCachedMenuAsync(storeId) {
  const sync = getCachedMenu(storeId);
  if (sync) return sync;
  try {
    const { getCache } = await import('../../infrastructure/redis.js');
    const cached = await getCache(keyFor(storeId));
    if (cached) {
      store.set(keyFor(storeId), { payload: cached, expiresAt: Date.now() + DEFAULT_TTL_MS });
      return cached;
    }
  } catch {}
  return null;
}

export async function setCachedMenuAsync(storeId, payload, ttlMs = DEFAULT_TTL_MS) {
  setCachedMenu(storeId, payload, ttlMs);
  try {
    const { setCache } = await import('../../infrastructure/redis.js');
    await setCache(keyFor(storeId), payload, ttlMs);
  } catch {}
}

export async function invalidateMenuCacheAsync(storeId) {
  invalidateMenuCache(storeId);
  try {
    const { delCache } = await import('../../infrastructure/redis.js');
    await delCache(keyFor(storeId));
  } catch {}
}

// Compat aliases
export const getCachedMenuSync = getCachedMenu;
export const setCachedMenuSync = setCachedMenu;
export const invalidateMenuCacheSync = invalidateMenuCache;
export const clearAllMenuCacheSync = clearAllMenuCache;
