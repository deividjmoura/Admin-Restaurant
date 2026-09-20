/**
 * Status machines for orders and items (pure, no DB).
 *
 * Pedido:
 *   PENDING → CONFIRMED → PREPARING → READY → DELIVERED
 *   (qualquer estado não-terminal → CANCELLED)
 *
 * `PENDING → PREPARING` é permitido porque a cozinha avança itens direto
 * (`/api/orders/items/:id/status`) e o pedido acompanha a derivação pura
 * `deriveOrderStatus()`. Exigir o passo CONFIRMED deixaria o pedido preso em
 * PENDING enquanto os itens já estavam em produção.
 */

export const ORDER_ALLOWED_TRANSITIONS = {
  PENDING: ['CONFIRMED', 'PREPARING', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export const ITEM_ALLOWED_TRANSITIONS = {
  PENDING: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

export const ORDER_STATUSES = Object.keys(ORDER_ALLOWED_TRANSITIONS);
export const ITEM_STATUSES = Object.keys(ITEM_ALLOWED_TRANSITIONS);

/** Status em que o pedido já não evolui. */
export const TERMINAL_ORDER_STATUSES = ['DELIVERED', 'CANCELLED'];

/** Status de item que a cozinha/bar ainda precisa produzir. */
export const ITEM_IN_PROGRESS_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING'];

export function canTransition(from, to) {
  return (ORDER_ALLOWED_TRANSITIONS[from] || []).includes(to);
}

export function canTransitionItem(from, to) {
  return (ITEM_ALLOWED_TRANSITIONS[from] || []).includes(to);
}

/**
 * Deriva o status do pedido a partir dos status dos seus itens.
 * Função pura — substitui a lógica ambígua de `maybeAdvanceOrderStatus()`.
 *
 *   - todos cancelados           → CANCELLED
 *   - todos entregues            → DELIVERED
 *   - todos READY/DELIVERED      → READY
 *   - algum saiu de PENDING      → PREPARING
 *   - caso contrário             → PENDING
 */
export function deriveOrderStatus(itemStatuses = []) {
  const active = itemStatuses.filter((status) => status !== 'CANCELLED');

  if (!active.length) return 'CANCELLED';
  if (active.every((status) => status === 'DELIVERED')) return 'DELIVERED';
  if (active.every((status) => ['READY', 'DELIVERED'].includes(status))) return 'READY';
  if (active.some((status) => status !== 'PENDING')) return 'PREPARING';

  return 'PENDING';
}

export function isTerminalOrderStatus(status) {
  return TERMINAL_ORDER_STATUSES.includes(status);
}
