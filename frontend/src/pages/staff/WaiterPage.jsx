import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  Shell,
  Card,
  Button,
  Spinner,
  ErrorBox,
  EmptyState,
  SuccessBox,
} from '../../components/Layout';

const STAFF_NAV = [
  { to: '/kitchen', label: 'Cozinha' },
  { to: '/bar', label: 'Bar' },
  { to: '/waiter', label: 'Garçom' },
  { to: '/cashier', label: 'Caixa' },
];

export default function WaiterPage() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [delivering, setDelivering] = useState(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const qs = filter === 'ALL' ? '' : `?station=${filter}`;
    const data = await api(`/api/waiter/ready-items${qs}`);
    setItems(data.items || []);
  }, [filter]);

  useEffect(() => {
    if (!user) return;
    load().catch(setError);
    const id = setInterval(() => load().catch(() => {}), 3000);
    return () => clearInterval(id);
  }, [user, load]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }
  }, []);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/waiter' }} />;

  async function deliver(itemId) {
    setError(null);
    setDelivering(itemId);
    try {
      await api(`/api/waiter/items/${itemId}/deliver`, { method: 'PATCH' });
      setMsg('Item entregue');
      setTimeout(() => setMsg(''), 2000);
      await load();
    } catch (err) {
      try {
        await api(`/api/orders/items/${itemId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'DELIVERED' }),
        });
        setMsg('Item entregue');
        setTimeout(() => setMsg(''), 2000);
        await load();
      } catch (err2) {
        setError(err2);
      }
    } finally {
      setDelivering(null);
    }
  }

  return (
    <Shell title="Garçom" nav={STAFF_NAV}>
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        {['ALL', 'KITCHEN', 'BAR'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filter === s
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
            }`}
          >
            {s === 'ALL' ? 'Todos' : s}
          </button>
        ))}
        <Button
          variant="secondary"
          className="!py-1 !px-3 text-xs ml-auto"
          onClick={() => load().catch(setError)}
        >
          Atualizar
        </Button>
      </div>

      <SuccessBox>{msg}</SuccessBox>
      {msg && <div className="mb-3" />}

      <ErrorBox error={error} />

      <div className="space-y-3">
        {items.length === 0 && (
          <EmptyState
            title="Nenhum item pronto para entrega"
            description="Itens ficam READY na cozinha/bar e aparecem aqui (poll 3s)."
          />
        )}
        {items.map((it) => {
          const table =
            it.tableNumber ||
            it.table_number ||
            it.tableLabel ||
            it.table_label ||
            null;
          return (
            <Card key={it.id} className="flex justify-between items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate text-stone-900">
                  {it.quantity}× {it.productName || it.product_name}
                </p>
                <p className="text-xs text-stone-500 truncate mt-0.5">
                  {table ? `Mesa ${table} · ` : ''}
                  Pedido #{String(it.orderId || it.order_id || '').slice(0, 8)} ·{' '}
                  {it.station || '—'} · READY
                </p>
                {it.notes && (
                  <p className="text-xs text-stone-400 mt-0.5">Obs: {it.notes}</p>
                )}
              </div>
              <Button
                onClick={() => deliver(it.id)}
                disabled={delivering === it.id}
                className="bg-green-600 hover:bg-green-700 shrink-0"
              >
                {delivering === it.id ? '…' : 'Entregar'}
              </Button>
            </Card>
          );
        })}
      </div>

      <p className="text-center text-xs text-stone-400 mt-6">
        Fila READY → DELIVERED · atualização automática a cada 3s
      </p>
    </Shell>
  );
}
