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

export default function TablesAdminPage() {
  const { user, loading } = useAuth();
  const [tables, setTables] = useState([]);
  const [error, setError] = useState(null);
  const [number, setNumber] = useState('');

  async function load() {
    const data = await api('/api/admin/tables');
    setTables(data.tables || []);
  }

  useEffect(() => {
    if (!user) return;
    load().catch(setError);
  }, [user]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/admin/tables' }} />;

  async function createTable(e) {
    e.preventDefault();
    try {
      await api('/api/admin/tables', {
        method: 'POST',
        body: JSON.stringify({ number: Number(number) }),
      });
      setNumber('');
      await load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Shell title="Mesas" nav={nav}>
      <ErrorBox error={error} />
      <Card className="mb-4">
        <form onSubmit={createTable} className="flex gap-2">
          <input
            type="number"
            className="rounded-xl border border-stone-300 px-3 py-2 text-sm w-32"
            placeholder="Nº"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            required
          />
          <Button type="submit">Criar mesa</Button>
        </form>
      </Card>
      <div className="space-y-2">
        {tables.map((t) => (
          <Card key={t.id}>
            <div className="flex justify-between gap-2">
              <div>
                <p className="font-medium">
                  Mesa {t.number} {t.label ? `· ${t.label}` : ''}
                </p>
                <p className="text-xs text-stone-500 break-all">
                  Token: {t.publicToken}
                </p>
                <a
                  className="text-xs text-amber-700 underline"
                  href={`/m/${t.publicToken}`}
                >
                  Abrir QR cliente
                </a>
              </div>
              <span className="text-xs text-stone-500">{t.status}</span>
            </div>
          </Card>
        ))}
      </div>
    </Shell>
  );
}
