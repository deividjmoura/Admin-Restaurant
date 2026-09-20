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

export default function WaiterPage() {
  const { user, loading } = useAuth();
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const { data, error, loaded, offline, rateLimited, reload } = usePolling(
    '/api/waiter/ready-items',
    { intervalMs: 4000, enabled: Boolean(user) }
  );

  const items = data?.items || [];
  const shownError = actionError || error;

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/waiter' }} />;

  async function deliver(itemId) {
    setBusyId(itemId);
    setActionError(null);
    try {
      await api(`/api/waiter/items/${itemId}/deliver`, { method: 'PATCH' });
      await reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Shell title="Garçom" nav={STAFF_NAV}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-stone-500">
            {loaded
              ? `${items.length} item${items.length === 1 ? '' : 's'} pronto${items.length === 1 ? '' : 's'}`
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
          error={shownError}
        />

        {!loaded && <Spinner />}

        {loaded && items.length === 0 && (
          <Card className="text-center py-10">
            <p className="text-3xl mb-2" aria-hidden>
              ✓
            </p>
            <p className="font-medium text-stone-800">Nada para entregar</p>
            <p className="text-sm text-stone-500 mt-1">
              Itens marcados como prontos na cozinha/bar aparecem aqui.
            </p>
          </Card>
        )}

        <div className="space-y-3">
          {items.map((it) => (
            <Card key={it.id} className="flex justify-between items-center gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-stone-900">
                  {it.tableNumber != null
                    ? `Mesa ${it.tableNumber}`
                    : `Pedido #${String(it.orderId || it.order_id || '').slice(0, 8)}`}
                </p>
                <p className="text-sm text-stone-800 mt-0.5">
                  <strong className="text-amber-700">{it.quantity}×</strong>{' '}
                  {it.productName || it.product_name}
                </p>
                <p className="text-xs text-stone-500 mt-1">
                  {it.station === 'BAR' ? 'Bar' : 'Cozinha'}
                  {it.notes ? ` · ${it.notes}` : ''}
                </p>
              </div>
              <Button
                disabled={busyId === it.id}
                onClick={() => deliver(it.id)}
                className="shrink-0"
              >
                {busyId === it.id ? '…' : 'Entregar'}
              </Button>
            </Card>
          ))}
        </div>
      </div>
    </Shell>
  );
}
