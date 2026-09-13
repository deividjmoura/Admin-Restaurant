import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';

export default function WaiterPage() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const data = await api('/api/waiter/ready-items');
    setItems(data.items || data || []);
  }, []);

  useEffect(() => {
    if (!user) return;
    load().catch(setError);
    const id = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(id);
  }, [user, load]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/waiter' }} />;

  async function deliver(itemId) {
    try {
      await api(`/api/waiter/items/${itemId}/deliver`, { method: 'PATCH' });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Shell
      title="Garçom"
      nav={[
        { to: '/kitchen', label: 'Cozinha' },
        { to: '/waiter', label: 'Garçom' },
        { to: '/cashier', label: 'Caixa' },
      ]}
    >
      <ErrorBox error={error} />
      <div className="space-y-3">
        {items.length === 0 && (
          <Card>
            <p className="text-sm text-stone-500">Nenhum item pronto.</p>
          </Card>
        )}
        {items.map((it) => (
          <Card key={it.id} className="flex justify-between items-center gap-3">
            <div>
              <p className="font-medium">
                {it.quantity}× {it.productName || it.product_name}
              </p>
              <p className="text-xs text-stone-500">
                Mesa / pedido #{String(it.orderId || it.order_id || '').slice(0, 8)}
              </p>
            </div>
            <Button onClick={() => deliver(it.id)}>Entregar</Button>
          </Card>
        ))}
      </div>
    </Shell>
  );
}
