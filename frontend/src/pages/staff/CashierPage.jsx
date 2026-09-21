import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, newIdempotencyKey } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { usePolling } from '../../hooks/usePolling';
import {
  Shell,
  Card,
  Button,
  Spinner,
  ConnectionStatus,
  EmptyState,
  Banner,
} from '../../components/Layout';

const STAFF_NAV = [
  { to: '/kitchen', label: 'Cozinha' },
  { to: '/bar', label: 'Bar' },
  { to: '/waiter', label: 'Garçom' },
  { to: '/cashier', label: 'Caixa' },
];

function formatMoney(n) {
  return `R$ ${Number(n || 0).toFixed(2)}`;
}

function expectedFrom(session) {
  const t = session?.totals;
  if (t?.expected != null) return Number(t.expected);
  if (session?.expectedAmount != null) return Number(session.expectedAmount);
  if (session?.openingAmount != null) return Number(session.openingAmount);
  return 0;
}

/** OWNER / MANAGER / super podem fechar gaveta; STAFF não. */
function canCloseDrawer(user) {
  if (!user) return false;
  if (user.isSuperAdmin || user.isPlatformOwner) return true;
  const role = (user.storeRole || user.role || '').toUpperCase();
  return role === 'OWNER' || role === 'MANAGER';
}

