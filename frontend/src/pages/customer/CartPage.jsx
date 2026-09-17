import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { Button, Card, ErrorBox, Spinner } from '../../components/Layout';
import {
  getSessionId,
  setSessionId,
  getCartVersion,
  setCartVersion,
  setTableMeta,
  newIdempotencyKey,
  getCheckoutKey,
  setCheckoutKey,
  clearCheckoutKey,
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

export default function CartPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [cart, setCart] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [itemBusy, setItemBusy] = useState(null);

  const load = useCallback(async () => {
    const sid = await ensureSession(token);
    const data = await api(`/api/sessions/${sid}/cart`);
    setCart(data);
    setCartVersion(token, data.version ?? 0);
  }, [token]);

  useEffect(() => {
    load().catch(setError);
  }, [load]);

  function applyCart(data) {
    setCart(data.cart || data);
    const v = data.version ?? data.cart?.version;
    if (v != null) setCartVersion(token, v);
  }

  async function changeQty(item, delta) {
    setError(null);
    setItemBusy(item.id);
    try {
      const sid = await ensureSession(token);
      const version = getCartVersion(token);
      const next = item.quantity + delta;
      if (next < 1) {
        const res = await api(`/api/sessions/${sid}/cart/items/${item.id}`, {
          method: 'DELETE',
          body: JSON.stringify({ expectedVersion: version }),
        });
        applyCart(res);
      } else {
        const res = await api(`/api/sessions/${sid}/cart/items/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ quantity: next, expectedVersion: version }),
        });
        applyCart(res);
      }
    } catch (err) {
      handleConflict(err);
    } finally {
      setItemBusy(null);
    }
  }

  async function removeItem(item) {
    setError(null);
    setItemBusy(item.id);
    try {
      const sid = await ensureSession(token);
      const version = getCartVersion(token);
      const res = await api(`/api/sessions/${sid}/cart/items/${item.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ expectedVersion: version }),
      });
      applyCart(res);
    } catch (err) {
      handleConflict(err);
    } finally {
      setItemBusy(null);
    }
  }

  function handleConflict(err) {
    if (err.code === 'CART_VERSION_CONFLICT' || err.status === 409) {
      const current = err.data?.error?.details?.currentVersion;
      if (current != null) setCartVersion(token, current);
      setError(
        new Error('Carrinho mudou (outro dispositivo). Atualizando…')
      );
      load().catch(setError);
    } else {
      setError(err);
    }
  }

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const sid = await ensureSession(token);
      const version = getCartVersion(token);

      // Reutiliza key se houver retry da mesma tentativa
      let idemKey = getCheckoutKey(token);
      if (!idemKey) {
        idemKey = newIdempotencyKey();
        setCheckoutKey(token, idemKey);
      }

      const res = await api(`/api/sessions/${sid}/cart/checkout`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: version }),
        idempotencyKey: idemKey,
      });

      clearCheckoutKey(token);
      const orderId = res.order?.id;
      if (orderId) {
        navigate(`/m/${token}/order/${orderId}`, {
          state: { order: res.order, items: res.items, replayed: res.replayed },
        });
      } else {
        await load();
      }
    } catch (err) {
      if (err.code === 'CART_VERSION_CONFLICT' || err.status === 409) {
        handleConflict(err);
        // nova key na próxima tentativa (versão mudou)
        clearCheckoutKey(token);
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && !cart) {
    return (
      <div className="p-6">
        <ErrorBox error={error} />
      </div>
    );
  }
  if (!cart) return <Spinner />;

  const items = cart.items || [];
  const total =
    cart.totals?.amount != null
      ? Number(cart.totals.amount)
      : items.reduce(
          (s, it) => s + Number(it.lineTotal ?? it.unitPrice * it.quantity ?? 0),
          0
        );

  return (
    <div className="mx-auto max-w-lg px-4 py-4 space-y-4 pb-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-stone-900">Carrinho</h1>
        <Link to={`/m/${token}/menu`}>
          <Button variant="secondary">Cardápio</Button>
        </Link>
      </div>

      <p className="text-xs text-stone-500">
        Carrinho compartilhado · mudanças de outros aparelhos aparecem aqui
      </p>

      <ErrorBox error={error} />

      {items.length === 0 && (
        <Card className="text-center space-y-3 py-8">
          <p className="text-stone-600 text-sm">Carrinho vazio.</p>
          <Link to={`/m/${token}/menu`}>
            <Button>Escolher no cardápio</Button>
          </Link>
        </Card>
      )}

      {items.map((item) => (
        <Card key={item.id} className="space-y-2">
          <div className="flex justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-stone-900">{item.productName}</p>
              {item.notes && (
                <p className="text-xs text-stone-500 mt-0.5">{item.notes}</p>
              )}
            </div>
            <p className="font-semibold text-amber-700 whitespace-nowrap">
              R${' '}
              {Number(
                item.lineTotal ?? Number(item.unitPrice || 0) * item.quantity
              ).toFixed(2)}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                className="!px-3 !py-1"
                disabled={itemBusy === item.id}
                onClick={() => changeQty(item, -1)}
                aria-label="Diminuir"
              >
                −
              </Button>
              <span className="w-8 text-center font-medium">{item.quantity}</span>
              <Button
                variant="secondary"
                className="!px-3 !py-1"
                disabled={itemBusy === item.id}
                onClick={() => changeQty(item, 1)}
                aria-label="Aumentar"
              >
                +
              </Button>
            </div>
            <button
              type="button"
              className="text-xs text-red-600 hover:underline disabled:opacity-50"
              disabled={itemBusy === item.id}
              onClick={() => removeItem(item)}
            >
              Remover
            </button>
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
            O pedido vai para a cozinha. Você pode pedir de novo quando quiser.
          </p>
        </>
      )}
    </div>
  );
}
