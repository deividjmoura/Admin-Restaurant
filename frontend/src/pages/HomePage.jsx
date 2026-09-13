import { Link } from 'react-router-dom';
import { Card } from '../components/Layout';
import { getTenant } from '../api/client';

export default function HomePage() {
  const tenant = getTenant();
  return (
    <div className="mx-auto max-w-lg px-4 py-10 space-y-6">
      <div className="text-center space-y-2">
        <p className="text-xs uppercase tracking-widest text-amber-600 font-semibold">
          {tenant}
        </p>
        <h1 className="text-3xl font-bold text-stone-900">Admin Restaurant</h1>
        <p className="text-stone-600 text-sm">
          Escolha o painel. Cliente entra pelo QR da mesa.
        </p>
      </div>

      <div className="grid gap-3">
        {[
          { to: '/m/demo', label: 'Cliente (demo token)', hint: 'Use /m/:token do QR real' },
          { to: '/kitchen', label: 'Cozinha' },
          { to: '/bar', label: 'Bar' },
          { to: '/waiter', label: 'Garçom' },
          { to: '/cashier', label: 'Caixa' },
          { to: '/admin', label: 'Admin / Dono' },
          { to: '/login', label: 'Login staff' },
        ].map((item) => (
          <Link key={item.to} to={item.to}>
            <Card className="hover:border-amber-400 transition-colors flex justify-between items-center">
              <span className="font-medium">{item.label}</span>
              <span className="text-stone-400 text-sm">→</span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
