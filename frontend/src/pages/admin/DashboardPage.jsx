import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  Shell,
  Card,
  Button,
  Spinner,
  ErrorBox,
  Banner,
} from '../../components/Layout';

const nav = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/menu', label: 'Cardápio' },
  { to: '/admin/tables', label: 'Mesas' },
  { to: '/cashier', label: 'Caixa' },
];

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 5) return 'agora';
  if (sec < 60) return `há ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  return `há ${h}h${min % 60}min`;
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(
    async (manual = false) => {
      if (!user) return;
      if (inFlight.current) return;
      inFlight.current = true;
      if (manual) setBusy(true);
      try {
        const result = await api('/api/reports/dashboard?preset=today');
        if (!manual) setBusy(false);
        setData(result);
        setError(null);
        setOffline(false);
        setLoaded(true);
        setLastUpdated(new Date().toISOString());
      } catch (err) {
        // Mantém os últimos dados na tela; sinaliza conexão perdida/erro.
        if (err instanceof ApiError && err.isServerOrNetworkError) setOffline(true);
        else setError(err);
      } finally {
        inFlight.current = false;
        if (manual) setBusy(false);
      }
    },
    [user]
  );

  useEffect(() => {
    if (!user) return undefined;
    load();
    // Refresco leve para os números de "ao vivo" sem poluir a tela.
    const id = setInterval(() => load(false), 30000);
    return () => clearInterval(id);
  }, [user, load]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/admin' }} />;

  const s = data?.summary;
  const live = data?.live || {};
  const prep = data?.prep || {};
  const series = data?.dailySeries || [];
  const top = data?.topProducts || [];
  const maxRevenue =
    series.reduce((m, d) => Math.max(m, Number(d.revenue) || 0), 0) || 1;

  return (
    <Shell title="Dashboard" nav={nav}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-sm text-stone-500">
          {loaded ? (
            <>
              {lastUpdated ? `Atualizado ${timeAgo(lastUpdated)}` : 'Carregado'}
            </>
          ) : (
            'Carregando…'
          )}
        </div>
        <Button
          variant="secondary"
          className="!py-1 !px-3 text-xs"
          disabled={busy}
          onClick={() => load(true)}
        >
          {busy ? 'Atualizando…' : 'Atualizar'}
        </Button>
      </div>

      {offline && (
        <Banner tone="error">
          Conexão com o servidor perdida. Os números podem estar desatualizados —
          tentando reconectar automaticamente.
        </Banner>
      )}
      <ErrorBox error={error} />

      {!loaded && !data && <Spinner />}

      {data && (
        <div className="space-y-4">
          {/* Métricas principais */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <p className="text-xs text-stone-500">Pedidos (válidos)</p>
              <p className="text-3xl font-bold">{s?.orders?.valid ?? 0}</p>
              <p className="text-xs text-stone-500 mt-1">
                Mesa {s?.orders?.table ?? 0} · Delivery{' '}
                {s?.orders?.delivery ?? 0}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-stone-500">Receita</p>
              <p className="text-3xl font-bold">
                R$ {Number(s?.revenue?.total || 0).toFixed(2)}
              </p>
              <p className="text-xs text-stone-500 mt-1">
                Ticket médio R${' '}
                {Number(s?.revenue?.averageTicket || 0).toFixed(2)}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-stone-500">Tempo médio de preparo</p>
              <p className="text-3xl font-bold">
                {prep.averagePrepMinutes != null
                  ? `${prep.averagePrepMinutes} min`
                  : '—'}
              </p>
              <p className="text-xs text-stone-500 mt-1">
                {prep.sampleSize
                  ? `${prep.sampleSize} pedido(s) prontos`
                  : 'sem amostra hoje'}
              </p>
            </Card>
          </div>

          {/* Ao vivo */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <p className="text-xs text-stone-500">Pedidos ativos</p>
              <p className="text-lg font-semibold">
                {live.activeOrders ?? 0}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-stone-500">Sessões abertas</p>
              <p className="text-lg font-semibold">
                {live.openSessions ?? 0}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-stone-500">Pagamentos pendentes</p>
              <p className="text-lg font-semibold">
                {live.pendingPayments ?? 0}
              </p>
              <p className="text-xs text-stone-500 mt-1">
                R$ {Number(live.pendingPaymentsAmount || 0).toFixed(2)}
              </p>
            </Card>
          </div>

          {/* Série diária (últimos 7 dias) */}
          <Card>
            <h2 className="font-semibold mb-3">Receita dos últimos dias</h2>
            {series.length === 0 ? (
              <p className="text-sm text-stone-500">
                Sem vendas no período ainda.
              </p>
            ) : (
              <div className="space-y-2">
                {series.map((d) => {
                  const rev = Number(d.revenue) || 0;
                  const pct = Math.max(2, Math.round((rev / maxRevenue) * 100));
                  const day = new Date(d.day).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                  });
                  return (
                    <div key={d.day} className="flex items-center gap-3">
                      <span className="w-12 shrink-0 text-xs text-stone-500">
                        {day}
                      </span>
                      <div className="flex-1 h-5 rounded-lg bg-stone-100 overflow-hidden">
                        <div
                          className="h-full bg-amber-400"
                          style={{ width: `${pct}%` }}
                          title={`${d.orders} pedido(s)`}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right text-xs text-stone-700">
                        R$ {rev.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Top produtos */}
          {top.length > 0 && (
            <Card>
              <h2 className="font-semibold mb-2">Top produtos</h2>
              <ul className="text-sm space-y-1">
                {top.map((p) => (
                  <li
                    key={p.productId}
                    className="flex justify-between gap-2"
                  >
                    <span className="truncate">{p.productName}</span>
                    <span className="text-stone-500 shrink-0">
                      {p.quantity}× · R$ {Number(p.revenue).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="flex flex-wrap gap-3 text-sm">
            <Link className="text-amber-700 underline" to="/admin/menu">
              Gerenciar cardápio
            </Link>
            <Link className="text-amber-700 underline" to="/admin/tables">
              Gerenciar mesas
            </Link>
            <Link className="text-amber-700 underline" to="/cashier">
              Abrir caixa
            </Link>
          </div>
        </div>
      )}
    </Shell>
  );
}
