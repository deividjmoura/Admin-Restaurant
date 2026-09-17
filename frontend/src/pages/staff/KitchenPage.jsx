import { useEffect, useState, useCallback, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { api, apiUrl, getTenant } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';
import { STAFF_NAV, statusBadgeClass } from './staffNav';

export default function KitchenPage({ station = 'KITCHEN' }) {
  const { user, loading } = useAuth();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState(null);
  const [live, setLive] = useState('polling');
  const [busyItem, setBusyItem] = useState(null);
  const loadRef = useRef(() => {});

  const load = useCallback(async () => {
    const data = await api(`/api/kitchen/orders?station=${station}`);
    setOrders(data.orders || []);
  }, [station]);

  loadRef.current = load;

  useEffect(() => {
    if (!user) return;

    load().catch(setError);

    let es = null;
    let pollId = null;

    // EventSource envia cookies same-origin; tenant via header não é possível.
    // Backend resolve tenant por cookie de sessão + host; em dev usamos X-Tenant via API poll.
    try {
      const base = apiUrl(`/api/kitchen/events?station=${station}`);
      // query tenant como dica (alguns proxies); cookie de auth já vai no same-origin
      const url = `${base}${base.includes('?') ? '&' : '?'}tenant=${encodeURIComponent(getTenant())}`;
      es = new EventSource(url, { withCredentials: true });

      es.addEventListener('connected', () => {
        setLive('sse');
      });

      const onEvent = () => {
        loadRef.current().catch(() => {});
      };
      es.addEventListener('order.created', onEvent);
      es.addEventListener('order.status_changed', onEvent);
      es.addEventListener('order.item_status_changed', onEvent);
      es.addEventListener('order', onEvent);
      es.onmessage = onEvent;

      es.onerror = () => {
        setLive('polling');
        es.close();
        es = null;
      };
    } catch {
      setLive('polling');
    }

    pollId = setInterval(() => {
      loadRef.current().catch(() => {});
    }, live === 'sse' ? 15000 : 4000);

    return () => {
      if (es) es.close();
      if (pollId) clearInterval(pollId);
    };
  }, [user, load, station]);

  if (loading) return <Spinner />;
  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: station === 'BAR' ? '/bar' : '/kitchen' }}
      />
    );
  }

  const title = station === 'BAR' ? 'Bar' : 'Cozinha';

  async function advanceItem(itemId, status) {
    setBusyItem(itemId);
    setError(null);
    try {
      await api(`/api/orders/items/${itemId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyItem(null);
    }
  }

  return (
    <Shell title={title} nav={STAFF_NAV}>
      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-sm text-stone-500">
          Estação <span className="font-medium text-stone-800">{station}</span>
        </p>
        <span
          className={
            'text-xs rounded-full px-2 py-0.5 ' +
            (live === 'sse'
              ? 'bg-green-100 text-green-800'
              : 'bg-stone-100 text-stone-600')
          }
        >
          {live === 'sse' ? '● ao vivo' : '↻ atualizando'}
        </span>
      </div>

      <ErrorBox error={error} />

      <div className="grid gap-3 sm:grid-cols-2">
        {orders.length === 0 && (
          <Card>
            <p className="text-stone-500 text-sm">Nenhum pedido ativo nesta estação.</p>
          </Card>
        )}
        {orders.map((o) => {
          const items = (o.items || []).filter(
            (it) => !it.station || it.station === station
          );
          if (items.length === 0) return null;
          return (
            <Card key={o.id} className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="font-mono text-stone-500">
                  #{String(o.id).slice(0, 8)}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${statusBadgeClass(o.status)}`}>
                  {o.status}
                </span>
              </div>
              <ul className="space-y-2">
                {items.map((it) => (
                  <li
                    key={it.id}
                    className="flex justify-between gap-2 items-center border-t border-stone-100 pt-2 first:border-0 first:pt-0"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-stone-900">
                        {it.quantity}× {it.productName || it.product_name}
                      </p>
                      <span
                        className={`inline-block mt-0.5 rounded-full px-2 py-0.5 text-xs ${statusBadgeClass(it.status)}`}
                      >
                        {it.status}
                      </span>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {(it.status === 'PENDING' || it.status === 'CONFIRMED') && (
                        <Button
                          className="!px-2 !py-1 text-xs"
                          disabled={busyItem === it.id}
                          onClick={() => advanceItem(it.id, 'PREPARING')}
                        >
                          Preparar
                        </Button>
                      )}
                      {it.status === 'PREPARING' && (
                        <Button
                          className="!px-2 !py-1 text-xs"
                          disabled={busyItem === it.id}
                          onClick={() => advanceItem(it.id, 'READY')}
                        >
                          Pronto
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </Shell>
  );
}
