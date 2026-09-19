import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';

const STAFF_NAV = [
  { to: '/kitchen', label: 'Cozinha' },
  { to: '/bar', label: 'Bar' },
  { to: '/waiter', label: 'Garçom' },
  { to: '/cashier', label: 'Caixa' },
];

function formatMoney(n) {
  return `R$ ${Number(n || 0).toFixed(2)}`;
}

export default function CashierPage() {
  const { user, loading } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const data = await api('/api/cashier/sessions');
    setSessions(data.sessions || []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!user) return;
    load().catch((err) => {
      setError(err);
      setLoaded(true);
    });
    const id = setInterval(() => load().catch(() => {}), 8000);
    return () => clearInterval(id);
  }, [user, load]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/cashier' }} />;

  async function openDetail(sessionId) {
    setError(null);
    try {
      const data = await api(`/api/cashier/sessions/${sessionId}`);
      setDetail(data);
    } catch (err) {
      setError(err);
    }
  }

  async function closeSession(id) {
    if (!window.confirm('Fechar sessão e liberar a mesa?')) return;
    setBusyId(id);
    setError(null);
    try {
      await api(`/api/cashier/sessions/${id}/close`, { method: 'POST' });
      if (detail?.session?.id === id) setDetail(null);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Shell title="Caixa" nav={STAFF_NAV}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-stone-500">
            {loaded
              ? `${sessions.length} sessão${sessions.length === 1 ? '' : 'ões'} aberta${sessions.length === 1 ? '' : 's'}`
              : 'Carregando…'}
          </p>
          <Button
            variant="secondary"
            className="!py-1 !px-3 text-xs"
            onClick={() => load().catch(setError)}
          >
            Atualizar
          </Button>
        </div>

        <ErrorBox error={error} />

        {!loaded && <Spinner />}

        {loaded && sessions.length === 0 && (
          <Card className="text-center py-10">
            <p className="text-3xl mb-2" aria-hidden>
              ✓
            </p>
            <p className="font-medium text-stone-800">Nenhuma mesa aberta</p>
            <p className="text-sm text-stone-500 mt-1">
              Sessões com consumo ativo aparecem aqui para fechamento.
            </p>
          </Card>
        )}

        <div className="space-y-3">
          {sessions.map((s) => {
            const tableLabel =
              s.tableNumber ?? s.table_number ?? s.table?.number ?? '—';
            const totals = s.totals || {};
            return (
              <Card key={s.id} className="space-y-3">
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <p className="font-semibold text-stone-900">Mesa {tableLabel}</p>
                    <p className="text-xs text-stone-500 mt-0.5">
                      Sessão #{String(s.id).slice(0, 8).toUpperCase()}
                      {s.openedAt || s.opened_at
                        ? ` · aberta ${new Date(s.openedAt || s.opened_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                        : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-stone-900">
                      {formatMoney(totals.amount)}
                    </p>
                    <p className="text-xs text-stone-500">
                      {totals.items ?? 0} itens
                      {totals.deliveredAmount != null
                        ? ` · entregue ${formatMoney(totals.deliveredAmount)}`
                        : ''}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    className="!py-1.5 text-xs"
                    onClick={() => openDetail(s.id)}
                  >
                    Detalhe
                  </Button>
                  <Button
                    variant="secondary"
                    className="!py-1.5 text-xs"
                    disabled={busyId === s.id}
                    onClick={() => closeSession(s.id)}
                  >
                    {busyId === s.id ? 'Fechando…' : 'Fechar mesa'}
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
                  {detail.session?.tableNumber ?? detail.session?.table_number ?? '—'}
                </p>
                <p className="text-xs text-stone-500">
                  #{String(detail.session?.id || '').slice(0, 8).toUpperCase()}
                </p>
              </div>
              <Button variant="secondary" className="!py-1 !px-2 text-xs" onClick={() => setDetail(null)}>
                Fechar
              </Button>
            </div>

            {(detail.orders || []).length === 0 && (
              <p className="text-sm text-stone-500">Sem pedidos nesta sessão.</p>
            )}

            {(detail.orders || []).map((o) => (
              <div key={o.id} className="rounded-xl bg-white border border-stone-200 p-3">
                <p className="text-xs text-stone-500 mb-1">
                  Pedido #{String(o.id).slice(0, 8).toUpperCase()} · {o.status}
                </p>
                <ul className="space-y-1">
                  {(o.items || []).map((it) => (
                    <li key={it.id} className="flex justify-between text-sm gap-2">
                      <span className="truncate">
                        {it.quantity}× {it.productName || it.product_name}
                        <span className="text-xs text-stone-400 ml-1">{it.status}</span>
                      </span>
                      <span className="shrink-0 text-stone-700">
                        {formatMoney(it.lineTotal ?? Number(it.unitPrice) * it.quantity)}
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

            {detail.session?.id && (
              <Button
                className="w-full"
                disabled={busyId === detail.session.id}
                onClick={() => closeSession(detail.session.id)}
              >
                {busyId === detail.session.id ? 'Fechando…' : 'Fechar mesa'}
              </Button>
            )}
          </Card>
        )}
      </div>
    </Shell>
  );
}
