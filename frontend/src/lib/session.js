/**
 * Estado da sessão de mesa no cliente (QR → cardápio → carrinho).
 * Chaves namespaced por token para evitar colisão entre mesas no mesmo browser.
 */

function key(token, name) {
  return `ar:${token}:${name}`;
}

export function getSessionId(token) {
  return sessionStorage.getItem(key(token, 'sessionId'));
}

export function setSessionId(token, id) {
  if (id) sessionStorage.setItem(key(token, 'sessionId'), id);
}

export function getCartVersion(token) {
  return Number(sessionStorage.getItem(key(token, 'cartVersion')) || 0);
}

export function setCartVersion(token, version) {
  sessionStorage.setItem(key(token, 'cartVersion'), String(version ?? 0));
}

export function getTableMeta(token) {
  try {
    const raw = sessionStorage.getItem(key(token, 'table'));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setTableMeta(token, table) {
  if (table) sessionStorage.setItem(key(token, 'table'), JSON.stringify(table));
}

/** Gera Idempotency-Key estável por tentativa de checkout (UUID v4-ish). */
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `ck-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Persiste a key do checkout em andamento para retry seguro (replay).
 * Limpa após sucesso confirmado.
 */
export function getCheckoutKey(token) {
  return sessionStorage.getItem(key(token, 'checkoutKey'));
}

export function setCheckoutKey(token, idemKey) {
  if (idemKey) sessionStorage.setItem(key(token, 'checkoutKey'), idemKey);
}

export function clearCheckoutKey(token) {
  sessionStorage.removeItem(key(token, 'checkoutKey'));
}
