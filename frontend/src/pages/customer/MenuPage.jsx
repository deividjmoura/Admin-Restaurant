import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { customer } from '../../api/customer';
import { Button, Card, ErrorBox, Spinner } from '../../components/Layout';

export default function MenuPage() {
  const { token } = useParams();
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState('');
  const [addingId, setAddingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await customer.ensure(token);
        const data = await customer.request(token, '/api/menu');
        if (!cancelled) setMenu(data);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function addItem(product) {
    setMsg('');
    setError(null);
    setAddingId(product.id);
    const sid = sessionStorage.getItem(`table:${token}:sessionId`);
    const version = Number(
      sessionStorage.getItem(`table:${token}:cartVersion`) || 0
    );
    try {
      const res = await customer.request(
        token,
        `/api/sessions/${sid}/cart/items`,
        {
          method: 'POST',
          body: JSON.stringify({
            productId: product.id,
            quantity: 1,
            expectedVersion: version,
          }),
        }
      );
      sessionStorage.setItem(
        `table:${token}:cartVersion`,
        String(res.version ?? res.cart?.version ?? version + 1)
      );
      setMsg(`${product.name} adicionado ao carrinho`);
    } catch (err) {
      if (err.code === 'CART_VERSION_CONFLICT') {
        const current = err.data?.error?.details?.currentVersion;
        if (current != null)
          sessionStorage.setItem(`table:${token}:cartVersion`, String(current));
        setError(
          new Error('Carrinho atualizado por outra pessoa — toque de novo')
        );
      } else {
        setError(err);
      }
    } finally {
      setAddingId(null);
    }
  }

  if (error && !menu) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <ErrorBox error={error} />
        {error && (
          <Link className="underline text-sm" to={`/m/${token}`}>
            Voltar à entrada da mesa
          </Link>
        )}
      </div>
    );
  }
  if (!menu) return <Spinner />;

  const categories = menu.categories || menu.menu?.categories || [];
  const empty =
    categories.length === 0 ||
    categories.every((c) => !(c.products || []).length);

  return (
    <div className="mx-auto max-w-lg px-4 py-4 space-y-4 pb-24">
      <div className="flex items-center justify-between sticky top-0 bg-stone-50/95 backdrop-blur py-2 z-10 -mx-4 px-4 border-b border-stone-100">
        <h1 className="text-xl font-bold text-stone-900">Cardápio</h1>
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
      {error && (
        <Link className="underline text-sm" to={`/m/${token}`}>
          Voltar à entrada da mesa
        </Link>
      )}

      {empty && (
        <Card>
          <p className="text-stone-600 text-sm">Cardápio vazio no momento.</p>
        </Card>
      )}

      {categories.map((cat) => (
        <section key={cat.id} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            {cat.name}
          </h2>
          {(cat.products || []).map((p) => {
            const available =
              p.isAvailable !== false && p.is_available !== false;
            return (
              <Card key={p.id} className="flex gap-3 items-start">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-stone-900">{p.name}</p>
                  {p.description && (
                    <p className="text-sm text-stone-500 mt-0.5 line-clamp-2">
                      {p.description}
                    </p>
                  )}
                  <p className="text-amber-700 font-semibold mt-1">
                    R$ {Number(p.price).toFixed(2)}
                  </p>
                  {!available && (
                    <p className="text-xs text-red-600 mt-1">Indisponível</p>
                  )}
                </div>
                <Button
                  disabled={!available || addingId === p.id}
                  onClick={() => addItem(p)}
                  className="shrink-0"
                >
                  {addingId === p.id ? '…' : '+'}
                </Button>
              </Card>
            );
          })}
        </section>
      ))}
    </div>
  );
}
