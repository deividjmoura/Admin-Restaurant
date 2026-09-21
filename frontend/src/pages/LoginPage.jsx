import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { entryContext } from '../context/entry-context';
import { getTenant } from '../api/client';
import { Button, Card, ErrorBox } from '../components/Layout';

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  // Nada de credencial default no bundle: campos começam vazios.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const platform = entryContext.type === 'platform';
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await login(email, password);
      const roleHome = {
        KITCHEN: '/kitchen',
        STAFF: '/waiter',
        WAITER: '/waiter',
        CASHIER: '/cashier',
      };
      const dest = platform
        ? '/platform/stores'
        : loc.state?.from || roleHome[data.user.role] || '/admin';
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
        <h1 className="text-xl font-semibold mb-4">
          {platform ? 'Entrar na plataforma' : 'Entrar na loja'}
        </h1>
        <p className="text-sm text-stone-500 mb-4">
          {platform ? 'Acesso exclusivo à administração do SaaS.' : getTenant()}
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
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
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
