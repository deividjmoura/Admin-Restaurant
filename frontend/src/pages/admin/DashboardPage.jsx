import { useCallback, useEffect, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  Shell,
  Card,
  Button,
  Spinner,
  ErrorBox,
  EmptyState,
} from '../../components/Layout';

const nav = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/menu', label: 'Cardápio' },
  { to: '/admin/tables', label: 'Mesas' },
  { to: '/cashier', label: 'Caixa' },
];

function formatMoney(n) {
  return `R$ ${Number(n || 0).toFixed(2)}`;
}

function DailyBars({ series }) {
  if (!series?.length) return null;
  const max = Math.max(...series.map((d) => Number(d.revenue || d.orders || 0)), 1);
  return (
    <Card>
      <h2 className="font-semibold mb-3">Série diária</h2>
      <div className="flex items-end gap-1.5 h-28">
        {series.map((d) => {
          const value = Number(d.revenue ?? d.orders ?? 0);
          const h = Math.max(4, Math.round((value / max) * 100));
          const label = d.date || d.day || '';
          const short = String(label).slice(-5);
          return (
            <div key={label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div
                className="w-full rounded-t bg-amber-400/90 hover:bg-amber-500 transition-colors"
                style={{ height: `${h}%` }}
                title={`${label}: ${formatMoney(d.revenue)} · ${d.orders ?? 0} pedidos`}
              />
              <span className="text-[10px] text-stone-400 truncate w-full text-center">
                {short}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);
    setError(null);
    try {
      const result = await api('/api/reports/dashboard?preset=today');
      setData(result);
    } catch (err) {
      setError(err);
    } finally {
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh automático a cada 30s (operação ao vivo).
  useEffect(() => {
    if (!user) return undefined;
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [user, load]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/admin' }} />;

  const s = data?.summary;
  const live = data?.live;
  const prep = data?.prep;

  return (
    <Shell title="Dashboard" nav={nav}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-stone-500">Hoje · atualiza a cada 30s</p>
          <Button
            variant="secondary"
            className="!py-1 !px-3 text-xs"
            disabled={refreshing}
            onClick={load}
          >
            {refreshing ? 'Atualizando…' : 'Atualizar'}
          </Button>
        </div>

        <ErrorBox error={error} />

        {!data && !error && <Spinner />}

        {data && !s && (
          <EmptyState
            title="Sem dados ainda"
            description="Pedidos e pagamentos do dia aparecem aqui."
            icon="📊"
          />
        )}

        {s && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <p className="text-xs text-stone-500">Pedidos (válidos)</p>
              <p className="text-3xl font-bold">{s.orders?.valid ?? 0}</p>
              <p className="text-xs text-stone-500 mt-1">
                Mesa {s.orders?.table ?? 0} · Delivery {s.orders?.delivery ?? 0}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-stone-500">Receita</p>
              <p className="text-3xl font-bold">{formatMoney(s.revenue?.total)}</p>
              <p className="text-xs text-stone-500 mt-1">
                Ticket médio {formatMoney(s.revenue?.averageTicket)}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-stone-500">Ao vivo</p>
              <p className="text-lg font-semibold">
                {live?.activeOrders ?? 0} pedidos ativos
              </p>
              <p className="text-sm text-stone-600">
                {live?.openSessions ?? 0} sessões · {live?.pendingPayments ?? 0} pag. pendentes
              </p>
            </Card>
            <Card>
              <p className="text-xs text-stone-500">Tempo médio de preparo</p>
              <p className="text-3xl font-bold">
                {prep?.averageMinutes != null
                  ? `${Number(prep.averageMinutes).toFixed(0)} min`
                  : '—'}
              </p>
              <p className="text-xs text-stone-500 mt-1">
                {prep?.sampleSize != null ? `${prep.sampleSize} itens` : 'Sem amostra'}
              </p>
            </Card>
          </div>
        )}

        {data?.dailySeries?.length > 0 && <DailyBars series={data.dailySeries} />}

        {data?.topProducts?.length > 0 && (
          <Card>
            <h2 className="font-semibold mb-2">Top produtos</h2>
            <ul className="text-sm space-y-1">
              {data.topProducts.map((p) => (
                <li key={p.productId} className="flex justify-between gap-2">
                  <span className="truncate">{p.productName}</span>
                  <span className="text-stone-500 shrink-0">
                    {p.quantity} · {formatMoney(p.revenue)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="flex flex-wrap gap-3 text-sm">
          <Link className="text-amber-700 underline" to="/admin/menu">
            Cardápio
          </Link>
          <Link className="text-amber-700 underline" to="/admin/tables">
            Mesas
          </Link>
          <Link className="text-amber-700 underline" to="/cashier">
            Caixa
          </Link>
          <Link className="text-amber-700 underline" to="/kitchen">
            Cozinha
          </Link>
        </div>
      </div>
    </Shell>
  );
}
