import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setTenantSlug, getTenant } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api('/api/auth/me');
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

  async function login(email, password, tenantSlug) {
    if (tenantSlug) setTenantSlug(tenantSlug);
    const data = await api('/api/auth/login', {
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
