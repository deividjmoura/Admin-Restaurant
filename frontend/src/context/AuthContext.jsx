import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getTenant } from '../api/client';

import { entryContext } from './entry-context';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (entryContext.type === 'marketing' || window.location.pathname.startsWith('/m/')) { setLoading(false); return; }
    try {
      const data = await api(entryContext.type === 'platform' ? '/api/platform/me' : '/api/me');
      setUser(data.user || data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function login(email, password) {
    const data = await api(`/api/auth/${entryContext.type}/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setUser(data.user || data);
    return data;
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, refresh, tenant: getTenant() }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
