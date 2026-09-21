import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import {
  Shell,
  Card,
  Button,
  ErrorBox,
  Spinner,
} from '../../components/Layout';

const input = 'mt-1 w-full rounded-xl border border-stone-300 px-3 py-2';
const statuses = {
  pending: 'Pendente',
  active: 'Ativa',
  suspended: 'Suspensa',
};
const emptyStore = {
  name: '',
  slug: '',
  customDomain: '',
  status: 'pending',
  ownerName: '',
  ownerEmail: '',
  ownerPassword: '',
};

export default function PlatformPage() {
  const { user, loading, refresh } = useAuth();
  const [stores, setStores] = useState([]);
  const [leads, setLeads] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [offset, setOffset] = useState(0);
  const [leadOffset, setLeadOffset] = useState(0);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const load = useCallback(async () => {
    setFetching(true);
    setError(null);
    try {
      const [s, m, l] = await Promise.all([
        api(`/api/platform/stores?limit=20&offset=${offset}`),
        api('/api/platform/metrics'),
        api(`/api/platform/leads?limit=20&offset=${leadOffset}`),
      ]);
      setStores(s.stores);
      setMetrics(m.metrics);
      setLeads(l.leads);
    } catch (err) {
      setError(err);
      if (err.status === 401) await refresh();
    } finally {
      setFetching(false);
    }
  }, [offset, leadOffset, refresh]);
  useEffect(() => {
    if (user?.type === 'platform') load();
  }, [user, load]);

  if (loading) return <Spinner />;
  if (!user || user.type !== 'platform')
    return <Navigate to="/platform/login" replace />;

  function create() {
    setEditing(null);
    setForm({ ...emptyStore });
    setNotice('');
  }
  async function edit(id) {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const { store } = await api(`/api/platform/stores/${id}`);
      setEditing(id);
      setForm({
        name: store.name,
        slug: store.slug,
        customDomain: store.custom_domain || '',
        status: store.status,
      });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice('');
    const body = { ...form, customDomain: form.customDomain || null };
    if (!body.ownerPassword) delete body.ownerPassword;
    try {
      await api(
        editing ? `/api/platform/stores/${editing}` : '/api/platform/stores',
        {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        }
      );
      setForm(null);
      setNotice(
        editing
          ? 'Loja atualizada.'
          : 'Loja e vínculo OWNER criados. Compartilhe a senha inicial por um canal seguro.'
      );
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  async function suspend(store) {
    if (
      !window.confirm(
        `Suspender ${store.name}? A operação e os QR codes ficarão indisponíveis.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await api(`/api/platform/stores/${store.id}`, { method: 'DELETE' });
      setNotice('Loja suspensa. Histórico preservado.');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell title="Plataforma · Administração">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">Visão geral</h2>
            <p className="mt-1 text-sm text-stone-500">
              Gestão de lojas e contatos. Este acesso não abre os painéis das
              lojas.
            </p>
          </div>
          <Button onClick={create} disabled={busy}>
            Nova loja
          </Button>
        </div>
        <ErrorBox error={error} />
        {error && (
          <Button onClick={load} disabled={fetching}>
            Tentar novamente
          </Button>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            {notice}
          </p>
        )}
        {metrics && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ['stores', 'Lojas'],
              ['active', 'Ativas'],
              ['pending', 'Pendentes'],
              ['suspended', 'Suspensas'],
              ['leads', 'Contatos'],
            ].map(([key, label]) => (
              <Card key={key}>
                <p className="text-xs text-stone-500">{label}</p>
                <p className="mt-2 text-3xl font-semibold">{metrics[key]}</p>
              </Card>
            ))}
          </div>
        )}
        {form && (
          <Card>
            <h3 className="mb-4 text-lg font-semibold">
              {editing ? 'Editar loja' : 'Criar loja e primeiro OWNER'}
            </h3>
            <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
              {[
                ['name', 'Nome da loja', 'text', 120],
                ['slug', 'Slug (subdomínio)', 'text', 63],
                ['customDomain', 'Domínio próprio (opcional)', 'text', 253],
                ...(!editing
                  ? [
                      ['ownerName', 'Nome do OWNER', 'text', 120],
                      ['ownerEmail', 'E-mail do OWNER', 'email', 254],
                      [
                        'ownerPassword',
                        'Senha inicial (apenas para conta nova)',
                        'password',
                        200,
                      ],
                    ]
                  : []),
              ].map(([key, label, type, max]) => (
                <label key={key} className="block text-sm">
                  {label}
                  <input
                    className={input}
                    type={type}
                    value={form[key]}
                    maxLength={max}
                    minLength={key === 'ownerPassword' ? 12 : undefined}
                    autoComplete={
                      key === 'ownerPassword' ? 'new-password' : undefined
                    }
                    required={!['customDomain', 'ownerPassword'].includes(key)}
                    onChange={(e) =>
                      setForm({ ...form, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label className="block text-sm">
                Status
                <select
                  className={input}
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {Object.entries(statuses).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="sm:col-span-2 text-xs text-stone-500">
                Para OWNER já cadastrado, a senha existente é preservada.
                Domínios próprios exigem DNS e TLS configurados antes da
                ativação.
              </p>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={busy}>
                  {busy ? 'Salvando…' : 'Salvar'}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setForm(null)}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </Card>
        )}
        <section>
          <h3 className="mb-3 text-lg font-semibold">Lojas</h3>
          {fetching ? (
            <Spinner />
          ) : (
            <div className="space-y-3">
              {stores.length === 0 && <Card>Nenhuma loja nesta página.</Card>}
              {stores.map((store) => (
                <Card
                  key={store.id}
                  className="flex flex-wrap items-center justify-between gap-4"
                >
                  <div>
                    <p className="font-semibold">{store.name}</p>
                    <p className="text-sm text-stone-500">
                      {store.slug} · {statuses[store.status]}
                      {store.custom_domain ? ` · ${store.custom_domain}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => edit(store.id)}
                    >
                      Editar
                    </Button>
                    {store.status !== 'suspended' && (
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => suspend(store)}
                      >
                        Suspender
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              variant="secondary"
              disabled={fetching || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 20))}
            >
              Anterior
            </Button>
            <Button
              variant="secondary"
              disabled={fetching || stores.length < 20}
              onClick={() => setOffset(offset + 20)}
            >
              Próxima
            </Button>
          </div>
        </section>
        <section>
          <h3 className="mb-3 text-lg font-semibold">Contatos comerciais</h3>
          <div className="space-y-3">
            {!fetching && leads.length === 0 && (
              <Card>Nenhum contato nesta página.</Card>
            )}
            {leads.map((lead) => (
              <Card key={lead.id}>
                <h4 className="font-semibold">{lead.business_name}</h4>
                <p className="text-sm text-stone-600">
                  {lead.name} · {lead.email}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {lead.message}
                </p>
                <p className="mt-2 text-xs text-stone-400">
                  {new Date(lead.created_at).toLocaleString('pt-BR')}
                </p>
              </Card>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              variant="secondary"
              disabled={fetching || leadOffset === 0}
              onClick={() => setLeadOffset(Math.max(0, leadOffset - 20))}
            >
              Anterior
            </Button>
            <Button
              variant="secondary"
              disabled={fetching || leads.length < 20}
              onClick={() => setLeadOffset(leadOffset + 20)}
            >
              Próxima
            </Button>
          </div>
        </section>
      </div>
    </Shell>
  );
}
