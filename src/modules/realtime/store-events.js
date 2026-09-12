/**
 * In-process pub/sub for store-scoped events.
 * Channel: store:{storeId}:orders
 *
 * Single-instance only. Multi-node → Redis pub/sub later (same channel name).
 */

const listeners = new Map(); // storeId -> Set<fn>

function channelKey(storeId) {
  return String(storeId);
}

export function subscribeStoreOrders(storeId, listener) {
  const key = channelKey(storeId);
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(listener);

  return () => {
    const set = listeners.get(key);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

export function publishStoreOrderEvent(storeId, event) {
  const set = listeners.get(channelKey(storeId));
  if (!set || set.size === 0) return;

  const payload = {
    channel: `store:${storeId}:orders`,
    ...event,
    at: new Date().toISOString(),
  };

  for (const listener of set) {
    try {
      listener(payload);
    } catch (err) {
      console.error('store event listener error', err);
    }
  }
}
