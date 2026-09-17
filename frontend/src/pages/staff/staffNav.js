/** Navegação comum das telas de operação. */
export const STAFF_NAV = [
  { to: '/kitchen', label: 'Cozinha' },
  { to: '/bar', label: 'Bar' },
  { to: '/waiter', label: 'Garçom' },
  { to: '/cashier', label: 'Caixa' },
  { to: '/admin', label: 'Admin' },
];

export function statusBadgeClass(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'READY') return 'bg-green-100 text-green-800';
  if (s === 'PREPARING') return 'bg-amber-100 text-amber-800';
  if (s === 'PENDING' || s === 'CONFIRMED') return 'bg-sky-100 text-sky-800';
  if (s === 'DELIVERED') return 'bg-stone-100 text-stone-600';
  if (s === 'CANCELLED') return 'bg-red-100 text-red-700';
  return 'bg-stone-100 text-stone-600';
}
