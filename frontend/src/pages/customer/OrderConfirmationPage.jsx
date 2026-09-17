import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { Button, Card, ErrorBox, Spinner } from '../../components/Layout';

export default function OrderConfirmationPage() {
  const { token, orderId } = useParams();
  const location = useLocation();
  const [order, setOrder] = useState(location.state?.order || null);
  const [items, setItems] = useState(location.state?.items || null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (order && items) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api(`/api/orders/${orderId}`);
        if (cancelled) return;
        setOrder(data.order);
        setItems(data.items);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, order, items]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <ErrorBox error={error} />
        <div className="mt-4">
          <Link to={`/m/${token}/menu`}>
            <Button variant="secondary">Voltar ao cardápio</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!order) return <Spinner />;

  const shortId = (order.id || orderId || '').slice(0, 8).toUpperCase();

  return (
    <div className="mx-auto max-w-lg px-4 py-10 space-y-5">
      <div className="text-center space-y-2">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-700 text-2xl">
          ✓
        </div>
        <h1 className="text-2xl font-bold text-stone-900">Pedido enviado!</h1>
        <p className="text-sm text-stone-500">
          Código <span className="font-mono font-semibold text-stone-800">#{shortId}</span>
        </p>
        {location.state?.replayed && (
          <p className="text-xs text-amber-700">
            Pedido já registrado (idempotência) — sem duplicar.
          </p>
        )}
      </div>

      <Card className="space-y-3">
        <p className="text-xs uppercase tracking-wide text-stone-500">Itens</p>
        {(items || []).map((it) => (
          <div key={it.id} className="flex justify-between text-sm gap-2">
            <span className="text-stone-800">
              {it.quantity}× {it.productName}
            </span>
            {it.station && (
              <span className="text-xs text-stone-400 uppercase">{it.station}</span>
            )}
          </div>
        ))}
        {(!items || items.length === 0) && (
          <p className="text-sm text-stone-500">Pedido recebido pela cozinha.</p>
        )}
        <div className="pt-2 border-t border-stone-100 text-sm text-stone-600">
          Status: <span className="font-medium text-stone-900">{order.status}</span>
        </div>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Link to={`/m/${token}/menu`} className="flex-1">
          <Button className="w-full">Pedir mais</Button>
        </Link>
        <Link to={`/m/${token}/cart`} className="flex-1">
          <Button variant="secondary" className="w-full">
            Ver carrinho
          </Button>
        </Link>
      </div>
    </div>
  );
}
