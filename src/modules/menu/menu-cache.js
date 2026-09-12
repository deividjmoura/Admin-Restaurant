/**
 * In-memory menu cache, always keyed by store_id.
 * Never share entries across tenants.
 *
 * Later (Phase 9) this can be swapped for Redis with the same key shape:
 *   menu:store:{storeId}
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
}

/** Invalidate one store (call after any menu mutation). */
export function invalidateMenuCache(storeId) {
  store.delete(keyFor(storeId));
}

/** Test / ops helper — does not clear other process memory. */
export function clearAllMenuCache() {
  store.clear();
}
