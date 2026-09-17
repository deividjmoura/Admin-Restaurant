import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';
import { ADMIN_NAV } from './adminNav';

export default function MenuAdminPage() {
  const { user, loading } = useAuth();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // new product
  const [name, setName] = useState('');
  const [price, setPrice] = useState('10');
  const [categoryId, setCategoryId] = useState('');
  const [station, setStation] = useState('KITCHEN');
  const [description, setDescription] = useState('');

  // new category
  const [catName, setCatName] = useState('');

  // edit product
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([
      api('/api/admin/products'),
      api('/api/admin/categories'),
    ]);
    setProducts(p.products || []);
    setCategories(c.categories || []);
    if (!categoryId && c.categories?.[0]) setCategoryId(c.categories[0].id);
  }, [categoryId]);

  useEffect(() => {
    if (!user) return;
    load().catch(setError);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/admin/menu' }} />;

  async function createCategory(e) {
    e.preventDefault();
    if (!catName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/categories', {
        method: 'POST',
        body: JSON.stringify({ name: catName.trim() }),
      });
      setCatName('');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function softDeleteCategory(id) {
    if (!confirm('Desativar esta categoria?')) return;
    setError(null);
    try {
      await api(`/api/admin/categories/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function createProduct(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/products', {
        method: 'POST',
        body: JSON.stringify({
          categoryId,
          name,
          price: Number(price),
          station,
          description: description || null,
        }),
      });
      setName('');
      setDescription('');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/products/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editing.name,
          price: Number(editing.price),
          station: editing.station,
          description: editing.description || null,
          categoryId: editing.categoryId,
        }),
      });
      setEditing(null);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAvailable(p) {
    setError(null);
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

  async function softDeleteProduct(id) {
    if (!confirm('Desativar este produto?')) return;
    setError(null);
    try {
      await api(`/api/admin/products/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  const activeCategories = categories.filter((c) => c.isActive !== false);
  const activeProducts = products.filter((p) => p.isActive !== false);

  return (
    <Shell title="Cardápio" nav={ADMIN_NAV}>
      <ErrorBox error={error} />

      {/* Categorias */}
      <Card className="mb-4">
        <h2 className="font-semibold mb-3">Categorias</h2>
        <form onSubmit={createCategory} className="flex flex-wrap gap-2 mb-3">
          <input
            className="rounded-xl border border-stone-300 px-3 py-2 text-sm flex-1 min-w-[140px]"
            placeholder="Nova categoria"
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            Adicionar
          </Button>
        </form>
        <ul className="flex flex-wrap gap-2">
          {activeCategories.map((c) => (
            <li
              key={c.id}
              className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1 text-sm"
            >
              {c.name}
              <button
                type="button"
                className="text-stone-400 hover:text-red-600 text-xs ml-1"
                onClick={() => softDeleteCategory(c.id)}
                title="Desativar"
              >
                ×
              </button>
            </li>
          ))}
          {activeCategories.length === 0 && (
            <li className="text-sm text-stone-500">Nenhuma categoria ativa.</li>
          )}
        </ul>
      </Card>

      {/* Novo produto */}
      <Card className="mb-4">
        <h2 className="font-semibold mb-3">Novo produto</h2>
        <form onSubmit={createProduct} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <select
            className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
          >
            <option value="">Categoria</option>
            {activeCategories.map((c) => (
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
            min="0"
            placeholder="Preço"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
          <select
            className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
            value={station}
            onChange={(e) => setStation(e.target.value)}
          >
            <option value="KITCHEN">Cozinha</option>
            <option value="BAR">Bar</option>
          </select>
          <input
            className="rounded-xl border border-stone-300 px-3 py-2 text-sm sm:col-span-2"
            placeholder="Descrição (opcional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button type="submit" disabled={busy || !categoryId}>
            {busy ? 'Salvando…' : 'Adicionar produto'}
          </Button>
        </form>
      </Card>

      {/* Edição inline */}
      {editing && (
        <Card className="mb-4 ring-2 ring-amber-400">
          <h2 className="font-semibold mb-3">Editar produto</h2>
          <form onSubmit={saveEdit} className="grid gap-2 sm:grid-cols-2">
            <input
              className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              required
            />
            <input
              className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
              type="number"
              step="0.01"
              value={editing.price}
              onChange={(e) => setEditing({ ...editing, price: e.target.value })}
              required
            />
            <select
              className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
              value={editing.categoryId}
              onChange={(e) => setEditing({ ...editing, categoryId: e.target.value })}
            >
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
              value={editing.station}
              onChange={(e) => setEditing({ ...editing, station: e.target.value })}
            >
              <option value="KITCHEN">Cozinha</option>
              <option value="BAR">Bar</option>
            </select>
            <input
              className="rounded-xl border border-stone-300 px-3 py-2 text-sm sm:col-span-2"
              placeholder="Descrição"
              value={editing.description || ''}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy}>
                Salvar
              </Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Lista */}
      <div className="space-y-2">
        {activeProducts.length === 0 && (
          <Card>
            <p className="text-sm text-stone-500">Nenhum produto ativo.</p>
          </Card>
        )}
        {activeProducts.map((p) => (
          <Card key={p.id} className="flex flex-wrap justify-between items-center gap-3">
            <div className="min-w-0">
              <p className="font-medium text-stone-900">{p.name}</p>
              <p className="text-sm text-stone-500">
                R$ {Number(p.price).toFixed(2)} · {p.station}
                {!p.isAvailable && ' · esgotado'}
              </p>
              {p.description && (
                <p className="text-xs text-stone-400 mt-0.5 line-clamp-1">{p.description}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              <Button variant="secondary" className="!py-1 !px-2 text-xs" onClick={() => setEditing({ ...p })}>
                Editar
              </Button>
              <Button variant="secondary" className="!py-1 !px-2 text-xs" onClick={() => toggleAvailable(p)}>
                {p.isAvailable ? 'Esgotar' : 'Disponibilizar'}
              </Button>
              <Button variant="secondary" className="!py-1 !px-2 text-xs" onClick={() => softDeleteProduct(p.id)}>
                Desativar
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </Shell>
  );
}
