import { Link } from 'react-router-dom';
import { Card } from '../components/Layout';
import { getTenant } from '../api/client';

const LINKS = [
  { to: '/login', label: 'Login staff', hint: 'Cozinha, garçom, caixa, admin' },
  { to: '/kitchen', label: 'Cozinha' },
  { to: '/bar', label: 'Bar' },
  { to: '/waiter', label: 'Garçom' },
  { to: '/cashier', label: 'Caixa' },
  { to: '/admin', label: 'Admin / Dono' },
  { to: '/delivery', label: 'Delivery (cliente)' },
  { to: '/m/demo', label: 'Cliente mesa (demo)', hint: 'Use /m/:token do QR real' },
];

export default function HomePage() {
  const tenant = getTenant();
  return (
    <div className="mx-auto max-w-lg px-4 py-10 space-y-8">
      <div className="text-center space-y-2">
        <p className="text-[10px] uppercase tracking-widest text-amber-600 font-semibold">
          {tenant}
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-stone-900">
          Admin Restaurant
        </h1>
        <p className="text-stone-600 text-sm leading-relaxed">
          Mesas · QR · pedidos. Cliente entra pelo QR; staff pelo login.
        </p>
      </div>

      <div className="grid gap-2.5">
        {LINKS.map((item) => (
          <Link key={item.to} to={item.to} className="block group">
            <Card className="hover:border-amber-400 transition-colors flex justify-between items-center gap-3">
              <div className="min-w-0">
                <span className="font-medium text-stone-900 group-hover:text-amber-800">
                  {item.label}
                </span>
                {item.hint && (
                  <p className="text-xs text-stone-400 mt-0.5 truncate">{item.hint}</p>
                )}
              </div>
              <span className="text-stone-300 text-sm shrink-0 group-hover:text-amber-500">
                →
              </span>
            </Card>
          </Link>
        ))}
      </div>

      <p className="text-center text-xs text-stone-400">
        Demo: veja <span className="text-stone-500">docs/DEMO.md</span>
      </p>
    </div>
  );
}
