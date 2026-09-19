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
        if (cancelled) return;
        if (res.storeSlug) setTenantSlug(res.storeSlug);
        if (res.session?.id) {
          sessionStorage.setItem('sessionId', res.session.id);
          sessionStorage.setItem(
            'cartVersion',
            String(res.session.cartVersion ?? res.session.cart_version ?? 0)
          );
        }
        setData(res);
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
      <div className="mx-auto max-w-lg px-4 py-8">
        <ErrorBox error={error} />
        <p className="mt-3 text-sm text-stone-500">
          Escaneie o QR da mesa novamente ou peça ajuda ao garçom.
        </p>
      </div>
    );
  }
  if (!data) return <Spinner />;

  const storeName = data.storeName || data.store?.name;
  const tableLabel = data.table?.label || `Mesa ${data.table?.number}`;

  return (
    <div className="mx-auto max-w-lg px-4 py-8 space-y-4">
      <Card>
        {storeName && (
          <p className="text-xs uppercase tracking-wide text-amber-700 font-medium">
            {storeName}
          </p>
        )}
        <p className="text-xs uppercase text-stone-500 mt-1">Mesa</p>
        <h1 className="text-2xl font-bold text-stone-900">{tableLabel}</h1>
        <p className="text-sm text-stone-600 mt-1">
          Sessão aberta · carrinho compartilhado com quem está na mesa
        </p>
        <div className="mt-5 flex flex-col sm:flex-row gap-2">
          <Link to={`/m/${token}/menu`} className="flex-1">
            <Button className="w-full">Ver cardápio</Button>
          </Link>
          <Link to={`/m/${token}/cart`} className="flex-1">
            <Button variant="secondary" className="w-full">
              Carrinho
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
