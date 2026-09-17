import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, getTenant } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';

const nav = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/menu', label: 'Cardápio' },
  { to: '/admin/tables', label: 'Mesas' },
];

function qrUrl(token) {
  const base = window.location.origin;
  const tenant = getTenant();
  // QR points to client flow with tenant in query for multi-tenant
  const url = `${base}/m/${token}?tenant=${encodeURIComponent(tenant)}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
}

export default function TablesAdminPage() {
  const { user, loading } = useAuth();
  const [tables, setTables] = useState([]);
  const [error, setError] = useState(null);
  const [number, setNumber] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api('/api/admin/tables');
    setTables(data.tables || []);
  }

  useEffect(() => {
    if (!user) return;
    load().catch(setError);
  }, [user]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/admin/tables' }} />;

  async function createTable(e) {
    e.preventDefault();
    if (!number) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/tables', {
        method: 'POST',
        body: JSON.stringify({ number: Number(number), label: label || null }),
      });
      setNumber('');
      setLabel('');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(id) {
    if (!confirm('Regenerar QR? O adesivo antigo deixará de funcionar.')) return;
    setError(null);
    try {
      await api(`/api/admin/tables/${id}/regenerate-token`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function deactivate(id) {
    if (!confirm('Desativar mesa?')) return;
    try {
      await api(`/api/admin/tables/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Shell title="Mesas" nav={nav}>
      <ErrorBox error={error} />

      <Card className="mb-4">
        <h2 className="font-semibold mb-3">Nova mesa</h2>
        <form onSubmit={createTable} className="grid gap-2 sm:grid-cols-3">
          <input
            type="number"
            className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
            placeholder="Número (ex: 12)"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            required
          />
          <input
            className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
            placeholder="Rótulo opcional (ex: Varanda)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            Criar mesa
          </Button>
        </form>
        <p className="text-xs text-stone-400 mt-2">
          Mesas têm QR permanente (`public_token`) e sessão com TTL de 6h (configurável via `TABLE_SESSION_TTL_HOURS`). QR não expira, sessão sim.
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tables.length === 0 && (
          <Card>
            <p className="text-sm text-stone-500">Nenhuma mesa cadastrada.</p>
          </Card>
        )}
        {tables.map((t) => (
          <Card key={t.id} className="flex flex-col gap-3">
            <div className="flex justify-between items-start gap-2">
              <div>
                <p className="font-bold text-lg">Mesa {t.number}</p>
                {t.label && <p className="text-sm text-stone-600">{t.label}</p>}
                <p className="text-xs text-stone-400">
                  {t.isActive ? 'ativa' : 'inativa'} • {t.status} • #{String(t.id).slice(0, 6)}
                </p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full border ${t.isActive ? 'bg-green-50 border-green-200 text-green-700' : 'bg-stone-100 border-stone-200 text-stone-500'}`}>
                {t.isActive ? 'ativa' : 'inativa'}
              </span>
            </div>

            <div className="bg-white border border-stone-200 rounded-xl p-2 flex justify-center">
              <img
                src={qrUrl(t.publicToken)}
                alt={`QR Mesa ${t.number}`}
                className="w-40 h-40 object-contain"
                loading="lazy"
              />
            </div>

            <p className="text-xs text-stone-500 break-all">
              <span className="font-medium">Token:</span> {t.publicToken}
            </p>

            <a className="text-xs text-amber-700 underline" href={`/m/${t.publicToken}`} target="_blank" rel="noreferrer">
              Abrir fluxo cliente →
            </a>

            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1 !py-1 text-xs" onClick={() => regenerate(t.id)}>
                Regenerar QR
              </Button>
              <Button variant="secondary" className="flex-1 !py-1 text-xs" onClick={() => deactivate(t.id)}>
                Desativar
              </Button>
            </div>

            <p className="text-[11px] text-stone-400">
              URL: /m/{t.publicToken.slice(0, 8)}… • tenant: {getTenant()}
            </p>
          </Card>
        ))}
      </div>
    </Shell>
  );
}
