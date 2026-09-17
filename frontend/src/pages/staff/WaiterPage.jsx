import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';
import { STAFF_NAV, statusBadgeClass } from './staffNav';

export default function WaiterPage() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [station, setStation] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const q = station ? `?station=${station}` : '';
    const data = await api(`/api/waiter/ready-items${q}`);
    setItems(data.items || []);
  }, [station]);

  useEffect(() => {
    if (!user) return;
    load().catch(setError);
    const id = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(id);
  }, [user, load]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/waiter' }} />;

  async function deliver(itemId) {
    setBusyId(itemId);
    setError(null);
    try {
      await api(`/api/waiter/items/${itemId}/deliver`, { method: 'PATCH' });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Shell title="Garçom" nav={STAFF_NAV}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <p className="text-sm text-stone-500 mr-auto">Itens prontos para entregar</p>
        <select
          className="rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-sm"
          value={station}
          onChange={(e) => setStation(e.target.value)}
        >
          <option value="">Todas as estações</option>
          <option value="KITCHEN">Cozinha</option>
          <option value="BAR">Bar</option>
        </select>
        <Button variant="secondary" className="!py-1.5" onClick={() => load().catch(setError)}>
          Atualizar
        </Button>
      </div>

      <ErrorBox error={error} />

      <div className="space-y-3">
        {items.length === 0 && (
          <Card>
            <p className="text-sm text-stone-500">Nenhum item pronto no momento.</p>
          </Card>
        )}
        {items.map((it) => (
          <Card key={it.id} className="flex justify-between items-center gap-3">
            <div className="min-w-0">
              <p className="font-medium text-stone-900">
                {it.quantity}× {it.productName || it.product_name}
              </p>
              <p className="text-xs text-stone-500 mt-0.5">
                Pedido #{String(it.orderId || it.order_id || '').slice(0, 8)}
                {it.station ? ` · ${it.station}` : ''}
                {it.tableNumber || it.table_number
                  ? ` · Mesa ${it.tableNumber || it.table_number}`
                  : ''}
              </p>
              <span
                className={`inline-block mt-1 rounded-full px-2 py-0.5 text-xs ${statusBadgeClass(it.status || 'READY')}`}
              >
                {it.status || 'READY'}
              </span>
            </div>
            <Button disabled={busyId === it.id} onClick={() => deliver(it.id)}>
              {busyId === it.id ? '…' : 'Entregar'}
            </Button>
          </Card>
        ))}
      </div>
    </Shell>
  );
}
