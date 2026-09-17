import { useEffect, useState, useCallback, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { api, apiUrl, getTenant } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';

function timeAgo(iso) {
  if (!iso) return '—';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'agora';
  if (m === 1) return '1 min';
  return `${m} min`;
}

export default function KitchenPage({ station = 'KITCHEN' }) {
  const { user, loading } = useAuth();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef(null);

  const load = useCallback(async () => {
    const data = await api(`/api/kitchen/orders?station=${station}`);
    setOrders(data.orders || []);
  }, [station]);

  useEffect(() => {
    if (!user) return;
    load().catch(setError);

    // Realtime: SSE with tenant in query (EventSource can't send headers)
    const tenant = getTenant();
    const url = apiUrl(`/api/kitchen/events?station=${station}&tenant=${encodeURIComponent(tenant)}`);
    let es;
    try {
      es = new EventSource(url, { withCredentials: true });
      esRef.current = es;
      es.onopen = () => setConnected(true);
      es.onerror = () => setConnected(false);
      es.addEventListener('connected', () => setConnected(true));
      const refresh = () => load().catch(() => {});
      es.addEventListener('order', refresh);
      es.addEventListener('order.created', refresh);
      es.addEventListener('order.status_changed', refresh);
      es.addEventListener('order.item_status_changed', refresh);
      es.onmessage = refresh;
    } catch {
      setConnected(false);
    }

    // Poll fallback every 4s (covers SSE gaps + multi-tab)
    const id = setInterval(() => load().catch(() => {}), 4000);
    return () => {
      clearInterval(id);
      if (es) es.close();
      setConnected(false);
    };
  }, [user, load, station]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: station === 'BAR' ? '/bar' : '/kitchen' }} />;

  const title = station === 'BAR' ? 'Bar' : 'Cozinha';
  const stationColor = station === 'BAR' ? 'text-sky-700' : 'text-amber-700';

  async function advanceItem(itemId, nextStatus) {
    setError(null);
    try {
      await api(`/api/orders/items/${itemId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Shell
      title={title}
      nav={[
        { to: '/kitchen', label: 'Cozinha' },
        { to: '/bar', label: 'Bar' },
        { to: '/waiter', label: 'Garçom' },
        { to: '/cashier', label: 'Caixa' },
      ]}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-stone-500">
          Estação <span className={`font-semibold ${stationColor}`}>{station}</span> • {connected ? '● realtime' : '○ polling'}
        </p>
        <Button variant="secondary" className="!py-1 !px-3 text-xs" onClick={() => load().catch(setError)}>
          Atualizar
        </Button>
      </div>

      <ErrorBox error={error} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {orders.length === 0 && (
          <Card>
            <p className="text-stone-500 text-sm">Nenhum pedido ativo para {station}.</p>
            <p className="text-xs text-stone-400 mt-1">Novos pedidos aparecem aqui em realtime.</p>
          </Card>
        )}
        {orders.map((o) => (
          <Card key={o.id} className="flex flex-col gap-2">
            <div className="flex justify-between items-start gap-2">
              <div>
                <p className="text-xs text-stone-500">
                  #{String(o.id).slice(0, 8)} • {o.channel || 'TABLE'} {o.tableNumber ? `• Mesa ${o.tableNumber}` : o.table_number ? `• Mesa ${o.table_number}` : ''}
                </p>
                <p className="text-xs text-stone-400">{timeAgo(o.createdAt || o.created_at)} atrás • {o.status}</p>
              </div>
              <span className="text-[11px] px-2 py-1 rounded-full bg-stone-100 border border-stone-200">
                {o.station || station}
              </span>
            </div>

            {o.notes && (
              <p className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                Obs: {o.notes}
              </p>
            )}

            <ul className="space-y-2 mt-1">
              {(o.items || [])
                .filter((it) => {
                  // Some backends return items already filtered; keep fallback
                  const s = it.station || o.station;
                  return !s || s === station || s === o.station;
                })
                .map((it) => (
                  <li key={it.id} className="flex justify-between gap-2 items-center border border-stone-100 rounded-xl px-2 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        <span className="text-stone-500">{it.quantity}×</span> {it.productName || it.product_name}
                      </p>
                      {it.notes && <p className="text-xs text-stone-500 truncate">+ {it.notes}</p>}
                      <p className="text-[11px] text-stone-400">
                        {it.status} • {it.station || station}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {(it.status === 'PENDING' || it.status === 'CONFIRMED') && (
                        <Button className="!px-2 !py-1 text-xs" onClick={() => advanceItem(it.id, 'PREPARING')}>
                          Iniciar
                        </Button>
                      )}
                      {it.status === 'PREPARING' && (
                        <Button className="!px-2 !py-1 text-xs bg-green-600 hover:bg-green-700" onClick={() => advanceItem(it.id, 'READY')}>
                          Pronto
                        </Button>
                      )}
                      {it.status === 'READY' && (
                        <span className="text-[11px] px-2 py-1 rounded-full bg-green-50 border border-green-200 text-green-700">aguardando garçom</span>
                      )}
                    </div>
                  </li>
                ))}
              {(o.items || []).length === 0 && (
                <li className="text-xs text-stone-400">Sem itens para esta estação.</li>
              )}
            </ul>
          </Card>
        ))}
      </div>

      <p className="text-center text-xs text-stone-400 mt-6">
        Dica: KITCHEN ↔ BAR são estações isoladas por `station`. Itens seguem PENDING → PREPARING → READY → DELIVERED.
      </p>
    </Shell>
  );
}
