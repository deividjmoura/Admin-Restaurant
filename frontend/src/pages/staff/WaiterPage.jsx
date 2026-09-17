import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';

export default function WaiterPage() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('ALL'); // ALL | KITCHEN | BAR

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

  // PWA: registra service-worker para /waiter (offline cache)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }
  }, []);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/waiter' }} />;

  async function deliver(itemId) {
    setError(null);
    try {
      await api(`/api/waiter/items/${itemId}/deliver`, { method: 'PATCH' });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function deliverViaGeneric(itemId) {
    // Fallback via generic item status route
    try {
      await api(`/api/orders/items/${itemId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'DELIVERED' }),
      });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Shell
      title="Garçom"
      nav={[
        { to: '/kitchen', label: 'Cozinha' },
        { to: '/bar', label: 'Bar' },
        { to: '/waiter', label: 'Garçom' },
        { to: '/cashier', label: 'Caixa' },
      ]}
    >
      <div className="flex gap-2 mb-3">
        {['ALL', 'KITCHEN', 'BAR'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
              filter === s ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-stone-600 border-stone-200'
            }`}
          >
            {s === 'ALL' ? 'Todos' : s}
          </button>
        ))}
        <Button variant="secondary" className="!py-1 !px-3 text-xs ml-auto" onClick={() => load().catch(setError)}>
          Atualizar
        </Button>
      </div>

      <ErrorBox error={error} />

      <div className="space-y-3">
        {items.length === 0 && (
          <Card>
            <p className="text-sm text-stone-500">Nenhum item pronto para entrega.</p>
            <p className="text-xs text-stone-400 mt-1">Itens ficam READY na cozinha/bar e aparecem aqui.</p>
          </Card>
        )}
        {items.map((it) => (
          <Card key={it.id} className="flex justify-between items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">
                {it.quantity}× {it.productName || it.product_name}
              </p>
              <p className="text-xs text-stone-500 truncate">
                Pedido #{String(it.orderId || it.order_id || '').slice(0, 8)} • {it.station || '—'} • READY
              </p>
              {it.notes && <p className="text-xs text-stone-400">Obs: {it.notes}</p>}
            </div>
            <div className="flex gap-2 shrink-0">
              <Button onClick={() => deliver(it.id)} className="bg-green-600 hover:bg-green-700">
                Entregar
              </Button>
              <Button variant="secondary" className="!px-2 text-xs" onClick={() => deliverViaGeneric(it.id)} title="Fallback genérico">
                ✓
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <p className="text-center text-xs text-stone-400 mt-6">
        Garçom consome fila READY → DELIVERED. Poll a cada 3s + realtime da cozinha.
      </p>
    </Shell>
  );
}