export default function CashierPage() {
  const { user, loading } = useAuth();
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);

  // --- Gaveta (cash físico) ---
  const [drawer, setDrawer] = useState(null);
  const [drawerLoaded, setDrawerLoaded] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('0');
  const [movementType, setMovementType] = useState('SUPPLY');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [countedAmount, setCountedAmount] = useState('');
  const [closeResult, setCloseResult] = useState(null);
  const [showMovement, setShowMovement] = useState(false);
  const [showClose, setShowClose] = useState(false);

  // --- Mesas abertas (consumo) ---
  const {
    data: tablesData,
    error: tablesError,
    loaded: tablesLoaded,
    offline,
    rateLimited,
    reload: reloadTables,
  } = usePolling('/api/cashier/sessions', {
    intervalMs: 8000,
    enabled: Boolean(user),
  });
  const tableSessions = tablesData?.sessions || [];
  const [detail, setDetail] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('CASH');
  const [tendered, setTendered] = useState('');
  const [payBusy, setPayBusy] = useState(false);

  const loadDrawer = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api('/api/cash/sessions/active');
      setDrawer(data.session || null);
      setActionError(null);
    } catch (err) {
      // 403/404 de permissão: não quebra a tela de mesas
      if (err?.status === 403 || err?.status === 404) {
        setDrawer(null);
      } else {
        setActionError(err);
      }
    } finally {
      setDrawerLoaded(true);
    }
  }, [user]);

  useEffect(() => {
    loadDrawer();
    const id = setInterval(loadDrawer, 12_000);
    return () => clearInterval(id);
  }, [loadDrawer]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/cashier' }} />;

  const shownError = actionError || tablesError;
  const allowClose = canCloseDrawer(user);

  async function openDrawer() {
    setBusy(true);
    setActionError(null);
    setCloseResult(null);
    try {
      const result = await api('/api/cash/sessions', {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify({
          openingAmount: Number(openingAmount) || 0,
        }),
      });
      setDrawer(result.session);
    } catch (err) {
      // 409 já tem sessão aberta → usa a do corpo se vier
      if (err?.status === 409 && err?.data?.session) {
        setDrawer(err.data.session);
      } else if (err?.status === 409 && err?.data?.error?.session) {
        setDrawer(err.data.error.session);
      } else {
        setActionError(err);
      }
      await loadDrawer();
    } finally {
      setBusy(false);
    }
  }

  async function recordMovement(e) {
    e.preventDefault();
    if (!drawer?.id) return;
    setBusy(true);
    setActionError(null);
    try {
      const body = {
        type: movementType,
        amount: Number(movementAmount),
        reason: movementReason.trim(),
      };
      if (movementType === 'ADJUSTMENT') body.direction = 'IN';
      await api(`/api/cash/sessions/${drawer.id}/movements`, {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify(body),
      });
      setMovementAmount('');
      setMovementReason('');
      setShowMovement(false);
      await loadDrawer();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function closeDrawer(e) {
    e.preventDefault();
    if (!drawer?.id) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await api(`/api/cash/sessions/${drawer.id}/close`, {
        method: 'POST',
        body: JSON.stringify({
          countedAmount: Number(countedAmount),
        }),
      });
      setCloseResult(result.session || result);
      setDrawer(null);
      setShowClose(false);
      setCountedAmount('');
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function openTableDetail(sessionId) {
    setActionError(null);
    try {
      const data = await api(`/api/cashier/sessions/${sessionId}`);
      setDetail(data);
      const due = Number(data.totals?.amount || 0);
      setPayAmount(due > 0 ? String(due) : '');
      setTendered('');
      setPayMethod('CASH');
    } catch (err) {
      setActionError(err);
    }
  }

  async function closeTableSession(id) {
    if (!window.confirm('Fechar sessão e liberar a mesa?')) return;
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/cashier/sessions/${id}/close`, { method: 'POST' });
      if (detail?.session?.id === id) setDetail(null);
      await reloadTables();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function payTable(e) {
    e.preventDefault();
    if (!drawer?.id || !detail?.session?.id) {
      setActionError(
        new Error('Abra a gaveta antes de registrar pagamento em caixa.')
      );
      return;
    }
    const amount = Number(payAmount);
    if (!(amount > 0)) return;
    setPayBusy(true);
    setActionError(null);
    try {
      const item = {
        method: payMethod,
        amount,
      };
      if (payMethod === 'CASH' && tendered !== '') {
        item.tenderedAmount = Number(tendered);
      }
      await api(`/api/cash/sessions/${drawer.id}/payments`, {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify({
          sessionId: detail.session.id,
          items: [item],
        }),
      });
      await openTableDetail(detail.session.id);
      await loadDrawer();
      await reloadTables();
    } catch (err) {
      setActionError(err);
    } finally {
      setPayBusy(false);
    }
  }

  return (
    <Shell title="Caixa" nav={STAFF_NAV}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-stone-500">
            Gaveta + mesas com consumo
          </p>
          <Button
            variant="secondary"
            className="!py-1 !px-3 text-xs"
            onClick={() => {
              loadDrawer();
              reloadTables();
            }}
          >
            Atualizar
          </Button>
        </div>

        <ConnectionStatus
          offline={offline}
          rateLimited={rateLimited}
          error={shownError}
        />

        {/* —— Gaveta —— */}
        {!drawerLoaded && <Spinner />}

        {drawerLoaded && !drawer && (
          <Card className="space-y-3">
            <h2 className="font-semibold text-stone-900">Abrir gaveta</h2>
            <p className="text-sm text-stone-500">
              Uma gaveta aberta por operador. Fundo de troco opcional.
            </p>
            {closeResult && (
              <Banner tone="info">
                Último fechamento · esperado {formatMoney(closeResult.expectedAmount)}
                {' · '}contado {formatMoney(closeResult.countedAmount)}
                {' · '}diferença {formatMoney(closeResult.differenceAmount)}
              </Banner>
            )}
            <div className="flex flex-wrap gap-2 items-end">
              <label className="text-sm">
                <span className="text-stone-500 block mb-1">Fundo (R$)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="rounded-xl border border-stone-300 px-3 py-2 text-sm w-32"
                  value={openingAmount}
                  onChange={(e) => setOpeningAmount(e.target.value)}
                />
              </label>
              <Button disabled={busy} onClick={openDrawer}>
                {busy ? 'Abrindo…' : 'Abrir caixa'}
              </Button>
            </div>
          </Card>
        )}

        {drawer && (
          <Card className="space-y-3 border-amber-200 bg-amber-50/30">
            <div className="flex justify-between items-start gap-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-amber-800">
                  Gaveta aberta
                </p>
                <p className="text-2xl font-bold text-stone-900">
                  {formatMoney(expectedFrom(drawer))}
                </p>
                <p className="text-xs text-stone-500 mt-1">
                  #{String(drawer.id).slice(0, 8).toUpperCase()}
                  {drawer.openedAt || drawer.opened_at
                    ? ` · desde ${new Date(
                        drawer.openedAt || drawer.opened_at
                      ).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  className="!py-1.5 text-xs"
                  onClick={() => setShowMovement((v) => !v)}
                >
                  Movimento
                </Button>
                {allowClose && (
                  <Button
                    variant="secondary"
                    className="!py-1.5 text-xs"
                    onClick={() => setShowClose((v) => !v)}
                  >
                    Fechar gaveta
                  </Button>
                )}
              </div>
            </div>

            {!allowClose && (
              <p className="text-xs text-stone-500">
                Fechamento da gaveta é restrito a gerente/dono.
              </p>
            )}

            {showMovement && (
              <form
                onSubmit={recordMovement}
                className="rounded-xl bg-white border border-stone-200 p-3 space-y-2"
              >
                <p className="text-sm font-medium">Sangria / suprimento</p>
                <div className="flex flex-wrap gap-2">
                  <select
                    className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
                    value={movementType}
                    onChange={(e) => setMovementType(e.target.value)}
                  >
                    <option value="SUPPLY">Suprimento (entrada)</option>
                    <option value="WITHDRAWAL">Sangria (saída)</option>
                  </select>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    placeholder="Valor"
                    className="rounded-xl border border-stone-300 px-3 py-2 text-sm w-28"
                    value={movementAmount}
                    onChange={(e) => setMovementAmount(e.target.value)}
                  />
                  <input
                    required
                    minLength={3}
                    placeholder="Motivo (mín. 3)"
                    className="rounded-xl border border-stone-300 px-3 py-2 text-sm flex-1 min-w-[10rem]"
                    value={movementReason}
                    onChange={(e) => setMovementReason(e.target.value)}
                  />
                  <Button type="submit" disabled={busy}>
                    Registrar
                  </Button>
                </div>
              </form>
            )}

            {showClose && allowClose && (
              <form
                onSubmit={closeDrawer}
                className="rounded-xl bg-white border border-stone-200 p-3 space-y-2"
              >
                <p className="text-sm font-medium">Fechar gaveta</p>
                <p className="text-xs text-stone-500">
                  Esperado: {formatMoney(expectedFrom(drawer))}. Informe a
                  contagem física.
                </p>
                <div className="flex flex-wrap gap-2 items-end">
                  <label className="text-sm">
                    <span className="text-stone-500 block mb-1">Contado (R$)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      className="rounded-xl border border-stone-300 px-3 py-2 text-sm w-32"
                      value={countedAmount}
                      onChange={(e) => setCountedAmount(e.target.value)}
                    />
                  </label>
                  <Button type="submit" disabled={busy}>
                    {busy ? 'Fechando…' : 'Confirmar fechamento'}
                  </Button>
                </div>
              </form>
            )}
          </Card>
        )}

        {/* —— Mesas —— */}
        <h2 className="font-semibold text-stone-800 pt-2">Mesas abertas</h2>

        {!tablesLoaded && <Spinner />}

        {tablesLoaded && tableSessions.length === 0 && (
          <EmptyState
            title="Nenhuma mesa aberta"
            description="Sessões com consumo ativo aparecem aqui para cobrança e fechamento."
          />
        )}

        <div className="space-y-3">
          {tableSessions.map((s) => {
            const tableLabel =
              s.tableNumber ?? s.table_number ?? s.table?.number ?? '—';
            const totals = s.totals || {};
            return (
              <Card key={s.id} className="space-y-3">
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <p className="font-semibold text-stone-900">
                      Mesa {tableLabel}
                    </p>
                    <p className="text-xs text-stone-500 mt-0.5">
                      Sessão #{String(s.id).slice(0, 8).toUpperCase()}
                      {s.openedAt || s.opened_at
                        ? ` · aberta ${
                            new Date(
                              s.openedAt || s.opened_at
                            ).toLocaleTimeString('pt-BR', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          }`
                        : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-stone-900">
                      {formatMoney(totals.amount)}
                    </p>
                    <p className="text-xs text-stone-500">
                      {totals.items ?? 0} itens
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    className="!py-1.5 text-xs"
                    onClick={() => openTableDetail(s.id)}
                  >
                    Detalhe / cobrar
                  </Button>
                  <Button
                    variant="secondary"
                    className="!py-1.5 text-xs"
                    disabled={busy}
                    onClick={() => closeTableSession(s.id)}
                  >
                    Fechar mesa
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>

        {detail && (
          <Card className="space-y-3 border-amber-200 bg-amber-50/40">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold text-stone-900">
                  Detalhe · Mesa{' '}
                  {detail.session?.tableNumber ??
                    detail.session?.table_number ??
                    '—'}
                </p>
                <p className="text-xs text-stone-500">
                  #{String(detail.session?.id || '').slice(0, 8).toUpperCase()}
                </p>
              </div>
              <Button
                variant="secondary"
                className="!py-1 !px-2 text-xs"
                onClick={() => setDetail(null)}
              >
                Fechar
              </Button>
            </div>

            {(detail.orders || []).length === 0 && (
              <p className="text-sm text-stone-500">Sem pedidos nesta sessão.</p>
            )}

            {(detail.orders || []).map((o) => (
              <div
                key={o.id}
                className="rounded-xl bg-white border border-stone-200 p-3"
              >
                <p className="text-xs text-stone-500 mb-1">
                  Pedido #{String(o.id).slice(0, 8).toUpperCase()} · {o.status}
                </p>
                <ul className="space-y-1">
                  {(o.items || []).map((it) => (
                    <li
                      key={it.id}
                      className="flex justify-between text-sm gap-2"
                    >
                      <span className="truncate">
                        {it.quantity}× {it.productName || it.product_name}
                        <span className="text-xs text-stone-400 ml-1">
                          {it.status}
                        </span>
                      </span>
                      <span className="shrink-0 text-stone-700">
                        {formatMoney(
                          it.lineTotal ??
                            Number(it.unitPrice) * it.quantity
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {detail.totals && (
              <div className="flex justify-between items-center pt-1 border-t border-amber-200">
                <span className="text-sm text-stone-600">Total da sessão</span>
                <span className="text-lg font-bold text-stone-900">
                  {formatMoney(detail.totals.amount)}
                </span>
              </div>
            )}

            {/* Pagamento via gaveta */}
            {drawer?.id ? (
              <form
                onSubmit={payTable}
                className="rounded-xl bg-white border border-stone-200 p-3 space-y-2"
              >
                <p className="text-sm font-medium">Registrar pagamento</p>
                <div className="flex flex-wrap gap-2">
                  <select
                    className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                  >
                    <option value="CASH">Dinheiro</option>
                    <option value="PIX">PIX</option>
                    <option value="CARD">Cartão</option>
                    <option value="OTHER">Outro</option>
                  </select>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    placeholder="Valor"
                    className="rounded-xl border border-stone-300 px-3 py-2 text-sm w-28"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                  />
                  {payMethod === 'CASH' && (
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Recebido"
                      className="rounded-xl border border-stone-300 px-3 py-2 text-sm w-28"
                      value={tendered}
                      onChange={(e) => setTendered(e.target.value)}
                    />
                  )}
                  <Button type="submit" disabled={payBusy}>
                    {payBusy ? '…' : 'Cobrar'}
                  </Button>
                </div>
                {payMethod === 'CASH' &&
                  tendered !== '' &&
                  Number(tendered) >= Number(payAmount) && (
                    <p className="text-xs text-stone-500">
                      Troco estimado (servidor confirma):{' '}
                      {formatMoney(Number(tendered) - Number(payAmount))}
                    </p>
                  )}
              </form>
            ) : (
              <Banner tone="warning">
                Abra a gaveta para registrar pagamento em dinheiro na sessão de
                caixa.
              </Banner>
            )}

            {detail.session?.id && (
              <Button
                className="w-full"
                disabled={busy}
                onClick={() => closeTableSession(detail.session.id)}
              >
                Fechar mesa
              </Button>
            )}
          </Card>
        )}
      </div>
    </Shell>
  );
}
