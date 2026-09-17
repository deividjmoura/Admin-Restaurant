import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';

const nav = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/menu', label: 'Cardápio' },
  { to: '/admin/tables', label: 'Mesas' },
  { to: '/admin/delivery', label: 'Delivery' },
];

export default function DeliveryZonesPage() {
  const { user, loading } = useAuth();
  const [zones, setZones] = useState([]);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: '', fee: '5', minOrderAmount: '0', etaMinutesMin: '30', etaMinutesMax: '60' });

  async function load() {
    const data = await api('/api/delivery/zones/admin');
    setZones(data.zones || []);
  }

  useEffect(() => {
    if (!user) return;
    load().catch(setError);
  }, [user]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/admin/delivery' }} />;

  async function createZone(e) {
    e.preventDefault();
    setError(null);
    try {
      await api('/api/delivery/zones', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          fee: Number(form.fee) || 0,
          minOrderAmount: Number(form.minOrderAmount) || 0,
          etaMinutesMin: Number(form.etaMinutesMin) || 30,
          etaMinutesMax: Number(form.etaMinutesMax) || 60,
          sortOrder: zones.length,
        }),
      });
      setForm({ name: '', fee: '5', minOrderAmount: '0', etaMinutesMin: '30', etaMinutesMax: '60' });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function toggleActive(z) {
    try {
      await api(`/api/delivery/zones/${z.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !z.isActive }),
      });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function updateFee(z, field, value) {
    try {
      await api(`/api/delivery/zones/${z.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: Number(value) }),
      });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Shell title="Zonas Delivery" nav={nav}>
      <ErrorBox error={error} />
      <Card className="mb-4">
        <h2 className="font-semibold mb-3">Nova zona</h2>
        <form onSubmit={createZone} className="grid gap-2 sm:grid-cols-6">
          <input className="rounded-xl border border-stone-300 px-3 py-2 text-sm sm:col-span-2" placeholder="Nome (ex: Centro)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className="rounded-xl border border-stone-300 px-3 py-2 text-sm" type="number" step="0.01" placeholder="Taxa" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
          <input className="rounded-xl border border-stone-300 px-3 py-2 text-sm" type="number" step="0.01" placeholder="Pedido mínimo" value={form.minOrderAmount} onChange={(e) => setForm({ ...form, minOrderAmount: e.target.value })} />
          <input className="rounded-xl border border-stone-300 px-3 py-2 text-sm" type="number" placeholder="ETA min" value={form.etaMinutesMin} onChange={(e) => setForm({ ...form, etaMinutesMin: e.target.value })} />
          <input className="rounded-xl border border-stone-300 px-3 py-2 text-sm" type="number" placeholder="ETA max" value={form.etaMinutesMax} onChange={(e) => setForm({ ...form, etaMinutesMax: e.target.value })} />
          <Button type="submit" className="sm:col-span-6">Criar zona</Button>
        </form>
        <p className="text-xs text-stone-400 mt-2">Todas as zonas são isoladas por `store_id`. Inativas não aparecem para o cliente (`/api/delivery/zones` filtra `is_active`).</p>
      </Card>

      <div className="space-y-2">
        {zones.length === 0 && <Card><p className="text-sm text-stone-400">Nenhuma zona cadastrada.</p></Card>}
        {zones.map((z) => (
          <Card key={z.id} className="flex justify-between gap-3 items-center">
            <div className="flex-1">
              <p className="font-medium">{z.name} {!z.isActive && <span className="text-xs text-red-600">inativa</span>}</p>
              <p className="text-sm text-stone-500">Taxa R$ {Number(z.fee).toFixed(2)} • mínimo R$ {Number(z.minOrderAmount).toFixed(2)} • ETA {z.etaMinutesMin}-{z.etaMinutesMax} min • ordem {z.sortOrder}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => toggleActive(z)}>{z.isActive ? 'Desativar' : 'Ativar'}</Button>
              <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => {
                const v = prompt('Nova taxa', String(z.fee));
                if (v !== null) updateFee(z, 'fee', v);
              }}>Taxa</Button>
            </div>
          </Card>
        ))}
      </div>
    </Shell>
  );
}
