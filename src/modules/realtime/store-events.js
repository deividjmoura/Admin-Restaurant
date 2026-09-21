/**
 * Pub/sub for store-scoped events.
 * Channel: store:{storeId}:orders
 *
 * Single-instance: in-memory Map.
 * Multi-instance (Phase 9): Redis pub/sub when REDIS_URL is set.
 *
 * Observabilidade: gauge de assinantes por loja/estação e contador de eventos.
 */
import {
  realtimeSubscribers,
  realtimeEventsTotal,
} from '../../infrastructure/metrics.js';
import { publish as redisPublish, subscribe as redisSubscribe, getRedis } from '../../infrastructure/redis.js';

const listeners = new Map(); // storeId -> Set<fn>
const subscribersByStation = new Map(); // `${storeId}:${station}` -> count
const redisUnsubs = new Map(); // storeId -> unsubscribe fn
const redisSubscribersSetup = new Set(); // storeId already subscribed to Redis

function channelKey(storeId) {
  return String(storeId);
}

function redisChannel(storeId) {
  return `store:${storeId}:orders`;
}

function stationKey(storeId, station) {
  return `${channelKey(storeId)}:${station || 'all'}`;
}

function bumpStation(storeId, station, delta) {
  const key = stationKey(storeId, station);
  const next = Math.max(0, (subscribersByStation.get(key) || 0) + delta);
  if (next === 0) subscribersByStation.delete(key);
  else subscribersByStation.set(key, next);
  try {
    realtimeSubscribers.set(
      { store_id: channelKey(storeId), station: station || 'all' },
      next
    );
  } catch {}
}

function dispatchLocal(storeId, payload) {
  const set = listeners.get(channelKey(storeId));
  if (!set || set.size === 0) return;
  for (const listener of set) {
    try {
      listener(payload);
    } catch (err) {
      console.error('[store-events] listener error', {
        channel: payload.channel,
        type: payload.type,
        message: err?.message,
      });
    }
  }
}

async function ensureRedisSubscription(storeId) {
  if (redisSubscribersSetup.has(storeId)) return;
  const client = await getRedis();
  if (!client) return; // no Redis, in-memory only

  redisSubscribersSetup.add(storeId);
  try {
    const unsub = await redisSubscribe(redisChannel(storeId), (payload) => {
      // Payload from Redis is already parsed (or raw). Ensure storeId matches.
      const data = typeof payload === 'string' ? (() => { try { return JSON.parse(payload); } catch { return { raw: payload }; } })() : payload;
      // If payload already has channel, keep it; otherwise add
      const enriched = {
        channel: data.channel || redisChannel(storeId),
        storeId: String(data.storeId || storeId),
        ...data,
        at: data.at || new Date().toISOString(),
        _fromRedis: true,
      };
      dispatchLocal(storeId, enriched);
    });
    redisUnsubs.set(storeId, unsub);
  } catch (err) {
    console.warn('[store-events] redis subscribe failed', err?.message);
    redisSubscribersSetup.delete(storeId);
  }
}

export function subscribeStoreOrders(storeId, listener, opts = {}) {
  const key = channelKey(storeId);
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(listener);
  bumpStation(storeId, opts.station, 1);

  // Ensure Redis subscription for cross-instance events (fire-and-forget)
  ensureRedisSubscription(storeId).catch(() => {});

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const set = listeners.get(key);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        listeners.delete(key);
        // Cleanup Redis sub when no more local listeners
        const unsub = redisUnsubs.get(storeId);
        if (unsub) {
          unsub().catch(() => {});
          redisUnsubs.delete(storeId);
          redisSubscribersSetup.delete(storeId);
        }
      }
    }
    bumpStation(storeId, opts.station, -1);
  };
}

export function getSubscriberCount(storeId) {
  const key = channelKey(storeId);
  return listeners.get(key)?.size ?? 0;
}

export function getSubscriberBreakdown() {
  return [...subscribersByStation.entries()].map(([key, count]) => {
    const idx = key.lastIndexOf(':');
    return { storeId: key.slice(0, idx), station: key.slice(idx + 1), count };
  });
}

export const EVENT_PERMISSIONS = {
  'payment.created': 'payments.read',
  'payment.paid': 'payments.read',
  'payment.updated': 'payments.read',
  'session.closed': 'cashier.sessions.read',
  'cash.session_opened': 'cashier.cash.read',
  'cash.movement_recorded': 'cashier.cash.read',
  'cash.session_closed': 'cashier.cash.read',
};

export async function publishStoreOrderEvent(storeId, event) {
  const payload = {
    channel: `store:${storeId}:orders`,
    storeId: String(storeId),
    ...event,
    at: new Date().toISOString(),
  };

  try {
    realtimeEventsTotal.inc({
      store_id: String(storeId),
      type: payload.type || 'order',
    });
  } catch {}

  const client = await getRedis();
  if (client) {
    // Multi-instance: publish to Redis, local dispatch will happen via Redis subscription
    // But also dispatch locally immediately for same-process low latency
    // To avoid double delivery in same process when Redis echoes back,
    // we tag with _fromRedis and the Redis subscriber will dispatch.
    // Here we publish to Redis and also dispatch locally (once) for this process.
    try {
      await redisPublish(redisChannel(storeId), payload);
    } catch (err) {
      console.warn('[store-events] redis publish failed, fallback to local', err?.message);
    }
    // Dispatch locally for immediate feedback (same process)
    dispatchLocal(storeId, payload);
  } else {
    // Single-instance
    dispatchLocal(storeId, payload);
  }
}

// Sync version for backward compat (used in some routes that don't await)
export function publishStoreOrderEventSync(storeId, event) {
  const payload = {
    channel: `store:${storeId}:orders`,
    storeId: String(storeId),
    ...event,
    at: new Date().toISOString(),
  };
  try {
    realtimeEventsTotal.inc({
      store_id: String(storeId),
      type: payload.type || 'order',
    });
  } catch {}
  dispatchLocal(storeId, payload);
  // Fire-and-forget Redis
  redisPublish(redisChannel(storeId), payload).catch(() => {});
}

export function canReceiveEvent(payload, subscriber) {
  if (String(payload?.storeId) !== String(subscriber.storeId)) return false;

  const required = EVENT_PERMISSIONS[payload.type];
  if (required) {
    const perms = subscriber.permissions;
    const has = perms instanceof Set ? perms.has(required) : (perms || []).includes(required);
    if (!has) return false;
  }

  const stations = payload.stations || [];
  if (subscriber.station && stations.length > 0 && !stations.includes(subscriber.station)) {
    return false;
  }

  return true;
}

// Test helper
export function _resetForTests() {
  listeners.clear();
  subscribersByStation.clear();
  redisUnsubs.forEach((unsub) => {
    try { unsub(); } catch {}
  });
  redisUnsubs.clear();
  redisSubscribersSetup.clear();
}
