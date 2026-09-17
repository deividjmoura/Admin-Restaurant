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
  { to: '/admin/coupons', label: 'Cupons' },
];

export default function CouponsPage() {
  const { user, loading } = useAuth();
  const [coupons, setCoupons] = useState([]);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ code: '', discountType: 'percentage', discountValue: '10', minOrderAmount: '0', maxUses: '' });

  async function load() {
    const data = await api('/api/coupons');
    setCoupons(data.coupons || []);
  }

  useEffect(() => {
    if (!user) return;
    load().catch(setError);
  }, [user]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/admin/coupons' }} />;

  async function create(e) {
    e.preventDefault();
    setError(null);
    try {
      await api('/api/coupons', {
        method: 'POST',
        body: JSON.stringify({
          code: form.code,
          discountType: form.discountType,
          discountValue: Number(form.discountValue),
          minOrderAmount: Number(form.minOrderAmount) || 0,
          maxUses: form.maxUses ? Number(form.maxUses) : null,
        }),
      });
      setForm({ code: '', discountType: 'percentage', discountValue: '10', minOrderAmount: '0', maxUses: '' });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function toggleActive(c) {
    try {
      await api(`/api/coupons/${c.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !c.isActive }) });
      await load();
    } catch (err) { setError(err); }
  }

  return (
    <Shell title="Cupons" nav={nav}>
      <ErrorBox error={error} />
      <Card className="mb-4">
        <h2 className="font-semibold mb-3">Novo cupom</h2>
        <form onSubmit={create} className="grid gap-2 sm:grid-cols-5">
          <input className="rounded-xl border border-stone-300 px-3 py-2 text-sm" placeholder="Código (ex: PROMO10)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required />
          <select className="rounded-xl border border-stone-300 px-3 py-2 text-sm" value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })}>
            <option value="percentage">% Porcentagem</option>
            <option value="fixed">R$ Fixo</option>
          </select>
          <input className="rounded-xl border border-stone-300 px-3 py-2 text-sm" type="number" step="0.01" placeholder="Valor" value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} required />
          <input className="rounded-xl border border-stone-300 px-3 py-2 text-sm" type="number" step="0.01" placeholder="Mínimo" value={form.minOrderAmount} onChange={(e) => setForm({ ...form, minOrderAmount: e.target.value })} />
          <input className="rounded-xl border border-stone-300 px-3 py-2 text-sm" type="number" placeholder="Máx usos (opcional)" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} />
          <Button type="submit" className="sm:col-span-5">Criar cupom</Button>
        </form>
        <p className="text-xs text-stone-400 mt-2">Código 3-20 chars A-Z0-9_- • isolado por `store_id` • validado em `/api/coupons/validate` com `orderAmount`.</p>
      </Card>

      <div className="space-y-2">
        {coupons.length === 0 && <Card><p className="text-sm text-stone-400">Nenhum cupom.</p></Card>}
        {coupons.map((c) => (
          <Card key={c.id} className="flex justify-between gap-3 items-center">
            <div>
              <p className="font-mono font-bold">{c.code} {!c.isActive && <span className="text-xs text-red-600">inativo</span>}</p>
              <p className="text-sm text-stone-500">
                {c.discountType === 'percentage' ? `${c.discountValue}%` : `R$ ${Number(c.discountValue).toFixed(2)}`} • mínimo R$ {Number(c.minOrderAmount).toFixed(2)} • usos {c.usesCount}/{c.maxUses ?? '∞'}
              </p>
              {c.validFrom && <p className="text-xs text-stone-400">de {new Date(c.validFrom).toLocaleDateString()} até {c.validUntil ? new Date(c.validUntil).toLocaleDateString() : '∞'}</p>}
            </div>
            <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => toggleActive(c)}>{c.isActive ? 'Desativar' : 'Ativar'}</Button>
          </Card>
        ))}
      </div>
    </Shell>
  );
}
