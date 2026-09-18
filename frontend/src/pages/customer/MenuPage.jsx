import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, setTenantSlug } from '../../api/client';
import {
  Button,
  Card,
  ErrorBox,
  Spinner,
  EmptyState,
  SuccessBox,
} from '../../components/Layout';

export default function MenuPage() {
  const { token } = useParams();
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState(null);
  const [cartCount, setCartCount] = useState(0);

  const refreshCartCount = useCallback(async () => {
    const sid = sessionStorage.getItem('sessionId');
    if (!sid) return;
    try {
      const data = await api(`/api/sessions/${sid}/cart`);
      const items = data.items || [];
      const n = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
      setCartCount(n);
      sessionStorage.setItem('cartVersion', String(data.version ?? 0));
    } catch {
      /* ignore */
    }
  }, []);

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
          if (table.storeSlug) {
            setTenantSlug(table.storeSlug);
            sessionStorage.setItem('storeSlug', table.storeSlug);
          }
          if (table.storeName) sessionStorage.setItem('storeName', table.storeName);
        } else {
          const storedSlug = sessionStorage.getItem('storeSlug');
          if (storedSlug) setTenantSlug(storedSlug);
        }
        const data = await api('/api/menu');
        setMenu(data);
        await refreshCartCount();
      } catch (err) {
        setError(err);
      }
    })();
  }, [token, refreshCartCount]);

  async function addItem(product) {
    setMsg('');
    setError(null);
    setAdding(product.id);
    const sid = sessionStorage.getItem('sessionId');
    if (!sid) {
      setError(new Error('Sessão não encontrada — escaneie o QR novamente.'));
      setAdding(null);
      return;
    }
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
      const nextVersion = res.version ?? res.cart?.version ?? version + 1;
      sessionStorage.setItem('cartVersion', String(nextVersion));
      setMsg(`${product.name} adicionado`);
      setTimeout(() => setMsg(''), 2500);
      await refreshCartCount();
    } catch (err) {
      if (err.code === 'CART_VERSION_CONFLICT' || err.status === 409) {
        const current = err.data?.error?.details?.currentVersion;
        if (current != null) sessionStorage.setItem('cartVersion', String(current));
        setError(new Error('Carrinho atualizado por outra pessoa — tente de novo'));
        try {
          await refreshCartCount();
        } catch {
          /* ignore */
        }
      } else {
        setError(err);
      }
    } finally {
      setAdding(null);
    }
  }

  if (error && !menu) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 space-y-4">
        <ErrorBox error={error} title="Não foi possível carregar o cardápio" />
        <Link to={`/m/${token}`}>
          <Button variant="secondary">Voltar à mesa</Button>
        </Link>
      </div>
    );
  }
  if (!menu) return <Spinner label="Carregando cardápio…" />;

  const categories = menu.categories || menu.menu?.categories || [];
  const storeName = sessionStorage.getItem('storeName') || menu.store?.name || null;

  const cartBtn = (
    <Link to={`/m/${token}/cart`} className="relative inline-flex">
      <Button variant="secondary">Carrinho</Button>
      {cartCount > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[1.25rem] h-5 px-1 rounded-full bg-amber-600 text-white text-[10px] font-bold flex items-center justify-center">
          {cartCount > 99 ? '99+' : cartCount}
        </span>
      )}
    </Link>
  );

  if (categories.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-4 space-y-4">
        <div className="flex items-center justify-between sticky top-0 bg-stone-50 py-2 z-10">
          <h1 className="text-xl font-bold">Cardápio</h1>
          {cartBtn}
        </div>
        <EmptyState
          title="Cardápio vazio ou indisponível"
          description={
            storeName
              ? `${storeName} — peça para o salão cadastrar produtos.`
              : 'Peça para o salão cadastrar produtos no admin.'
          }
          action={
            <Link to={`/m/${token}`}>
              <Button variant="secondary">Voltar à mesa</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-4 space-y-4 pb-24">
      <div className="flex items-center justify-between sticky top-0 bg-stone-50/95 backdrop-blur py-2 z-10 border-b border-stone-200 -mx-4 px-4">
        <div>
          <h1 className="text-xl font-bold">Cardápio</h1>
          {storeName && <p className="text-xs text-stone-500">{storeName}</p>}
        </div>
        {cartBtn}
      </div>
      <SuccessBox>{msg}</SuccessBox>
      <ErrorBox error={error} title="Atenção" />
      {categories.map((cat) => (
        <section key={cat.id} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            {cat.name}
          </h2>
          {(cat.products || []).length === 0 && (
            <p className="text-xs text-stone-400">Nenhum produto nesta categoria.</p>
          )}
          {(cat.products || []).map((p) => (
            <Card key={p.id} className="flex gap-3 items-start">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{p.name}</p>
                {p.description && (
                  <p className="text-sm text-stone-500 mt-0.5 line-clamp-2">
                    {p.description}
                  </p>
                )}
                <p className="text-amber-700 font-semibold mt-1">
                  R$ {Number(p.price).toFixed(2)}
                </p>
                {!p.isAvailable && (
                  <p className="text-xs text-red-600 mt-1">Indisponível</p>
                )}
                {p.station === 'BAR' && p.isAvailable && (
                  <p className="text-[10px] uppercase tracking-wide text-stone-400 mt-1">
                    Bebidas · BAR
                  </p>
                )}
              </div>
              <Button
                disabled={!p.isAvailable || adding === p.id}
                onClick={() => addItem(p)}
                className="shrink-0"
                title={p.isAvailable ? 'Adicionar ao carrinho' : 'Indisponível'}
              >
                {adding === p.id ? '…' : '+'}
              </Button>
            </Card>
          ))}
        </section>
      ))}
      <div className="fixed bottom-4 left-0 right-0 flex justify-center pointer-events-none px-4">
        <Link
          to={`/m/${token}/cart`}
          className="pointer-events-auto shadow-lg rounded-full bg-amber-600 text-white text-sm font-semibold px-6 py-3"
        >
          {cartCount > 0 ? `Ver carrinho (${cartCount})` : 'Ver carrinho'}
        </Link>
      </div>
    </div>
  );
}
