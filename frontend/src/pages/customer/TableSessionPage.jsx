import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
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
      <div className="p-6">
        <ErrorBox error={error} />
      </div>
    );
  }
  if (!data) return <Spinner />;

  return (
    <div className="mx-auto max-w-lg px-4 py-8 space-y-4">
      <Card>
        <p className="text-xs uppercase text-stone-500">Mesa</p>
        <h1 className="text-2xl font-bold">
          {data.table.label || `Mesa ${data.table.number}`}
        </h1>
        <p className="text-sm text-stone-600 mt-1">
          Sessão aberta · carrinho compartilhado
        </p>
        <div className="mt-4 flex gap-2">
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
