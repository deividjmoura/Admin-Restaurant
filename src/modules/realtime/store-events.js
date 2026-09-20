/**
 * In-process pub/sub for store-scoped events.
 * Channel: store:{storeId}:orders
 *
 * Single-instance only. Multi-node → Redis pub/sub later (same channel name).
 *
 * Observabilidade (issue #106): gauge de assinantes por loja/estação e contador
 * de eventos publicados — é o que responde "a cozinha está recebendo tempo
 * real?" sem precisar logar payload.
 */
import {
  realtimeSubscribers,
  realtimeEventsTotal,
} from '../../infrastructure/metrics.js';

const listeners = new Map(); // storeId -> Set<fn>

/** Assinantes por (loja, estação) — usado para o gauge de SSE. */
const subscribersByStation = new Map(); // `${storeId}:${station}` -> count

function channelKey(storeId) {
  return String(storeId);
}

function stationKey(storeId, station) {
  return `${channelKey(storeId)}:${station || 'all'}`;
}

function bumpStation(storeId, station, delta) {
  const key = stationKey(storeId, station);
  const next = Math.max(0, (subscribersByStation.get(key) || 0) + delta);
  if (next === 0) subscribersByStation.delete(key);
  else subscribersByStation.set(key, next);
  realtimeSubscribers.set(
    { store_id: channelKey(storeId), station: station || 'all' },
    next
  );
}

/**
 * Assina o canal da loja.
 *
 * @param {string} storeId
 * @param {(payload: object) => void} listener
 * @param {{ station?: string|null }} [opts] estação do painel (rótulo de métrica)
 * @returns {() => void} unsubscribe
 */
export function subscribeStoreOrders(storeId, listener, opts = {}) {
  const key = channelKey(storeId);
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(listener);
  bumpStation(storeId, opts.station, 1);

  let active = true;
  return () => {
    if (!active) return; // unsubscribe idempotente (close + error do SSE)
    active = false;
    const set = listeners.get(key);
    if (set) {
      set.delete(listener);
      if (set.size === 0) listeners.delete(key);
    }
    bumpStation(storeId, opts.station, -1);
  };
}

/** Assinantes ativos da loja (todas as estações somadas). */
export function getSubscriberCount(storeId) {
  const key = channelKey(storeId);
  return listeners.get(key)?.size ?? 0;
}

/** Assinantes ativos por estação — diagnóstico e teste de isolamento. */
export function getSubscriberBreakdown() {
  return [...subscribersByStation.entries()].map(([key, count]) => {
    const idx = key.lastIndexOf(':');
    return { storeId: key.slice(0, idx), station: key.slice(idx + 1), count };
  });
}

/** Tipos de evento que exigem permissão adicional para chegar ao painel. */
export const EVENT_PERMISSIONS = {
  'payment.created': 'payments.read',
  'payment.paid': 'payments.read',
  'payment.updated': 'payments.read',
  'session.closed': 'cashier.sessions.read',
  'cash.session_opened': 'cashier.cash.read',
  'cash.movement_recorded': 'cashier.cash.read',
  'cash.session_closed': 'cashier.cash.read',
};

export function publishStoreOrderEvent(storeId, event) {
  const payload = {
    channel: `store:${storeId}:orders`,
    // storeId explícito no payload: o assinante confere que o evento é do
    // tenant dele antes de renderizar (defesa em profundidade contra um
    // publish com chave errada).
    storeId: String(storeId),
    ...event,
    at: new Date().toISOString(),
  };

  realtimeEventsTotal.inc({
    store_id: String(storeId),
    type: payload.type || 'order',
  });

  const set = listeners.get(channelKey(storeId));
  if (!set || set.size === 0) return;

  for (const listener of set) {
    try {
      listener(payload);
    } catch (err) {
      // Nunca derrubar o publisher por causa de um assinante; e nunca engolir
      // em silêncio: registra com contexto.
      console.error('[store-events] listener error', {
        channel: payload.channel,
        type: payload.type,
        message: err?.message,
      });
    }
  }
}

/**
 * Decide se um evento pode ser entregue a um assinante do canal da loja.
 * Sem permissão para o tipo do evento → não entrega.
 *
 * @param {object} payload
 * @param {{ storeId: string, station?: string|null, permissions?: Set<string>|string[] }} subscriber
 */
export function canReceiveEvent(payload, subscriber) {
  if (String(payload?.storeId) !== String(subscriber.storeId)) return false;

  const required = EVENT_PERMISSIONS[payload.type];
  if (required) {
    const perms = subscriber.permissions;
    const has =
      perms instanceof Set ? perms.has(required) : (perms || []).includes(required);
    if (!has) return false;
  }

  const stations = payload.stations || [];
  if (
    subscriber.station &&
    stations.length > 0 &&
    !stations.includes(subscriber.station)
  ) {
    return false;
  }

  return true;
}
