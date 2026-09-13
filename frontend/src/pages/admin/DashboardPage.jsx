import { useEffect, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Spinner, ErrorBox } from '../../components/Layout';

const nav = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/menu', label: 'Cardápio' },
  { to: '/admin/tables', label: 'Mesas' },
  { to: '/cashier', label: 'Caixa' },
];

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return;
    api('/api/reports/dashboard?preset=today')
      .then(setData)
      .catch(setError);
  }, [user]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/admin' }} />;

  const s = data?.summary;

  return (
    <Shell title="Dashboard" nav={nav}>
      <ErrorBox error={error} />
      {!data && !error && <Spinner />}
      {s && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <p className="text-xs text-stone-500">Pedidos (válidos)</p>
            <p className="text-3xl font-bold">{s.orders?.valid ?? 0}</p>
            <p className="text-xs text-stone-500 mt-1">
              Mesa {s.orders?.table ?? 0} · Delivery {s.orders?.delivery ?? 0}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-stone-500">Receita</p>
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
          <h2 className="font-semibold mb-2">Top produtos</h2>
          <ul className="text-sm space-y-1">
            {data.topProducts.map((p) => (
              <li key={p.productId} className="flex justify-between">
                <span>{p.productName}</span>
                <span className="text-stone-500">
                  {p.quantity} · R$ {Number(p.revenue).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="mt-4 flex gap-2 text-sm">
        <Link className="text-amber-700 underline" to="/admin/menu">
          Gerenciar cardápio
        </Link>
        <Link className="text-amber-700 underline" to="/admin/tables">
          Gerenciar mesas
        </Link>
      </div>
    </Shell>
  );
}
