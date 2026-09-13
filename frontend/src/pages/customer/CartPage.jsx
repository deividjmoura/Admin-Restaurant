import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { Button, Card, ErrorBox, Spinner } from '../../components/Layout';

export default function CartPage() {
  const { token } = useParams();
  const [cart, setCart] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    let sid = sessionStorage.getItem('sessionId');
    if (!sid) {
      const table = await api(`/api/tables/by-token/${token}`);
      sid = table.session.id;
      sessionStorage.setItem('sessionId', sid);
      sessionStorage.setItem('cartVersion', String(table.session.cartVersion ?? 0));
    }
    const data = await api(`/api/sessions/${sid}/cart`);
    setCart(data);
    sessionStorage.setItem('cartVersion', String(data.version ?? 0));
  }, [token]);

  useEffect(() => {
    load().catch(setError);
  }, [load]);

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const sid = sessionStorage.getItem('sessionId');
      const version = Number(sessionStorage.getItem('cartVersion') || 0);
      const res = await api(`/api/sessions/${sid}/cart/checkout`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: version }),
      });
      alert(`Pedido enviado! #${res.order?.id?.slice(0, 8) || ''}`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (error && !cart) {
    return (
      <div className="p-6">
        <ErrorBox error={error} />
      </div>
    );
  }
  if (!cart) return <Spinner />;

  return (
    <div className="mx-auto max-w-lg px-4 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Carrinho</h1>
        <Link to={`/m/${token}/menu`}>
          <Button variant="secondary">Cardápio</Button>
        </Link>
      </div>
      <ErrorBox error={error} />
      {(cart.items || []).length === 0 && (
        <Card>
          <p className="text-stone-600 text-sm">Carrinho vazio.</p>
        </Card>
      )}
      {(cart.items || []).map((item) => (
        <Card key={item.id} className="flex justify-between gap-3">
          <div>
            <p className="font-medium">
              {item.quantity}× {item.productName}
            </p>
          </div>
          <p className="font-semibold text-amber-700">
            R$ {Number(item.lineTotal).toFixed(2)}
          </p>
        </Card>
      ))}
      {cart.totals && (
        <Card className="flex justify-between items-center">
          <span className="text-stone-600">Total</span>
          <span className="text-lg font-bold">
            R$ {Number(cart.totals.amount).toFixed(2)}
          </span>
        </Card>
      )}
      <Button
        className="w-full"
        disabled={busy || !(cart.items || []).length}
        onClick={checkout}
      >
        {busy ? 'Enviando…' : 'Fazer pedido'}
      </Button>
    </div>
  );
}
