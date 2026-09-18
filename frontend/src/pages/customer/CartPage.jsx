import { useCallback, useEffect, useState } from 'react';
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

function getIdempotencyKey() {
  let key = sessionStorage.getItem('checkoutIdempotencyKey');
  if (!key) {
    key =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `chk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem('checkoutIdempotencyKey', key);
  }
  return key;
}

function clearIdempotencyKey() {
  sessionStorage.removeItem('checkoutIdempotencyKey');
}

export default function CartPage() {
  const { token } = useParams();
  const [cart, setCart] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastOrder, setLastOrder] = useState(null);

  const load = useCallback(async () => {
    let sid = sessionStorage.getItem('sessionId');
    if (!sid) {
      const table = await api(`/api/tables/by-token/${token}`);
      sid = table.session.id;
      sessionStorage.setItem('sessionId', sid);
      sessionStorage.setItem(
        'cartVersion',
        String(table.session.cartVersion ?? 0)
      );
      if (table.storeSlug) {
        setTenantSlug(table.storeSlug);
        sessionStorage.setItem('storeSlug', table.storeSlug);
      }
    } else {
      const storedSlug = sessionStorage.getItem('storeSlug');
      if (storedSlug) setTenantSlug(storedSlug);
    }
    const data = await api(`/api/sessions/${sid}/cart`);
    setCart(data);
    sessionStorage.setItem('cartVersion', String(data.version ?? 0));
    return data;
  }, [token]);

  useEffect(() => {
    load().catch(setError);
    const id = setInterval(() => {
      load().catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  async function removeItem(itemId) {
    setError(null);
    const sid = sessionStorage.getItem('sessionId');
    const version = Number(sessionStorage.getItem('cartVersion') || 0);
    try {
      const res = await api(`/api/sessions/${sid}/cart/items/${itemId}`, {
        method: 'DELETE',
        body: JSON.stringify({ expectedVersion: version }),
      });
      sessionStorage.setItem('cartVersion', String(res.version ?? 0));
      setCart(res.cart || (await load()));
    } catch (err) {
      if (err.code === 'CART_VERSION_CONFLICT' || err.status === 409) {
        const current = err.data?.error?.details?.currentVersion;
        if (current != null) sessionStorage.setItem('cartVersion', String(current));
        setError(new Error('Carrinho atualizado por outra pessoa — recarregado'));
        load().catch(() => {});
      } else {
        setError(err);
      }
    }
  }

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const sid = sessionStorage.getItem('sessionId');
      const version = Number(sessionStorage.getItem('cartVersion') || 0);
      const idempotencyKey = getIdempotencyKey();
      const res = await api(`/api/sessions/${sid}/cart/checkout`, {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify({ expectedVersion: version, idempotencyKey }),
      });
      clearIdempotencyKey();
      setLastOrder(res.order);
      await load();
      if (res.replayed) {
        setError(
          new Error('Pedido já enviado anteriormente — exibindo novamente.')
        );
      }
      setTimeout(() => setLastOrder(null), 8000);
    } catch (err) {
      if (err.code === 'CART_VERSION_CONFLICT' || err.status === 409) {
        const current = err.data?.error?.details?.currentVersion;
        if (current != null) sessionStorage.setItem('cartVersion', String(current));
        setError(new Error('Carrinho foi alterado — recarregue e tente novamente'));
        load().catch(() => {});
      } else if (err.code === 'CART_EMPTY') {
        setError(new Error('Carrinho vazio — adicione itens antes de pedir.'));
        clearIdempotencyKey();
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && !cart) {
    return (
      <div className="p-6 space-y-4 max-w-lg mx-auto">
        <ErrorBox error={error} title="Não foi possível carregar o carrinho" />
        <Link to={`/m/${token}/menu`}>
          <Button variant="secondary">Voltar ao cardápio</Button>
        </Link>
      </div>
    );
  }
  if (!cart) return <Spinner label="Carregando carrinho…" />;

  const items = cart.items || [];
  const isEmpty = items.length === 0;

  return (
    <div className="mx-auto max-w-lg px-4 py-4 space-y-4 pb-24">
      <div className="flex items-center justify-between sticky top-0 bg-stone-50/95 backdrop-blur py-2 z-10 border-b border-stone-200 -mx-4 px-4">
        <h1 className="text-xl font-bold text-stone-900">Carrinho</h1>
        <Link to={`/m/${token}/menu`}>
          <Button variant="secondary">Cardápio</Button>
        </Link>
      </div>

      <ErrorBox error={error} title="Atenção" />

      {lastOrder && (
        <SuccessBox>
          <p className="font-semibold">Pedido enviado</p>
          <p className="mt-0.5">
            #{String(lastOrder.id || '').slice(0, 8)} ·{' '}
            {lastOrder.status || 'PENDING'} — a cozinha já pode preparar.
          </p>
        </SuccessBox>
      )}

      {isEmpty && !lastOrder && (
        <EmptyState
          title="Carrinho vazio"
          description="Compartilhe o QR da mesa — o carrinho é compartilhado. Adicionem juntos no cardápio."
          action={
            <Link to={`/m/${token}/menu`}>
              <Button>Ir ao cardápio</Button>
            </Link>
          }
        />
      )}

      {items.map((item) => (
        <Card key={item.id} className="flex justify-between gap-3 items-center">
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate text-stone-900">
              {item.quantity}× {item.productName}
            </p>
            {item.notes && (
              <p className="text-xs text-stone-500">{item.notes}</p>
            )}
            <p className="text-xs text-stone-400">
              v{cart.version} · {item.station || 'KITCHEN'}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-semibold text-amber-700">
              R${' '}
              {Number(
                item.lineTotal ?? item.unitPrice * item.quantity
              ).toFixed(2)}
            </p>
            <button
              type="button"
              onClick={() => removeItem(item.id)}
              className="text-xs text-red-600 underline mt-1"
              disabled={busy}
            >
              remover
            </button>
          </div>
        </Card>
      ))}

      {cart.totals && !isEmpty && (
        <Card className="flex justify-between items-center bg-amber-50 border-amber-200">
          <span className="text-stone-700 font-medium">Total</span>
          <span className="text-lg font-bold text-amber-800">
            R$ {Number(cart.totals.amount).toFixed(2)}
          </span>
        </Card>
      )}

      {!isEmpty && (
        <div className="space-y-2">
          <Button className="w-full" disabled={busy} onClick={checkout}>
            {busy ? 'Enviando…' : 'Fazer pedido'}
          </Button>
          <p className="text-[11px] text-center text-stone-400">
            Idempotente · se a rede falhar, toque de novo — não duplica
          </p>
        </div>
      )}

      <div className="text-center">
        <Link to={`/m/${token}`} className="text-sm text-stone-500 underline">
          Voltar à mesa
        </Link>
      </div>
    </div>
  );
}
