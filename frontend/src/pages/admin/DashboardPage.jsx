import { useCallback, useEffect, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';
import { ADMIN_NAV } from './adminNav';

export default function DashboardPage() {
  const { user, loading, logout } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await api('/api/reports/dashboard?preset=today');
    setData(res);
  }, []);

  useEffect(() => {
    if (!user) return;
    load().catch(setError);
    const id = setInterval(() => load().catch(() => {}), 30000);
    return () => clearInterval(id);
  }, [user, load]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/admin' }} />;

  async function onRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setRefreshing(false);
    }
  }

  const s = data?.summary;

  return (
    <Shell title="Dashboard" nav={ADMIN_NAV}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-stone-500">
          Olá, <span className="font-medium text-stone-800">{user.email || user.name || 'staff'}</span>
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="!py-1.5" disabled={refreshing} onClick={onRefresh}>
            {refreshing ? '…' : 'Atualizar'}
          </Button>
          <Button variant="secondary" className="!py-1.5" onClick={() => logout()}>
            Sair
          </Button>
        </div>
      </div>

      <ErrorBox error={error} />
      {!data && !error && <Spinner />}

      {s && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <p className="text-xs text-stone-500">Pedidos (válidos) · hoje</p>
            <p className="text-3xl font-bold">{s.orders?.valid ?? 0}</p>
            <p className="text-xs text-stone-500 mt-1">
              Mesa {s.orders?.table ?? 0} · Delivery {s.orders?.delivery ?? 0}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-stone-500">Receita · hoje</p>
            <p className="text-3xl font-bold">
              R$ {Number(s.revenue?.total || 0).toFixed(2)}
            </p>
            <p className="text-xs text-stone-500 mt-1">
              Ticket médio R$ {Number(s.revenue?.averageTicket || 0).toFixed(2)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-stone-500">Ao vivo</p>
            <p className="text-lg font-semibold">
              {data.live?.activeOrders ?? 0} pedidos ativos
            </p>
            <p className="text-sm text-stone-600">
              {data.live?.openSessions ?? 0} sessões abertas
            </p>
          </Card>
        </div>
      )}

      {data?.topProducts?.length > 0 && (
        <Card className="mt-4">
          <h2 className="font-semibold mb-2">Top produtos · hoje</h2>
          <ul className="text-sm space-y-1">
            {data.topProducts.map((p) => (
              <li key={p.productId} className="flex justify-between gap-2">
                <span className="truncate">{p.productName}</span>
                <span className="text-stone-500 shrink-0">
                  {p.quantity} · R$ {Number(p.revenue).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <Link className="text-amber-700 underline" to="/admin/menu">
          Gerenciar cardápio
        </Link>
        <Link className="text-amber-700 underline" to="/admin/tables">
          Gerenciar mesas
        </Link>
        <Link className="text-amber-700 underline" to="/cashier">
          Ir ao caixa
        </Link>
      </div>
    </Shell>
  );
}
