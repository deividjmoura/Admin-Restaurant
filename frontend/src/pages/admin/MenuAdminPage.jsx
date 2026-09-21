import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  Shell,
  Card,
  Button,
  Spinner,
  ErrorBox,
  EmptyState,
} from '../../components/Layout';

const nav = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/menu', label: 'Cardápio' },
  { to: '/admin/tables', label: 'Mesas' },
  { to: '/cashier', label: 'Caixa' },
];

export default function MenuAdminPage() {
  const { user, loading } = useAuth();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('10');
  const [categoryId, setCategoryId] = useState('');

  async function load() {
    const [p, c] = await Promise.all([
      api('/api/admin/products'),
      api('/api/admin/categories'),
    ]);
    setProducts(p.products || []);
    setCategories(c.categories || []);
    if (!categoryId && c.categories?.[0]) setCategoryId(c.categories[0].id);
    setLoaded(true);
  }

  useEffect(() => {
    if (!user) return;
    load().catch((err) => {
      setError(err);
      setLoaded(true);
    });
  }, [user]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/admin/menu' }} />;

  async function createProduct(e) {
    e.preventDefault();
    setError(null);
    try {
      await api('/api/admin/products', {
        method: 'POST',
        body: JSON.stringify({
          categoryId,
          name,
          price: Number(price),
          station: 'KITCHEN',
        }),
      });
      setName('');
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function toggleAvailable(p) {
    try {
      await api(`/api/admin/products/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isAvailable: !p.isAvailable }),
      });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Shell title="Cardápio" nav={nav}>
      <ErrorBox error={error} />
      <Card className="mb-4">
        <h2 className="font-semibold mb-3">Novo produto</h2>
        <form onSubmit={createProduct} className="grid gap-2 sm:grid-cols-4">
          <select
            className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
            placeholder="Nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
            type="number"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
          <Button type="submit">Adicionar</Button>
        </form>
      </Card>

      {!loaded && <Spinner />}

      {loaded && products.length === 0 && (
        <EmptyState
          title="Nenhum produto"
          description="Crie categorias e produtos para o cardápio da loja."
          icon="📋"
        />
      )}

      <div className="space-y-2">
        {products.map((p) => (
          <Card key={p.id} className="flex justify-between items-center gap-3">
            <div>
              <p className="font-medium">
                {p.name}{' '}
                {!p.isActive && (
                  <span className="text-xs text-red-600">inativo</span>
                )}
              </p>
              <p className="text-sm text-stone-500">
                R$ {Number(p.price).toFixed(2)} · {p.station}
                {!p.isAvailable && ' · esgotado'}
              </p>
            </div>
            <Button variant="secondary" onClick={() => toggleAvailable(p)}>
              {p.isAvailable ? 'Esgotar' : 'Disponibilizar'}
            </Button>
          </Card>
        ))}
      </div>
    </Shell>
  );
}
