import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';

const nav = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/menu', label: 'Cardápio' },
  { to: '/admin/tables', label: 'Mesas' },
];

export default function MenuAdminPage() {
  const { user, loading } = useAuth();
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // forms
  const [catName, setCatName] = useState('');
  const [editingCat, setEditingCat] = useState(null);
  const [editCatName, setEditCatName] = useState('');
  const [prodForm, setProdForm] = useState({ categoryId: '', name: '', price: '', description: '', station: 'KITCHEN' });
  const [editingProd, setEditingProd] = useState(null);
  const [filterCat, setFilterCat] = useState('ALL');

  async function load() {
    const [p, c] = await Promise.all([
      api('/api/admin/products' + (filterCat !== 'ALL' ? `?categoryId=${filterCat}` : '')),
      api('/api/admin/categories'),
    ]);
    setProducts(p.products || []);
    setCategories(c.categories || []);
    if (!prodForm.categoryId && c.categories?.[0]) {
      setProdForm((f) => ({ ...f, categoryId: c.categories[0].id }));
    }
  }

  useEffect(() => {
    if (!user) return;
    load().catch(setError);
  }, [user, filterCat]);

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
        body: JSON.stringify({ name: catName.trim(), sortOrder: categories.length + 1 }),
      });
      setCatName('');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function updateCategory(id, patch) {
    setError(null);
    try {
      await api(`/api/admin/categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function deleteCategory(id) {
    if (!confirm('Desativar categoria? Produtos continuarão listados mas a categoria ficará inativa.')) return;
    await updateCategory(id, { isActive: false });
  }

  async function moveCategory(id, dir) {
    const idx = categories.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const target = dir === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= categories.length) return;
    const a = categories[idx];
    const b = categories[target];
    // swap sortOrder
    await Promise.all([
      updateCategory(a.id, { sortOrder: b.sortOrder }),
      updateCategory(b.id, { sortOrder: a.sortOrder }),
    ]);
  }

  async function createProduct(e) {
    e.preventDefault();
    if (!prodForm.categoryId || !prodForm.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/products', {
        method: 'POST',
        body: JSON.stringify({
          categoryId: prodForm.categoryId,
          name: prodForm.name.trim(),
          description: prodForm.description || null,
          price: Number(prodForm.price) || 0,
          station: prodForm.station,
          sortOrder: products.length + 1,
        }),
      });
      setProdForm((f) => ({ ...f, name: '', price: '', description: '' }));
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
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

  async function deleteProduct(p) {
    if (!confirm(`Desativar "${p.name}"?`)) return;
    try {
      await api(`/api/admin/products/${p.id}`, {
        method: 'DELETE',
      });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Shell title="Cardápio" nav={nav}>
      <ErrorBox error={error} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Categories */}
        <Card>
          <h2 className="font-semibold mb-3">Categorias</h2>
          <form onSubmit={createCategory} className="flex gap-2 mb-3">
            <input
              className="flex-1 rounded-xl border border-stone-300 px-3 py-2 text-sm"
              placeholder="Nova categoria"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              required
            />
            <Button type="submit" disabled={busy || !catName.trim()}>
              Criar
            </Button>
          </form>

          <div className="space-y-2">
            {categories.length === 0 && <p className="text-sm text-stone-400">Nenhuma categoria.</p>}
            {categories.map((c, idx) => (
              <div key={c.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${c.isActive ? 'bg-white' : 'bg-stone-50 opacity-60'}`}>
                <div className="flex flex-col gap-1">
                  <button
                    className="text-xs leading-none disabled:opacity-30"
                    disabled={idx === 0}
                    onClick={() => moveCategory(c.id, 'up')}
                    title="Mover para cima"
                  >
                    ▲
                  </button>
                  <button
                    className="text-xs leading-none disabled:opacity-30"
                    disabled={idx === categories.length - 1}
                    onClick={() => moveCategory(c.id, 'down')}
                    title="Mover para baixo"
                  >
                    ▼
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  {editingCat === c.id ? (
                    <input
                      className="w-full rounded-lg border border-amber-300 px-2 py-1 text-sm"
                      value={editCatName}
                      onChange={(e) => setEditCatName(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          await updateCategory(c.id, { name: editCatName.trim() || c.name });
                          setEditingCat(null);
                        }
                        if (e.key === 'Escape') setEditingCat(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <p className="text-sm font-medium truncate">
                      {c.name} {!c.isActive && <span className="text-xs text-red-600">(inativa)</span>}
                    </p>
                  )}
                  <p className="text-xs text-stone-400">ordem {c.sortOrder} • {c.isActive ? 'ativa' : 'inativa'}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  {editingCat === c.id ? (
                    <>
                      <Button
                        className="!px-2 !py-1 text-xs"
                        onClick={async () => {
                          await updateCategory(c.id, { name: editCatName.trim() || c.name });
                          setEditingCat(null);
                        }}
                      >
                        Salvar
                      </Button>
                      <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setEditingCat(null)}>
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        className="!px-2 !py-1 text-xs"
                        onClick={() => {
                          setEditingCat(c.id);
                          setEditCatName(c.name);
                        }}
                      >
                        Editar
                      </Button>
                      <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => deleteCategory(c.id)}>
                        Desativar
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-stone-400 mt-3">
            Reordenação altera `sortOrder` e invalida cache do menu (tenant-aware). Categorias inativas não aparecem no cardápio público.
          </p>
        </Card>

        {/* New product */}
        <Card>
          <h2 className="font-semibold mb-3">Novo produto</h2>
          <form onSubmit={createProduct} className="space-y-2">
            <select
              className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm"
              value={prodForm.categoryId}
              onChange={(e) => setProdForm((f) => ({ ...f, categoryId: e.target.value }))}
              required
            >
              {categories.filter((c) => c.isActive).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {categories.filter((c) => c.isActive).length === 0 && <option value="">Crie uma categoria primeiro</option>}
            </select>
            <input
              className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm"
              placeholder="Nome do produto"
              value={prodForm.name}
              onChange={(e) => setProdForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
            <input
              className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm"
              placeholder="Descrição (opcional)"
              value={prodForm.description}
              onChange={(e) => setProdForm((f) => ({ ...f, description: e.target.value }))}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
                type="number"
                step="0.01"
                placeholder="Preço"
                value={prodForm.price}
                onChange={(e) => setProdForm((f) => ({ ...f, price: e.target.value }))}
                required
              />
              <select
                className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
                value={prodForm.station}
                onChange={(e) => setProdForm((f) => ({ ...f, station: e.target.value }))}
              >
                <option value="KITCHEN">Cozinha</option>
                <option value="BAR">Bar</option>
              </select>
            </div>
            <Button type="submit" className="w-full" disabled={busy || !prodForm.categoryId}>
              Adicionar produto
            </Button>
          </form>
          <div className="mt-3 flex gap-2">
            <label className="text-xs text-stone-500">Filtrar por categoria:</label>
            <select
              className="text-xs border rounded-lg px-2 py-1"
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
            >
              <option value="ALL">Todas</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </Card>
      </div>

      {/* Products list */}
      <div className="mt-4 space-y-2">
        <h2 className="font-semibold">Produtos ({products.length})</h2>
        {products.length === 0 && <Card><p className="text-sm text-stone-400">Nenhum produto nesta categoria.</p></Card>}
        {products.map((p) => (
          <Card key={p.id} className="flex justify-between items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">
                {p.name} {!p.isActive && <span className="text-xs text-red-600">· inativo</span>}
              </p>
              <p className="text-sm text-stone-500 truncate">
                R$ {Number(p.price).toFixed(2)} · {p.station} · {p.isAvailable ? 'disponível' : 'esgotado'} · ordem {p.sortOrder}
              </p>
              {p.description && <p className="text-xs text-stone-400 truncate">{p.description}</p>}
            </div>
            <div className="flex gap-1 shrink-0 flex-wrap justify-end">
              <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => toggleAvailable(p)}>
                {p.isAvailable ? 'Esgotar' : 'Disponibilizar'}
              </Button>
              <Button
                variant="secondary"
                className="!px-2 !py-1 text-xs"
                onClick={async () => {
                  const name = prompt('Novo nome', p.name);
                  if (name && name !== p.name) {
                    try {
                      await api(`/api/admin/products/${p.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
                      await load();
                    } catch (err) {
                      setError(err);
                    }
                  }
                }}
              >
                Renomear
              </Button>
              <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => deleteProduct(p)}>
                Desativar
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <p className="text-xs text-stone-400 mt-4 text-center">
        Todas as mutações invalidam cache do menu (`store_id` scoped) e são isoladas por loja — 403 cross-store garantido via `requireStoreAccess`.
      </p>
    </Shell>
  );
}
