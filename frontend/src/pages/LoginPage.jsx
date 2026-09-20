import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { setTenantSlug, getTenant } from '../api/client';
import { Button, Card, ErrorBox } from '../components/Layout';

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  // Nada de credencial default no bundle: campos começam vazios.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenant, setTenant] = useState(getTenant() || '');
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
      <Card>
        <h1 className="text-xl font-semibold mb-4">Login staff</h1>
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-sm">
            <span className="text-stone-600">Tenant (slug)</span>
            <input
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-stone-600">E-mail</span>
            <input
              type="email"
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-stone-600">Senha</span>
            <input
              type="password"
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <ErrorBox error={error} />
          <Button className="w-full" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
