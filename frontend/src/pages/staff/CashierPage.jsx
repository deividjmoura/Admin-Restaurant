import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';

function formatBRL(v) {
  return `R$ ${Number(v || 0).toFixed(2)}`;
}

export default function CashierPage() {
  const { user, loading } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [pix, setPix] = useState(null);

  const load = useCallback(async () => {
    const data = await api('/api/cashier/sessions');
    setSessions(data.sessions || []);
    // Also fetch PIX config for hint (optional)
    try {
      const cfg = await api('/api/payments/pix-config');
      setPix(cfg.pix || null);
    } catch {}
  }, []);

  const loadSession = useCallback(async (id) => {
    const data = await api(`/api/cashier/sessions/${id}`);
    setSelected(data);
  }, []);

  useEffect(() => {
    if (!user) return;
    load().catch(setError);
  }, [user, load]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/cashier' }} />;

  async function closeSession(id) {
    setError(null);
    try {
      await api(`/api/cashier/sessions/${id}/close`, { method: 'POST' });
      await load();
      setSelected(null);
    } catch (err) {
      setError(err);
    }
  }

  async function confirmPayment(paymentId) {
    setError(null);
    try {
      await api(`/api/payments/${paymentId}/confirm`, { method: 'POST' });
      await load();
      if (selected) await loadSession(selected.session?.id || selected.id);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Shell
      title="Caixa"
      nav={[
        { to: '/cashier', label: 'Caixa' },
        { to: '/kitchen', label: 'Cozinha' },
        { to: '/admin', label: 'Admin' },
      ]}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-stone-500">Sessões abertas • fechamento libera mesa</p>
        <Button variant="secondary" className="!py-1 !px-3 text-xs" onClick={() => load().catch(setError)}>
          Atualizar
        </Button>
      </div>

      <ErrorBox error={error} />

      {pix && (
        <Card className="bg-sky-50 border-sky-200 mb-3">
          <p className="text-xs font-semibold text-sky-800">PIX {pix.configured ? 'configurado' : 'não configurado'}</p>
          {pix.configured && (
            <p className="text-xs text-sky-700">
              {pix.name || '—'} • {pix.city || '—'} • chave {pix.keyHint || '***'}
            </p>
          )}
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          {sessions.length === 0 && (
            <Card>
              <p className="text-sm text-stone-500">Nenhuma sessão aberta.</p>
            </Card>
          )}
          {sessions.map((s) => {
            const table = s.tableNumber || s.table_number || s.table?.number || '—';
            const id = s.id;
            const isSelected = selected && (selected.session?.id === id || selected.id === id);
            return (
              <Card key={id} className={`flex justify-between items-center gap-3 ${isSelected ? 'ring-2 ring-amber-400' : ''}`}>
                <button className="text-left flex-1" onClick={() => loadSession(id)}>
                  <p className="font-medium">Mesa {table}</p>
                  <p className="text-xs text-stone-500">
                    Sessão #{String(id).slice(0, 8)} • {s.status} • {s.opened_at ? new Date(s.opened_at).toLocaleTimeString() : ''}
                  </p>
                  {s.cartVersion != null && <p className="text-[11px] text-stone-400">carrinho v{s.cartVersion}</p>}
                </button>
                <div className="flex gap-2 shrink-0">
                  <Button variant="secondary" className="!px-3 !py-1 text-xs" onClick={() => loadSession(id)}>
                    Detalhar
                  </Button>
                  {s.status === 'open' && (
                    <Button variant="secondary" onClick={() => closeSession(id)} className="text-xs">
                      Fechar
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        <div className="space-y-3">
          {!selected && (
            <Card>
              <p className="text-sm text-stone-500">Selecione uma sessão para ver consumo e pagamentos.</p>
            </Card>
          )}
          {selected && (
            <>
              <Card>
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="font-semibold">Sessão #{String(selected.session?.id || selected.id).slice(0, 8)}</p>
                    <p className="text-xs text-stone-500">
                      Mesa {selected.session?.tableId || selected.table_id || '—'} • {selected.session?.status || selected.status}
                    </p>
                  </div>
                  {(selected.session?.status === 'open' || selected.status === 'open') && (
                    <Button variant="danger" className="!py-1 text-xs" onClick={() => closeSession(selected.session?.id || selected.id)}>
                      Fechar sessão
                    </Button>
                  )}
                </div>

                <div className="mt-3 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Consumo</p>
                  {(selected.items || selected.orders || []).length === 0 && !selected.totals && (
                    <p className="text-xs text-stone-400">Nenhum item/pedido nesta sessão.</p>
                  )}
                  {(selected.items || []).map((it) => (
                    <div key={it.id} className="flex justify-between text-sm border border-stone-100 rounded-lg px-2 py-1">
                      <span>{it.quantity}× {it.productName || it.product_name}</span>
                      <span className="font-medium">{formatBRL(it.unitPrice * it.quantity)}</span>
                    </div>
                  ))}
                  {(selected.orders || []).map((o) => (
                    <div key={o.id} className="text-sm border border-stone-100 rounded-lg px-2 py-2">
                      <p className="font-medium">Pedido #{String(o.id).slice(0, 8)} • {o.status}</p>
                      <p className="text-xs text-stone-500">{o.items?.length || 0} itens</p>
                    </div>
                  ))}
                </div>

                {selected.totals && (
                  <div className="mt-3 flex justify-between items-center bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    <span className="font-medium">Total</span>
                    <span className="font-bold">{formatBRL(selected.totals.amount || selected.totals.total)}</span>
                  </div>
                )}

                {selected.payments && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Pagamentos</p>
                    {selected.payments.map((p) => (
                      <div key={p.id} className="flex justify-between items-center text-sm border rounded-lg px-2 py-1">
                        <span>
                          {p.method} • {p.status} • {formatBRL(p.amount)}
                        </span>
                        {p.status !== 'PAID' && p.status !== 'paid' && (
                          <Button className="!py-1 !px-2 text-xs" onClick={() => confirmPayment(p.id)}>
                            Confirmar
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Button variant="secondary" className="w-full" onClick={() => setSelected(null)}>
                Voltar à lista
              </Button>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
