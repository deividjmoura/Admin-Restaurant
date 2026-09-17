import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';
import { ADMIN_NAV } from './adminNav';

export default function TablesAdminPage() {
  const { user, loading } = useAuth();
  const [tables, setTables] = useState([]);
  const [error, setError] = useState(null);
  const [number, setNumber] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(null);
  const [copied, setCopied] = useState(null);

  const load = useCallback(async () => {
    const data = await api('/api/admin/tables');
    setTables(data.tables || []);
  }, []);

  useEffect(() => {
    if (!user) return;
    load().catch(setError);
  }, [user, load]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/admin/tables' }} />;

  async function createTable(e) {
    e.preventDefault();
    setBusy('create');
    setError(null);
    try {
      await api('/api/admin/tables', {
        method: 'POST',
        body: JSON.stringify({
          number: Number(number),
          label: label.trim() || null,
        }),
      });
      setNumber('');
      setLabel('');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function regenerateToken(id) {
    if (!confirm('Regenerar token? O QR antigo deixará de funcionar.')) return;
    setBusy(id);
    setError(null);
    try {
      await api(`/api/admin/tables/${id}/regenerate-token`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function deactivate(id) {
    if (!confirm('Desativar esta mesa?')) return;
    setBusy(id);
    setError(null);
    try {
      await api(`/api/admin/tables/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  function customerUrl(token) {
    return `${window.location.origin}/m/${token}`;
  }

  async function copyLink(token) {
    try {
      await navigator.clipboard.writeText(customerUrl(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  }

  const active = tables.filter((t) => t.isActive !== false);

  return (
    <Shell title="Mesas" nav={ADMIN_NAV}>
      <ErrorBox error={error} />

      <Card className="mb-4">
        <h2 className="font-semibold mb-3">Nova mesa</h2>
        <form onSubmit={createTable} className="flex flex-wrap gap-2">
          <input
            type="number"
            className="rounded-xl border border-stone-300 px-3 py-2 text-sm w-28"
            placeholder="Nº"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            required
            min={1}
          />
          <input
            className="rounded-xl border border-stone-300 px-3 py-2 text-sm flex-1 min-w-[120px]"
            placeholder="Rótulo (opcional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button type="submit" disabled={busy === 'create'}>
            {busy === 'create' ? 'Criando…' : 'Criar mesa'}
          </Button>
        </form>
      </Card>

      <div className="space-y-2">
        {active.length === 0 && (
          <Card>
            <p className="text-sm text-stone-500">Nenhuma mesa ativa.</p>
          </Card>
        )}
        {active.map((t) => (
          <Card key={t.id}>
            <div className="flex flex-wrap justify-between gap-3 items-start">
              <div className="min-w-0">
                <p className="font-medium text-stone-900">
                  Mesa {t.number}
                  {t.label ? ` · ${t.label}` : ''}
                </p>
                <p className="text-xs text-stone-500 mt-0.5">
                  Status: {t.status}
                  {t.isActive === false && ' · inativa'}
                </p>
                <p className="text-xs text-stone-400 font-mono break-all mt-1">
                  Token: {t.publicToken}
                </p>
                <div className="flex flex-wrap gap-2 mt-2 text-xs">
                  <a
                    className="text-amber-700 underline"
                    href={`/m/${t.publicToken}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir cliente
                  </a>
                  <button
                    type="button"
                    className="text-amber-700 underline"
                    onClick={() => copyLink(t.publicToken)}
                  >
                    {copied === t.publicToken ? 'Copiado!' : 'Copiar link QR'}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Button
                  variant="secondary"
                  className="!py-1 !px-2 text-xs"
                  disabled={busy === t.id}
                  onClick={() => regenerateToken(t.id)}
                >
                  Regenerar QR
                </Button>
                <Button
                  variant="secondary"
                  className="!py-1 !px-2 text-xs"
                  disabled={busy === t.id}
                  onClick={() => deactivate(t.id)}
                >
                  Desativar
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </Shell>
  );
}
