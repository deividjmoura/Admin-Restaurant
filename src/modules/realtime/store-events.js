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

/** Tipos de evento que exigem permissão adicional para chegar ao painel. */
export const EVENT_PERMISSIONS = {
  'payment.created': 'payments.read',
  'payment.paid': 'payments.read',
  'payment.updated': 'payments.read',
  'session.closed': 'cashier.sessions.read',
};

export function publishStoreOrderEvent(storeId, event) {
  const set = listeners.get(channelKey(storeId));
  if (!set || set.size === 0) return;

  const payload = {
    channel: `store:${storeId}:orders`,
    // storeId explícito no payload: o assinante confere que o evento é do
    // tenant dele antes de renderizar (defesa em profundidade contra um
    // publish com chave errada).
    storeId: String(storeId),
    ...event,
    at: new Date().toISOString(),
  };

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
