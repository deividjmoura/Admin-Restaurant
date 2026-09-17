import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { Button, Card, ErrorBox, Spinner } from '../../components/Layout';
import {
  getSessionId,
  setSessionId,
  getCartVersion,
  setCartVersion,
  setTableMeta,
  getTableMeta,
} from '../../lib/session';

async function ensureSession(token) {
  let sid = getSessionId(token);
  if (sid) return sid;
  const table = await api(`/api/tables/by-token/${token}`);
  sid = table.session.id;
  setSessionId(token, sid);
  setCartVersion(token, table.session.cartVersion ?? 0);
  if (table.table) {
    setTableMeta(token, {
      number: table.table.number,
      label: table.table.label,
      storeId: table.storeId,
    });
  }
  return sid;
}

export default function MenuPage() {
  const { token } = useParams();
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState('');
  const [addingId, setAddingId] = useState(null);
  const tableMeta = getTableMeta(token);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureSession(token);
        const data = await api('/api/menu');
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
    try {
      const sid = await ensureSession(token);
      const version = getCartVersion(token);
      const res = await api(`/api/sessions/${sid}/cart/items`, {
        method: 'POST',
        body: JSON.stringify({
          productId: product.id,
          quantity: 1,
          expectedVersion: version,
        }),
      });
      setCartVersion(token, res.version ?? res.cart?.version ?? version + 1);
      setMsg(`${product.name} adicionado ao carrinho`);
    } catch (err) {
      if (err.code === 'CART_VERSION_CONFLICT' || err.status === 409) {
        const current =
          err.data?.error?.details?.currentVersion ??
          err.data?.error?.details?.currentVersion;
        if (current != null) setCartVersion(token, current);
        setError(
          new Error('Carrinho atualizado por outra pessoa — toque de novo para adicionar')
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
      <div className="p-6">
        <ErrorBox error={error} />
      </div>
    );
  }
  if (!menu) return <Spinner />;

  const categories = menu.categories || menu.menu?.categories || [];
  const storeName = menu.store?.name;
  const tableLabel =
    tableMeta?.label || (tableMeta?.number != null ? `Mesa ${tableMeta.number}` : null);

  return (
    <div className="mx-auto max-w-lg px-4 py-4 space-y-4 pb-28">
      <div className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-stone-50/95 backdrop-blur border-b border-stone-200">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {storeName && (
              <p className="text-xs text-stone-500 truncate">{storeName}</p>
            )}
            <h1 className="text-xl font-bold text-stone-900 truncate">
              {tableLabel ? `${tableLabel} · Cardápio` : 'Cardápio'}
            </h1>
          </div>
          <Link to={`/m/${token}/cart`}>
            <Button variant="secondary">Carrinho</Button>
          </Link>
        </div>
      </div>

      {msg && (
        <div className="rounded-xl bg-green-50 border border-green-200 text-green-800 text-sm px-3 py-2">
          {msg}
        </div>
      )}
      <ErrorBox error={error} />

      {categories.length === 0 && (
        <Card>
          <p className="text-sm text-stone-600">Cardápio ainda não disponível.</p>
        </Card>
      )}

      {categories.map((cat) => (
        <section key={cat.id} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            {cat.name}
          </h2>
          {(cat.products || []).map((p) => {
            const available = p.isAvailable !== false && p.is_available !== false;
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
                  aria-label={`Adicionar ${p.name}`}
                >
                  {addingId === p.id ? '…' : '+'}
                </Button>
              </Card>
            );
          })}
        </section>
      ))}

      <div className="fixed bottom-0 inset-x-0 p-4 bg-gradient-to-t from-stone-50 via-stone-50 to-transparent">
        <div className="mx-auto max-w-lg">
          <Link to={`/m/${token}/cart`}>
            <Button className="w-full shadow-lg">Ir para o carrinho</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
