import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { setTenantSlug } from '../api/client';
import { Button, Card, ErrorBox } from '../components/Layout';

const inputClass =
  'mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400';

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('owner@demo.local');
  const [password, setPassword] = useState('troque-esta-senha');
  const [tenant, setTenant] = useState('demo');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setTenantSlug(tenant);
      await login(email, password, tenant);
      const dest = loc.state?.from || '/admin';
      nav(dest, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="text-center mb-6 space-y-1">
        <p className="text-[10px] uppercase tracking-widest text-amber-600 font-semibold">
          Staff
        </p>
        <h1 className="text-2xl font-bold text-stone-900">Entrar</h1>
        <p className="text-sm text-stone-500">Cozinha, garçom, caixa e admin</p>
      </div>

      <Card>
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-sm">
            <span className="text-stone-600 font-medium">Tenant (slug)</span>
            <input
              className={inputClass}
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              autoComplete="organization"
            />
          </label>
          <label className="block text-sm">
            <span className="text-stone-600 font-medium">E-mail</span>
            <input
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label className="block text-sm">
            <span className="text-stone-600 font-medium">Senha</span>
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <ErrorBox error={error} title="Falha no login" />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </Card>

      <p className="text-center text-xs text-stone-400 mt-6">
        <Link to="/" className="underline hover:text-stone-600">
          Voltar ao início
        </Link>
      </p>
    </div>
  );
}
