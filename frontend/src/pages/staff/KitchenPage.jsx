import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { usePolling } from '../../hooks/usePolling';
import {
  Shell,
  Card,
  Button,
  Spinner,
  ConnectionStatus,
} from '../../components/Layout';

const STAFF_NAV = [
  { to: '/kitchen', label: 'Cozinha' },
  { to: '/bar', label: 'Bar' },
  { to: '/waiter', label: 'Garçom' },
  { to: '/cashier', label: 'Caixa' },
];

const STATUS_STYLE = {
  PENDING: 'bg-stone-100 text-stone-700',
  CONFIRMED: 'bg-sky-100 text-sky-800',
  PREPARING: 'bg-amber-100 text-amber-900',
  READY: 'bg-emerald-100 text-emerald-800',
  DELIVERED: 'bg-stone-100 text-stone-500',
  CANCELLED: 'bg-red-100 text-red-700',
};

function StatusBadge({ status }) {
  const s = status || 'PENDING';
  return (
    <span
      className={
        'inline-block rounded-full px-2 py-0.5 text-xs font-medium ' +
        (STATUS_STYLE[s] || STATUS_STYLE.PENDING)
      }
    >
      {s}
    </span>
  );
}

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}min`;
}

export default function KitchenPage({ station = 'KITCHEN' }) {
  const { user, loading } = useAuth();
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Falhas de polling nunca são engolidas: 401 desloga, 429 avisa,
  // 5xx/rede mostram banner de conexão perdida e a aba oculta pausa o poll.
  const {
    data,
    error: pollError,
    loaded,
    offline,
    rateLimited,
    reload,
  } = usePolling(`/api/kitchen/orders?station=${station}`, {
    intervalMs: 4000,
    enabled: Boolean(user),
  });

  const orders = data?.orders || [];
  // Falha de ação tem prioridade, mas o erro de polling nunca é engolido.
  const error = actionError || pollError;

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
    setBusyId(itemId);
    setActionError(null);
    try {
      await api(`/api/orders/items/${itemId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusyId(null);
    }
  }

  const activeOrders = orders.filter((o) =>
    (o.items || []).some((it) => !['DELIVERED', 'CANCELLED'].includes(it.status))
  );

  return (
    <Shell title={title} nav={STAFF_NAV}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-stone-500">
            {loaded
              ? `${activeOrders.length} pedido${activeOrders.length === 1 ? '' : 's'} na fila`
              : 'Carregando…'}
          </p>
          <Button
            variant="secondary"
            className="!py-1 !px-3 text-xs"
            onClick={() => reload()}
          >
            Atualizar
          </Button>
        </div>

        <ConnectionStatus
          offline={offline}
          rateLimited={rateLimited}
          error={error}
        />

        {!loaded && <Spinner />}

        {loaded && activeOrders.length === 0 && (
          <Card className="text-center py-10">
            <p className="text-3xl mb-2" aria-hidden>
              ✓
            </p>
            <p className="font-medium text-stone-800">Fila vazia</p>
            <p className="text-sm text-stone-500 mt-1">
              Novos pedidos da mesa aparecem aqui automaticamente.
            </p>
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {activeOrders.map((o) => {
            const items = (o.items || []).filter(
              (it) => !['DELIVERED', 'CANCELLED'].includes(it.status)
            );
            if (!items.length) return null;
            return (
              <Card key={o.id} className="space-y-3">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="font-semibold text-stone-900">
                      {o.tableNumber != null
                        ? `Mesa ${o.tableNumber}`
                        : `Pedido #${String(o.id).slice(0, 8)}`}
                    </p>
                    <p className="text-xs text-stone-500 mt-0.5">
                      #{String(o.id).slice(0, 8).toUpperCase()}
                      {o.createdAt || o.created_at
                        ? ` · ${timeAgo(o.createdAt || o.created_at)}`
                        : ''}
                    </p>
                  </div>
                  <StatusBadge status={o.status} />
                </div>

                <ul className="space-y-2 border-t border-stone-100 pt-2">
                  {items.map((it) => (
                    <li
                      key={it.id}
                      className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-stone-900">
                          <strong className="text-amber-700">{it.quantity}×</strong>{' '}
                          {it.productName || it.product_name}
                        </p>
                        {it.notes && (
                          <p className="text-xs text-stone-500 italic truncate">{it.notes}</p>
                        )}
                        <div className="mt-1">
                          <StatusBadge status={it.status} />
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {(it.status === 'PENDING' || it.status === 'CONFIRMED') && (
                          <Button
                            className="!px-3 !py-1.5 text-xs"
                            disabled={busyId === it.id}
                            onClick={() => advanceItem(it.id, 'PREPARING')}
                          >
                            {busyId === it.id ? '…' : 'Preparar'}
                          </Button>
                        )}
                        {it.status === 'PREPARING' && (
                          <Button
                            className="!px-3 !py-1.5 text-xs"
                            disabled={busyId === it.id}
                            onClick={() => advanceItem(it.id, 'READY')}
                          >
                            {busyId === it.id ? '…' : 'Pronto'}
                          </Button>
                        )}
                        {it.status === 'READY' && (
                          <span className="text-xs font-medium text-emerald-700 self-center px-1">
                            Aguardando garçom
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
