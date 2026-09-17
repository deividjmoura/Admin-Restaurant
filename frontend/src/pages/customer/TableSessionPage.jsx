import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, setTenantSlug } from '../../api/client';
import { Button, Card, ErrorBox, Spinner } from '../../components/Layout';

export default function TableSessionPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api(`/api/tables/by-token/${token}`);
        if (!cancelled) setData(res);
        if (res.session?.id) {
          sessionStorage.setItem('sessionId', res.session.id);
          sessionStorage.setItem('cartVersion', String(res.session.cartVersion ?? 0));
        }
        if (res.storeId) sessionStorage.setItem('storeId', res.storeId);
        if (res.storeSlug) {
          setTenantSlug(res.storeSlug);
          sessionStorage.setItem('storeSlug', res.storeSlug);
        }
        if (res.storeName) sessionStorage.setItem('storeName', res.storeName);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
      <div className="p-6 space-y-4">
        <ErrorBox error={error} />
        <p className="text-sm text-stone-500">Verifique o QR — token: <code className="bg-stone-100 px-1 rounded">{token.slice(0, 8)}…</code></p>
        <Link to="/">
          <Button variant="secondary">Voltar ao início</Button>
        </Link>
      </div>
    );
  }
  if (!data) return <Spinner />;

  return (
    <div className="mx-auto max-w-lg px-4 py-8 space-y-4">
      <Card>
        <p className="text-xs uppercase tracking-widest text-amber-600 font-semibold">
          {data.storeName || sessionStorage.getItem('storeName') || 'Restaurante'}
        </p>
        <p className="text-xs uppercase text-stone-500 mt-1">Mesa</p>
        <h1 className="text-2xl font-bold">
          {data.table.label || `Mesa ${data.table.number}`}
        </h1>
        <p className="text-sm text-stone-600 mt-1">
          Sessão aberta · carrinho compartilhado {data.session?.id ? `· #${data.session.id.slice(0, 6)}` : ''}
        </p>
        <p className="text-xs text-stone-400 mt-1">
          Versão do carrinho: {data.session?.cartVersion ?? 0} • todos na mesa veem o mesmo carrinho
        </p>
        <div className="mt-4 grid gap-2">
          <Link to={`/m/${token}/menu`}>
            <Button className="w-full">Ver cardápio →</Button>
          </Link>
          <Link to={`/m/${token}/cart`}>
            <Button variant="secondary" className="w-full">
              Ver carrinho ({data.session?.cartVersion ?? 0})
            </Button>
          </Link>
        </div>
      </Card>

      <Card className="bg-stone-50">
        <p className="text-sm font-medium">Como funciona?</p>
        <ol className="text-sm text-stone-600 mt-2 space-y-1 list-decimal list-inside">
          <li>Escolha pratos e bebidas no cardápio.</li>
          <li>Carrinho é compartilhado — todos na mesa podem adicionar.</li>
          <li>Feche o pedido com 1 toque. Idempotente: sem duplicar se a rede falhar.</li>
        </ol>
      </Card>

      <p className="text-center text-xs text-stone-400">
        QR token: {token.slice(0, 12)}… • store: {data.storeSlug || '—'}
      </p>
    </div>
  );
}
