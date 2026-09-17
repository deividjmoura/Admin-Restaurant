import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Shell, Card, Spinner, ErrorBox } from '../../components/Layout';

function formatBRL(v) {
  return `R$ ${Number(v || 0).toFixed(2)}`;
}

export default function DeliveryTrackPage() {
  const { orderId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const res = await api(`/api/delivery/orders/${orderId}`);
    setData(res);
  }, [orderId]);

  useEffect(() => {
    load().catch(setError);
    const id = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(id);
  }, [load]);

  if (error) return <Shell title="Acompanhar pedido"><ErrorBox error={error} /><Link className="text-sm text-amber-700 underline" to="/delivery">Voltar</Link></Shell>;
  if (!data) return <Shell title="Acompanhar pedido"><Spinner /></Shell>;

  const order = data.order;
  const delivery = data.delivery;
  const items = data.items || [];

  const statusColor = {
    PENDING: 'bg-stone-100',
    CONFIRMED: 'bg-blue-50 border-blue-200',
    PREPARING: 'bg-amber-50 border-amber-200',
    READY: 'bg-green-50 border-green-200',
    DELIVERED: 'bg-green-600 text-white',
    CANCELLED: 'bg-red-50 border-red-200',
  }[order.status] || 'bg-white';

  return (
    <Shell title="Acompanhar pedido" nav={[{ to: '/delivery', label: 'Delivery' }]}>
      <Card className={`${statusColor} border`}>
        <p className="text-xs text-stone-500">Pedido #{String(order.id).slice(0, 8)} • {order.channel}</p>
        <p className="text-2xl font-bold">{order.status}</p>
        <p className="text-xs text-stone-500">Atualiza a cada 5s • {new Date(order.createdAt || Date.now()).toLocaleTimeString()}</p>
      </Card>

      {delivery && (
        <Card className="mt-3">
          <h2 className="font-semibold mb-2">Entrega</h2>
          <p className="text-sm"><span className="font-medium">{delivery.customerName}</span> {delivery.customerPhone && `• ${delivery.customerPhone}`}</p>
          <p className="text-sm text-stone-600">
            {delivery.address?.street}{delivery.address?.number ? `, ${delivery.address.number}` : ''} {delivery.address?.neighborhood ? `— ${delivery.address.neighborhood}` : ''}<br />
            {delivery.address?.city}/{delivery.address?.state} {delivery.address?.postalCode || ''}
          </p>
          <p className="text-sm mt-2">Taxa: {formatBRL(delivery.deliveryFee)} • ETA {delivery.etaMinutesMin}-{delivery.etaMinutesMax} min</p>
          {delivery.notes && <p className="text-xs text-stone-500 mt-1">Obs: {delivery.notes}</p>}
        </Card>
      )}

      <Card className="mt-3">
        <h2 className="font-semibold mb-2">Itens</h2>
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.id} className="flex justify-between text-sm border border-stone-100 rounded-lg px-2 py-1">
              <span>{it.quantity}× {it.productName} • {it.station} • {it.status}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-4 flex gap-3">
        <Link className="text-sm text-amber-700 underline" to="/delivery">Novo pedido</Link>
        <Link className="text-sm text-stone-500 underline" to="/">Início</Link>
      </div>
    </Shell>
  );
}
