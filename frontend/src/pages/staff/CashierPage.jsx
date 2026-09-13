import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Shell, Card, Button, Spinner, ErrorBox } from '../../components/Layout';

export default function CashierPage() {
  const { user, loading } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const data = await api('/api/cashier/sessions');
    setSessions(data.sessions || data || []);
  }, []);

  useEffect(() => {
    if (!user) return;
    load().catch(setError);
  }, [user, load]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: '/cashier' }} />;

  async function closeSession(id) {
    try {
      await api(`/api/cashier/sessions/${id}/close`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Shell
      title="Caixa"
      nav={[
        { to: '/cashier', label: 'Caixa' },
        { to: '/kitchen', label: 'Cozinha' },
        { to: '/admin', label: 'Admin' },
      ]}
    >
      <ErrorBox error={error} />
      <div className="space-y-3">
        {sessions.length === 0 && (
          <Card>
            <p className="text-sm text-stone-500">Nenhuma sessão aberta.</p>
          </Card>
        )}
        {sessions.map((s) => (
          <Card key={s.id} className="flex justify-between items-center gap-3">
            <div>
              <p className="font-medium">
                Mesa {s.tableNumber || s.table_number || s.table?.number || '—'}
              </p>
              <p className="text-xs text-stone-500">
                Sessão #{String(s.id).slice(0, 8)} · {s.status}
              </p>
            </div>
            {s.status === 'open' && (
              <Button variant="secondary" onClick={() => closeSession(s.id)}>
                Fechar
              </Button>
            )}
          </Card>
        ))}
      </div>
    </Shell>
  );
}
