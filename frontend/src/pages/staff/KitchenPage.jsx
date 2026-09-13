import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { api, apiUrl, getTenant } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';

export default function KitchenPage({ station = 'KITCHEN' }) {
  const { user, loading } = useAuth();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const data = await api(`/api/kitchen/orders?station=${station}`);
    setOrders(data.orders || data || []);
  }, [station]);

  useEffect(() => {
    if (!user) return;
    load().catch(setError);
    // SSE
    const url = apiUrl(
      `/api/kitchen/events?station=${station}&tenant=${encodeURIComponent(getTenant())}`
    );
    // EventSource can't set custom headers — tenant via query if backend supports, else rely on cookie subdomain
    // Fallback: poll
    const id = setInterval(() => {
      load().catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [user, load, station]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: station === 'BAR' ? '/bar' : '/kitchen' }} />;

  const title = station === 'BAR' ? 'Bar' : 'Cozinha';

  async function advanceItem(orderId, itemId, status) {
    try {
      await api(`/api/orders/items/${itemId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Shell title={title} nav={[
      { to: '/kitchen', label: 'Cozinha' },
      { to: '/bar', label: 'Bar' },
      { to: '/waiter', label: 'Garçom' },
      { to: '/cashier', label: 'Caixa' },
    ]}>
      <ErrorBox error={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        {orders.length === 0 && (
          <Card>
            <p className="text-stone-500 text-sm">Nenhum pedido ativo.</p>
          </Card>
        )}
        {orders.map((o) => (
          <Card key={o.id}>
            <div className="flex justify-between text-sm text-stone-500 mb-2">
              <span>#{String(o.id).slice(0, 8)}</span>
              <span>{o.status}</span>
            </div>
            <ul className="space-y-2">
              {(o.items || [])
                .filter((it) => !station || it.station === station || !it.station)
                .map((it) => (
                  <li key={it.id} className="flex justify-between gap-2 items-center">
                    <span>
                      <strong>{it.quantity}×</strong> {it.productName || it.product_name}
                      <span className="text-xs text-stone-400 ml-1">{it.status}</span>
                    </span>
                    <div className="flex gap-1">
                      {it.status === 'PENDING' || it.status === 'CONFIRMED' ? (
                        <Button
                          className="!px-2 !py-1 text-xs"
                          onClick={() => advanceItem(o.id, it.id, 'PREPARING')}
                        >
                          Preparar
                        </Button>
                      ) : null}
                      {it.status === 'PREPARING' ? (
                        <Button
                          className="!px-2 !py-1 text-xs"
                          onClick={() => advanceItem(o.id, it.id, 'READY')}
                        >
                          Pronto
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>
    </Shell>
  );
}
