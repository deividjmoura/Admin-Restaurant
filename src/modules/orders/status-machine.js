/**
 * Status machines for orders and items (pure, no DB).
 */

export const ORDER_ALLOWED_TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
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

export function canTransition(from, to) {
  return (ORDER_ALLOWED_TRANSITIONS[from] || []).includes(to);
}

export function canTransitionItem(from, to) {
  return (ITEM_ALLOWED_TRANSITIONS[from] || []).includes(to);
}
