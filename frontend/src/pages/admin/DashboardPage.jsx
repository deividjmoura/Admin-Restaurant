import { useEffect, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Spinner, ErrorBox, Button } from '../../components/Layout';

const nav = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/menu', label: 'Cardápio' },
  { to: '/admin/tables', label: 'Mesas' },
  { to: '/cashier', label: 'Caixa' },
];

const presets = [
  { id: 'today', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
];

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const [preset, setPreset] = useState('today');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  async function load(p = preset) {
    setError(null);
    try {
      const d = await api(`/api/reports/dashboard?preset=${p}`);
      setData(d);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    if (!user) return;
    load(preset);
  }, [user, preset]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/admin' }} />;

  const s = data?.summary;

  return (
    <Shell title="Dashboard" nav={nav}>
      <div className="flex items-center gap-2 mb-3">
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => setPreset(p.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${preset === p.id ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-stone-600 border-stone-200'}`}
          >
            {p.label}
          </button>
        ))}
        <Button variant="secondary" className="!py-1 !px-3 text-xs ml-auto" onClick={() => load()}>
          Atualizar
        </Button>
      </div>

      <ErrorBox error={error} />
      {!data && !error && <Spinner />}

      {s && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <p className="text-xs uppercase tracking-wide text-stone-500">Pedidos (válidos)</p>
              <p className="text-3xl font-bold">{s.orders?.valid ?? s.orders?.total ?? 0}</p>
              <p className="text-xs text-stone-500 mt-1">
                Mesa {s.orders?.table ?? 0} • Delivery {s.orders?.delivery ?? 0} • {s.orders?.pending ?? 0} pendentes
              </p>
              <p className="text-xs text-stone-400">Cancelados: {s.orders?.cancelled ?? 0}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase tracking-wide text-stone-500">Receita</p>
              <p className="text-3xl font-bold">R$ {Number(s.revenue?.total || 0).toFixed(2)}</p>
              <p className="text-xs text-stone-500 mt-1">
                Ticket médio R$ {Number(s.revenue?.averageTicket || 0).toFixed(2)}
              </p>
              <p className="text-xs text-stone-400">Média por pedido • período: {preset}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase tracking-wide text-stone-500">Ao vivo</p>
              <p className="text-lg font-semibold">{data.live?.activeOrders ?? 0} pedidos ativos</p>
              <p className="text-sm text-stone-600">{data.live?.openSessions ?? 0} sessões abertas</p>
              <p className="text-xs text-stone-500 mt-1">
                {data.live?.pendingKitchen ?? ''} {data.live?.pendingBar ?? ''}
              </p>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2 mt-4">
            <Card>
              <h2 className="font-semibold mb-2">Top produtos</h2>
              {data.topProducts?.length ? (
                <ul className="text-sm space-y-2">
                  {data.topProducts.map((p) => (
                    <li key={p.productId || p.product_id} className="flex justify-between gap-2">
                      <span className="truncate">{p.productName || p.product_name}</span>
                      <span className="text-stone-500 shrink-0">
                        {p.quantity} un • R$ {Number(p.revenue).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-stone-400">Sem vendas no período.</p>
              )}
            </Card>

            <Card>
              <h2 className="font-semibold mb-2">Canais & pagamentos</h2>
              {s.channels && (
                <ul className="text-sm space-y-1">
                  {Object.entries(s.channels).map(([k, v]) => (
                    <li key={k} className="flex justify-between">
                      <span className="capitalize">{k}</span>
                      <span className="font-medium">{String(v)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {s.payments && (
                <div className="mt-3 pt-3 border-t border-stone-100">
                  <p className="text-xs text-stone-500 mb-1">Pagamentos</p>
                  <ul className="text-sm space-y-1">
                    {Object.entries(s.payments).map(([k, v]) => (
                      <li key={k} className="flex justify-between">
                        <span>{k}</span>
                        <span>R$ {Number(v).toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!s.channels && !s.payments && <p className="text-sm text-stone-400">Sem breakdown disponível.</p>}
            </Card>
          </div>
        </>
      )}

      <div className="mt-4 flex gap-3 text-sm">
        <Link className="text-amber-700 underline" to="/admin/menu">
          Gerenciar cardápio
        </Link>
        <Link className="text-amber-700 underline" to="/admin/tables">
          Gerenciar mesas
        </Link>
        <Link className="text-amber-700 underline" to="/cashier">
          Caixa
        </Link>
      </div>

      <p className="text-xs text-stone-400 mt-4 text-center">
        Dashboard consome `/api/reports/dashboard` isolado por `store_id` • cache por loja (revalida em 30s)
      </p>
    </Shell>
  );
}
