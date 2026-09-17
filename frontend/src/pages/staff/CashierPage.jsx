import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';
import { STAFF_NAV } from './staffNav';

function money(n) {
  return `R$ ${Number(n || 0).toFixed(2)}`;
}

export default function CashierPage() {
  const { user, loading } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [summary, setSummary] = useState(null);
  const [pixPayload, setPixPayload] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const data = await api('/api/cashier/sessions');
    setSessions(data.sessions || []);
  }, []);

  useEffect(() => {
    if (!user) return;
    load().catch(setError);
    const id = setInterval(() => load().catch(() => {}), 8000);
    return () => clearInterval(id);
  }, [user, load]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/cashier' }} />;

  async function openSession(s) {
    setSelected(s);
    setSummary(null);
    setPixPayload(null);
    setError(null);
    try {
      const data = await api(`/api/cashier/sessions/${s.id}`);
      setSummary(data);
    } catch (err) {
      setError(err);
    }
  }

  async function createPix() {
    if (!selected || !summary) return;
    setBusy('pix');
    setError(null);
    try {
      const amount =
        summary.totals?.amount ??
        summary.total ??
        summary.session?.total ??
        0;
      const res = await api('/api/payments', {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(amount) || 0.01,
          method: 'PIX',
          sessionId: selected.id,
        }),
        idempotencyKey: `cashier-pix-${selected.id}-${Date.now()}`,
      });
      setPixPayload(res.payment);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function confirmPayment() {
    if (!pixPayload?.id) return;
    setBusy('confirm');
    setError(null);
    try {
      const res = await api(`/api/payments/${pixPayload.id}/confirm`, {
        method: 'POST',
      });
      setPixPayload(res.payment);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function closeSession(id) {
    setBusy('close');
    setError(null);
    try {
      await api(`/api/cashier/sessions/${id}/close`, { method: 'POST' });
      setSelected(null);
      setSummary(null);
      setPixPayload(null);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const total =
    summary?.totals?.amount ??
    summary?.total ??
    summary?.session?.total ??
    null;

  return (
    <Shell title="Caixa" nav={STAFF_NAV}>
      <ErrorBox error={error} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-stone-600 uppercase tracking-wide">
            Sessões abertas
          </h2>
          {sessions.length === 0 && (
            <Card>
              <p className="text-sm text-stone-500">Nenhuma sessão aberta.</p>
            </Card>
          )}
          {sessions.map((s) => {
            const active = selected?.id === s.id;
            return (
              <Card
                key={s.id}
                className={
                  'cursor-pointer transition ' +
                  (active ? 'ring-2 ring-amber-400' : 'hover:border-amber-300')
                }
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => openSession(s)}
                >
                  <p className="font-medium text-stone-900">
                    Mesa{' '}
                    {s.tableNumber ||
                      s.table_number ||
                      s.table?.number ||
                      '—'}
                  </p>
                  <p className="text-xs text-stone-500 mt-0.5">
                    #{String(s.id).slice(0, 8)} · {s.status}
                    {s.total != null || s.totals?.amount != null
                      ? ` · ${money(s.total ?? s.totals?.amount)}`
                      : ''}
                  </p>
                </button>
              </Card>
            );
          })}
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-stone-600 uppercase tracking-wide">
            Detalhe / pagamento
          </h2>
          {!selected && (
            <Card>
              <p className="text-sm text-stone-500">
                Selecione uma sessão para ver o consumo e registrar PIX.
              </p>
            </Card>
          )}
          {selected && (
            <Card className="space-y-4">
              <div>
                <p className="text-xs text-stone-500">Sessão</p>
                <p className="font-mono text-sm">#{String(selected.id).slice(0, 8)}</p>
              </div>

              {summary?.items && summary.items.length > 0 && (
                <ul className="text-sm space-y-1 border-t border-stone-100 pt-3">
                  {summary.items.map((it, i) => (
                    <li key={it.id || i} className="flex justify-between gap-2">
                      <span>
                        {it.quantity}× {it.productName || it.product_name}
                      </span>
                      <span className="text-stone-600">
                        {money(it.lineTotal ?? it.unitPrice * it.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {total != null && (
                <div className="flex justify-between items-center border-t border-stone-100 pt-3">
                  <span className="text-stone-600">Total</span>
                  <span className="text-lg font-bold">{money(total)}</span>
                </div>
              )}

              {pixPayload && (
                <div className="rounded-xl bg-stone-50 border border-stone-200 p-3 text-sm space-y-2">
                  <p className="font-medium text-stone-800">PIX</p>
                  <p className="text-xs text-stone-500">
                    Status: {pixPayload.status} · {money(pixPayload.amount)}
                  </p>
                  {(pixPayload.pixCopyPaste ||
                    pixPayload.emv ||
                    pixPayload.qrCodePayload ||
                    pixPayload.metadata?.emv) && (
                    <textarea
                      readOnly
                      className="w-full text-xs font-mono rounded-lg border border-stone-200 p-2 h-20"
                      value={
                        pixPayload.pixCopyPaste ||
                        pixPayload.emv ||
                        pixPayload.qrCodePayload ||
                        pixPayload.metadata?.emv ||
                        ''
                      }
                      onFocus={(e) => e.target.select()}
                    />
                  )}
                  {pixPayload.status !== 'PAID' && (
                    <Button
                      className="w-full"
                      disabled={busy === 'confirm'}
                      onClick={confirmPayment}
                    >
                      {busy === 'confirm' ? 'Confirmando…' : 'Confirmar pagamento'}
                    </Button>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  className="flex-1"
                  variant="secondary"
                  disabled={busy === 'pix'}
                  onClick={createPix}
                >
                  {busy === 'pix' ? 'Gerando…' : 'Gerar PIX'}
                </Button>
                <Button
                  className="flex-1"
                  disabled={busy === 'close' || selected.status !== 'open'}
                  onClick={() => closeSession(selected.id)}
                >
                  {busy === 'close' ? 'Fechando…' : 'Fechar mesa'}
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}
