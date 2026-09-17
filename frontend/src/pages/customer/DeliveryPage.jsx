import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getTenant } from '../../api/client';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';

export default function DeliveryPage() {
  const navigate = useNavigate();
  const [menu, setMenu] = useState(null);
  const [zones, setZones] = useState([]);
  const [cart, setCart] = useState([]); // {productId, quantity, notes, productName, unitPrice, station}
  const [error, setError] = useState(null);
  const [quote, setQuote] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [zoneId, setZoneId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [address, setAddress] = useState({ street: '', number: '', complement: '', neighborhood: '', city: '', state: '', postalCode: '' });
  const [notes, setNotes] = useState('');

  useEffect(() => {
    api('/api/menu').then(setMenu).catch(setError);
    api('/api/delivery/zones').then((d) => {
      setZones(d.zones || []);
      if (d.zones?.[0]) setZoneId(d.zones[0].id);
    }).catch(setError);
  }, []);

  function addToCart(product) {
    setCart((c) => {
      const found = c.find((it) => it.productId === product.id);
      if (found) return c.map((it) => it.productId === product.id ? { ...it, quantity: it.quantity + 1 } : it);
      return [...c, { productId: product.id, productName: product.name, unitPrice: Number(product.price), quantity: 1, station: product.station, notes: '' }];
    });
  }

  function removeFromCart(productId) {
    setCart((c) => c.filter((it) => it.productId !== productId));
  }

  const subtotal = cart.reduce((s, it) => s + it.unitPrice * it.quantity, 0);

  // Quote when zone changes or cart changes
  useEffect(() => {
    if (!zoneId || subtotal === 0) { setQuote(null); return; }
    api('/api/delivery/quote', { method: 'POST', body: JSON.stringify({ zoneId, subtotal }) })
      .then(setQuote)
      .catch(() => setQuote(null));
  }, [zoneId, subtotal]);

  async function submit(e) {
    e.preventDefault();
    if (cart.length === 0) { setError(new Error('Carrinho vazio')); return; }
    if (!zoneId) { setError(new Error('Selecione a zona')); return; }
    setSubmitting(true);
    setError(null);
    try {
      const idempotencyKey = (crypto.randomUUID && crypto.randomUUID()) || `dk_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const payload = {
        zoneId,
        customerName,
        customerPhone: customerPhone || null,
        address: {
          street: address.street,
          number: address.number || null,
          complement: address.complement || null,
          neighborhood: address.neighborhood || null,
          city: address.city,
          state: address.state || null,
          postalCode: address.postalCode || null,
        },
        notes: notes || null,
        idempotencyKey,
        items: cart.map((it) => ({ productId: it.productId, quantity: it.quantity, notes: it.notes || null })),
      };
      const res = await api('/api/delivery/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload),
      });
      const orderId = res.order?.id || res.orderId;
      if (orderId) navigate(`/delivery/track/${orderId}`, { state: { order: res.order, delivery: res.delivery } });
      else setError(new Error('Resposta sem orderId'));
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (!menu) return <Shell title="Delivery"><Spinner /></Shell>;

  const categories = menu.categories || [];

  return (
    <Shell title="Delivery" nav={[{ to: '/delivery', label: 'Delivery' }, { to: '/', label: 'Início' }]}>
      <p className="text-xs text-stone-500 mb-2">Loja: {getTenant()} • Entrega com taxa por zona</p>
      <ErrorBox error={error} />

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <Card>
            <h2 className="font-semibold mb-2">Cardápio</h2>
            {categories.length === 0 && <p className="text-sm text-stone-400">Sem produtos.</p>}
            {categories.map((cat) => (
              <div key={cat.id} className="mb-3">
                <h3 className="text-sm font-semibold text-amber-700">{cat.name}</h3>
                <div className="space-y-2 mt-1">
                  {(menu.products || []).filter((p) => p.categoryId === cat.id || p.category_id === cat.id).map((p) => (
                    <div key={p.id} className="flex justify-between gap-2 border border-stone-100 rounded-xl px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-stone-500">R$ {Number(p.price).toFixed(2)} • {p.station}</p>
                      </div>
                      <Button className="!px-2 !py-1 text-xs" onClick={() => addToCart(p)} disabled={!p.isAvailable}>Adicionar</Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Card>

          <Card>
            <h2 className="font-semibold mb-2">Carrinho ({cart.length})</h2>
            {cart.length === 0 ? <p className="text-sm text-stone-400">Vazio.</p> : (
              <ul className="space-y-2">
                {cart.map((it) => (
                  <li key={it.productId} className="flex justify-between gap-2 text-sm">
                    <span>{it.quantity}× {it.productName} — R$ {(it.unitPrice * it.quantity).toFixed(2)}</span>
                    <button className="text-red-600 text-xs" onClick={() => removeFromCart(it.productId)}>remover</button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm font-bold mt-2">Subtotal: R$ {subtotal.toFixed(2)}</p>
            {quote && (
              <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-2 py-2 mt-2">
                <p>Zona: {quote.zone?.name} • Taxa R$ {Number(quote.deliveryFee).toFixed(2)}</p>
                <p>ETA {quote.etaMinutesMin}-{quote.etaMinutesMax} min • Mínimo R$ {Number(quote.minOrderAmount).toFixed(2)} {quote.meetsMinimum ? '✓' : '✗'}</p>
                <p className="font-semibold">Total: R$ {quote.total !== null ? Number(quote.total).toFixed(2) : '—'}</p>
                {!quote.meetsMinimum && <p className="text-red-600">Pedido mínimo não atingido.</p>}
              </div>
            )}
          </Card>
        </div>

        <Card>
          <h2 className="font-semibold mb-3">Dados de entrega</h2>
          <form onSubmit={submit} className="space-y-2">
            <select className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm" value={zoneId} onChange={(e) => setZoneId(e.target.value)} required>
              <option value="">Selecione a zona</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name} — R$ {Number(z.fee).toFixed(2)} (mín R$ {Number(z.minOrderAmount).toFixed(2)})</option>
              ))}
            </select>
            <input className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm" placeholder="Seu nome *" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
            <input className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm" placeholder="Telefone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            <input className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm" placeholder="Rua *" value={address.street} onChange={(e) => setAddress({ ...address, street: e.target.value })} required />
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded-xl border border-stone-300 px-3 py-2 text-sm" placeholder="Número" value={address.number} onChange={(e) => setAddress({ ...address, number: e.target.value })} />
              <input className="rounded-xl border border-stone-300 px-3 py-2 text-sm" placeholder="Bairro" value={address.neighborhood} onChange={(e) => setAddress({ ...address, neighborhood: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded-xl border border-stone-300 px-3 py-2 text-sm" placeholder="Cidade *" value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} required />
              <input className="rounded-xl border border-stone-300 px-3 py-2 text-sm" placeholder="UF" maxLength={2} value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value })} />
            </div>
            <input className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm" placeholder="CEP" value={address.postalCode} onChange={(e) => setAddress({ ...address, postalCode: e.target.value })} />
            <textarea className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm" placeholder="Observações" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <input className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm" placeholder="Complemento" value={address.complement} onChange={(e) => setAddress({ ...address, complement: e.target.value })} />
            <Button type="submit" disabled={submitting || !quote?.meetsMinimum} className="w-full">
              {submitting ? 'Enviando…' : quote ? `Pedir • R$ ${Number(quote.total).toFixed(2)}` : 'Pedir'}
            </Button>
            <p className="text-xs text-stone-400 text-center">Idempotência via `Idempotency-Key` (header+body) — reenvio não duplica pedido.</p>
          </form>
        </Card>
      </div>
    </Shell>
  );
}
