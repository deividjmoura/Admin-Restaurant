import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { Button, Card, ErrorBox, Spinner } from '../../components/Layout';
import {
  setSessionId,
  setCartVersion,
  setTableMeta,
} from '../../lib/session';

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
        setData(res);
        if (res.session?.id) {
          setSessionId(token, res.session.id);
          setCartVersion(token, res.session.cartVersion ?? 0);
        }
        if (res.table) {
          setTableMeta(token, {
            number: res.table.number,
            label: res.table.label,
            storeId: res.storeId,
          });
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
      <div className="mx-auto max-w-lg px-4 py-8">
        <Card className="space-y-3">
          <h1 className="text-lg font-semibold text-stone-900">Mesa não encontrada</h1>
          <ErrorBox error={error} />
          <p className="text-sm text-stone-500">
            Verifique o QR code ou peça ajuda ao atendente.
          </p>
        </Card>
      </div>
    );
  }
  if (!data) return <Spinner />;

  const tableLabel = data.table.label || `Mesa ${data.table.number}`;

  return (
    <div className="mx-auto max-w-lg px-4 py-10 space-y-5">
      <div className="text-center space-y-1">
        <p className="text-xs uppercase tracking-widest text-amber-600 font-medium">
          Bem-vindo
        </p>
        <h1 className="text-3xl font-bold text-stone-900">{tableLabel}</h1>
        <p className="text-sm text-stone-500">
          Carrinho compartilhado · peça quando quiser
        </p>
      </div>

      <Card className="space-y-4">
        <div className="flex items-center gap-3 text-sm text-stone-600">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700 font-semibold text-xs">
            QR
          </span>
          <div>
            <p className="font-medium text-stone-800">Sessão ativa</p>
            <p className="text-xs text-stone-500">
              Todos na mesa veem o mesmo carrinho
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link to={`/m/${token}/menu`} className="flex-1">
            <Button className="w-full">Ver cardápio</Button>
          </Link>
          <Link to={`/m/${token}/cart`} className="flex-1">
            <Button variant="secondary" className="w-full">
              Ver carrinho
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
