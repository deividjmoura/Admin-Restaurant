/**
 * Redis client abstraction — issue: Redis para cache, rate-limit e pub/sub realtime.
 *
 * Se REDIS_URL não estiver configurado, usa fallback in-memory (mesmo processo).
 * Isso mantém a demo pública estável sem infra extra, mas permite escalar para
 * multi-instância quando Redis estiver disponível.
 *
 * API:
 *  - getRedis() -> client|null
 *  - cache: getCache(key), setCache(key, value, ttlMs), delCache(key)
 *  - pub/sub: publish(channel, payload), subscribe(channel, handler) -> unsubscribe
 *
 * Todas as chaves devem ser tenant-aware (ex.: menu:store:{storeId}).
 */

let redisClient = null;
let redisEnabled = false;
let initAttempted = false;

// In-memory fallback stores
const memoryCache = new Map(); // key -> { value, expiresAt }
const memoryPubSub = new Map(); // channel -> Set<handler>

function parseTtlMs(ttlMs) {
  const n = Number(ttlMs);
  return Number.isFinite(n) && n > 0 ? n : 60000;
}

export async function getRedis() {
  if (initAttempted) return redisClient;
  initAttempted = true;

  const url = process.env.REDIS_URL;
  const enabled = process.env.REDIS_ENABLED !== '0' && Boolean(url);

  if (!enabled) {
    return null;
  }

  try {
    // Lazy import to avoid hard dependency when not configured
    const { createClient } = await import('redis').catch(async () => {
      // Try ioredis as alternative
      const mod = await import('ioredis').catch(() => null);
      if (!mod) return null;
      return mod;
    });

    if (!createClient) {
      console.warn('[redis] REDIS_URL set but no redis client lib found (install redis or ioredis). Using memory fallback.');
      return null;
    }

    // Support both node-redis v4 and ioredis
    let client;
    if (typeof createClient === 'function' && createClient.name !== 'Redis') {
      // node-redis
      client = createClient({ url });
      client.on('error', (err) => {
        console.error('[redis] client error', err?.message);
      });
      await client.connect();
    } else {
      // ioredis - createClient is actually Redis class
      const Redis = createClient.default || createClient;
      client = new Redis(url, {
        maxRetriesPerRequest: 2,
        enableReadyCheck: true,
        lazyConnect: false,
      });
      client.on('error', (err) => {
        console.error('[redis] ioredis error', err?.message);
      });
    }

    redisClient = client;
    redisEnabled = true;
    console.info('[redis] connected', { url: url.replace(/:[^:@]*@/, ':***@') });
    return client;
  } catch (err) {
    console.warn('[redis] failed to connect, using memory fallback', err?.message);
    redisClient = null;
    redisEnabled = false;
    return null;
  }
}

export function isRedisEnabled() {
  return redisEnabled;
}

// --- Cache ---

export async function getCache(key) {
  const client = await getRedis();
  if (client) {
    try {
      const raw = await client.get(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

export async function setCache(key, value, ttlMs = 60000) {
  const client = await getRedis();
  const ttl = parseTtlMs(ttlMs);

  if (client) {
    try {
      // node-redis and ioredis both support SET with EX
      const payload = JSON.stringify(value);
      if (typeof client.set === 'function') {
        // Try EX option
        try {
          await client.set(key, payload, { EX: Math.ceil(ttl / 1000) });
        } catch {
          // ioredis style
          await client.set(key, payload, 'EX', Math.ceil(ttl / 1000));
        }
      }
      return;
    } catch (err) {
      console.warn('[redis] setCache failed, fallback to memory', err?.message);
    }
  }

  memoryCache.set(key, { value, expiresAt: Date.now() + ttl });
}

export async function delCache(key) {
  const client = await getRedis();
  if (client) {
    try {
      await client.del(key);
    } catch {}
  }
  memoryCache.delete(key);
}

export async function clearAllCache() {
  const client = await getRedis();
  if (client) {
    try {
      await client.flushDb();
    } catch {}
  }
  memoryCache.clear();
}

// --- Pub/Sub ---

export async function publish(channel, payload) {
  const client = await getRedis();
  const message = typeof payload === 'string' ? payload : JSON.stringify(payload);

  if (client) {
    try {
      await client.publish(channel, message);
      return;
    } catch (err) {
      console.warn('[redis] publish failed, using memory', err?.message);
    }
  }

  // Memory fallback
  const handlers = memoryPubSub.get(channel);
  if (!handlers) return;
  for (const fn of handlers) {
    try {
      fn(payload);
    } catch {}
  }
}

export async function subscribe(channel, handler) {
  const client = await getRedis();

  if (client) {
    try {
      // For node-redis v4, need duplicate client for subscriber
      let subClient = client;
      if (typeof client.duplicate === 'function') {
        subClient = client.duplicate();
        await subClient.connect();
      }

      await subClient.subscribe(channel, (message) => {
        try {
          const parsed = JSON.parse(message);
          handler(parsed);
        } catch {
          handler(message);
        }
      });

      return async () => {
        try {
          await subClient.unsubscribe(channel);
          if (subClient !== client) await subClient.quit();
        } catch {}
      };
    } catch (err) {
      console.warn('[redis] subscribe failed, using memory', err?.message);
    }
  }

  // Memory fallback
  if (!memoryPubSub.has(channel)) memoryPubSub.set(channel, new Set());
  memoryPubSub.get(channel).add(handler);

  return () => {
    const set = memoryPubSub.get(channel);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) memoryPubSub.delete(channel);
  };
}

// Test helpers
export function _resetForTests() {
  memoryCache.clear();
  memoryPubSub.clear();
  redisClient = null;
  redisEnabled = false;
  initAttempted = false;
}
