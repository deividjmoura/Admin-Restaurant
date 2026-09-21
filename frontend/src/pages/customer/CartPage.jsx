import { useCallback, useEffect, useState, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { newIdempotencyKey } from '../../api/client';
import { customer } from '../../api/customer';
import { Button, Card, ErrorBox, Spinner } from '../../components/Layout';

export default function CartPage() {
  const { token } = useParams();
  const [cart, setCart] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [orderResult, setOrderResult] = useState(null);
  const checkoutKey = useRef(null);
  const activeQr = useRef(token);
  activeQr.current = token;
  useEffect(() => {
    checkoutKey.current = null;
    setCart(null);
    setOrderResult(null);
    setError(null);
  }, [token]);

  const ensureSession = useCallback(
    async () => (await customer.ensure(token)).id,
    [token]
  );

  const load = useCallback(async () => {
    const sid = await ensureSession();
    const data = await customer.request(token, `/api/sessions/${sid}/cart`);
    if (activeQr.current !== token) return;
    setCart(data);
    sessionStorage.setItem(
      `table:${token}:cartVersion`,
      String(data.version ?? 0)
    );
  }, [ensureSession, token]);

  useEffect(() => {
    load().catch(setError);
  }, [load]);

  async function changeQty(item, delta) {
    setError(null);
    const sid = sessionStorage.getItem(`table:${token}:sessionId`);
    const version = Number(
      sessionStorage.getItem(`table:${token}:cartVersion`) || 0
    );
    const nextQty = (item.quantity || 1) + delta;
    try {
      if (nextQty <= 0) {
        await customer.request(
          token,
          `/api/sessions/${sid}/cart/items/${item.id}`,
          {
            method: 'DELETE',
            body: JSON.stringify({ expectedVersion: version }),
          }
        );
      } else {
        await customer.request(
          token,
          `/api/sessions/${sid}/cart/items/${item.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              quantity: nextQty,
              expectedVersion: version,
            }),
          }
        );
      }
      await load();
    } catch (err) {
      if (err.status >= 400 && err.status < 500) checkoutKey.current = null;
      if (err.code === 'CART_VERSION_CONFLICT') {
        const current = err.data?.error?.details?.currentVersion;
        if (current != null)
          sessionStorage.setItem(`table:${token}:cartVersion`, String(current));
        setError(
          new Error('Carrinho atualizado por outra pessoa — atualizando…')
        );
        await load().catch(() => {});
      } else {
        setError(err);
      }
    }
  }

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const sid = sessionStorage.getItem(`table:${token}:sessionId`);
      const version = Number(
        sessionStorage.getItem(`table:${token}:cartVersion`) || 0
      );
      const idempotencyKey = (checkoutKey.current ||= newIdempotencyKey());
      const res = await customer.request(
        token,
        `/api/sessions/${sid}/cart/checkout`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({
            expectedVersion: version,
            idempotencyKey,
          }),
        }
      );
      setOrderResult(res);
      checkoutKey.current = null;
      sessionStorage.setItem(`table:${token}:cartVersion`, '0');
      await load().catch(() =>
        setCart({ items: [], version: 0, totals: { amount: 0 } })
      );
    } catch (err) {
      if (err.status >= 400 && err.status < 500) checkoutKey.current = null;
      if (err.code === 'CART_VERSION_CONFLICT') {
        const current = err.data?.error?.details?.currentVersion;
        if (current != null)
          sessionStorage.setItem(`table:${token}:cartVersion`, String(current));
        setError(
          new Error('Carrinho mudou — confira os itens e tente de novo')
        );
        await load().catch(() => {});
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  if (orderResult) {
    const orderId = orderResult.order?.id || '';
    const shortId = orderId.slice(0, 8).toUpperCase();
    return (
      <div className="mx-auto max-w-lg px-4 py-8 space-y-4">
        <Card className="text-center space-y-3">
          <p className="text-4xl" aria-hidden>
            ✓
          </p>
          <h1 className="text-xl font-bold text-stone-900">Pedido enviado!</h1>
          <p className="text-stone-600 text-sm">
            Número do pedido{' '}
            <span className="font-mono font-semibold text-amber-700">
              #{shortId}
            </span>
          </p>
          {orderResult.replayed && (
            <p className="text-xs text-stone-500">
              Pedido já havia sido registrado (retry seguro).
            </p>
          )}
          <p className="text-sm text-stone-500">
            A cozinha já recebeu. Você pode pedir mais quando quiser.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Link to={`/m/${token}/menu`} className="flex-1">
              <Button className="w-full" onClick={() => setOrderResult(null)}>
                Voltar ao cardápio
              </Button>
            </Link>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setOrderResult(null)}
            >
              Ver carrinho
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (error && !cart) {
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
  if (!cart) return <Spinner />;

  const items = cart.items || [];
  const total = Number(cart.totals?.amount ?? 0);

  return (
    <div className="mx-auto max-w-lg px-4 py-4 space-y-4 pb-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-stone-900">Carrinho</h1>
        <Link to={`/m/${token}/menu`}>
          <Button variant="secondary">Cardápio</Button>
        </Link>
      </div>

      <ErrorBox error={error} />
      {error && (
        <Link className="underline text-sm" to={`/m/${token}`}>
          Voltar à entrada da mesa
        </Link>
      )}

      {items.length === 0 && (
        <Card>
          <p className="text-stone-600 text-sm">Carrinho vazio.</p>
          <Link to={`/m/${token}/menu`} className="inline-block mt-3">
            <Button>Ir ao cardápio</Button>
          </Link>
        </Card>
      )}

      {items.map((item) => (
        <Card key={item.id} className="flex justify-between gap-3 items-center">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-stone-900 truncate">
              {item.productName || item.product_name}
            </p>
            <p className="text-sm text-amber-700 font-semibold">
              R${' '}
              {Number(
                item.lineTotal ?? item.unitPrice * item.quantity ?? 0
              ).toFixed(2)}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="secondary"
              className="!px-2.5 !py-1"
              onClick={() => changeQty(item, -1)}
              aria-label="Diminuir"
            >
              −
            </Button>
            <span className="w-8 text-center text-sm font-medium">
              {item.quantity}
            </span>
            <Button
              variant="secondary"
              className="!px-2.5 !py-1"
              onClick={() => changeQty(item, 1)}
              aria-label="Aumentar"
            >
              +
            </Button>
          </div>
        </Card>
      ))}

      {items.length > 0 && (
        <>
          <Card className="flex justify-between items-center">
            <span className="text-stone-600">Total</span>
            <span className="text-lg font-bold text-stone-900">
              R$ {total.toFixed(2)}
            </span>
          </Card>
          <Button className="w-full" disabled={busy} onClick={checkout}>
            {busy ? 'Enviando pedido…' : 'Fazer pedido'}
          </Button>
          <p className="text-center text-xs text-stone-400">
            Pedido vai direto para a cozinha · carrinho compartilhado na mesa
          </p>
        </>
      )}
    </div>
  );
}
