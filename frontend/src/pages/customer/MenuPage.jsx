import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { Button, Card, ErrorBox, Spinner } from '../../components/Layout';

export default function MenuPage() {
  const { token } = useParams();
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      try {
        let sessionId = sessionStorage.getItem('sessionId');
        if (!sessionId) {
          const table = await api(`/api/tables/by-token/${token}`);
          sessionStorage.setItem('sessionId', table.session.id);
          sessionStorage.setItem(
            'cartVersion',
            String(table.session.cartVersion ?? 0)
          );
        }
        const data = await api('/api/menu');
        setMenu(data);
      } catch (err) {
        setError(err);
      }
    })();
  }, [token]);

  async function addItem(product) {
    setMsg('');
    setError(null);
    const sid = sessionStorage.getItem('sessionId');
    const version = Number(sessionStorage.getItem('cartVersion') || 0);
    try {
      const res = await api(`/api/sessions/${sid}/cart/items`, {
        method: 'POST',
        body: JSON.stringify({
          productId: product.id,
          quantity: 1,
          expectedVersion: version,
        }),
      });
      sessionStorage.setItem(
        'cartVersion',
        String(res.version ?? res.cart?.version ?? version + 1)
      );
      setMsg(`${product.name} adicionado`);
    } catch (err) {
      if (err.code === 'CART_VERSION_CONFLICT' || err.status === 409) {
        const current = err.data?.error?.details?.currentVersion;
        if (current != null) sessionStorage.setItem('cartVersion', String(current));
        setError(new Error('Carrinho atualizado por outra pessoa — tente de novo'));
      } else {
        setError(err);
      }
    }
  }

  if (error && !menu) {
    return (
      <div className="p-6">
        <ErrorBox error={error} />
      </div>
    );
  }
  if (!menu) return <Spinner />;

  const categories = menu.categories || menu.menu?.categories || [];

  return (
    <div className="mx-auto max-w-lg px-4 py-4 space-y-4 pb-24">
      <div className="flex items-center justify-between sticky top-0 bg-stone-50 py-2 z-10">
        <h1 className="text-xl font-bold">Cardápio</h1>
        <Link to={`/m/${token}/cart`}>
          <Button variant="secondary">Carrinho</Button>
        </Link>
      </div>
      {msg && (
        <div className="rounded-xl bg-green-50 border border-green-200 text-green-800 text-sm px-3 py-2">
          {msg}
        </div>
      )}
      <ErrorBox error={error} />
      {categories.map((cat) => (
        <section key={cat.id} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            {cat.name}
          </h2>
          {(cat.products || []).map((p) => (
            <Card key={p.id} className="flex gap-3 items-start">
              <div className="flex-1">
                <p className="font-medium">{p.name}</p>
                {p.description && (
                  <p className="text-sm text-stone-500 mt-0.5">{p.description}</p>
                )}
                <p className="text-amber-700 font-semibold mt-1">
                  R$ {Number(p.price).toFixed(2)}
                </p>
                {!p.isAvailable && (
                  <p className="text-xs text-red-600 mt-1">Indisponível</p>
                )}
              </div>
              <Button disabled={!p.isAvailable} onClick={() => addItem(p)}>
                +
              </Button>
            </Card>
          ))}
        </section>
      ))}
    </div>
  );
}
