import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';

/**
 * Polling resiliente para painéis de operação (cozinha, bar, garçom, caixa).
 *
 * Regras que este hook garante:
 *  - nenhum erro é engolido (`load().catch(() => {})`): todo erro vira estado;
 *  - 401 → limpa a sessão e manda para o login;
 *  - 403 → banner de acesso negado (nunca silencioso);
 *  - 429 → aviso de limite (e o polling desacelera);
 *  - 5xx/rede → banner de conexão perdida, mantendo os últimos dados na tela;
 *  - pausa quando a aba está em background (document.hidden) e retoma ao voltar.
 */
export function usePolling(path, { intervalMs = 5000, enabled = true } = {}) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [offline, setOffline] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(
    typeof document === 'undefined' ? true : !document.hidden
  );

  const mounted = useRef(true);
  const inFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await api(path);
      if (!mounted.current) return;
      setData(result);
      setError(null);
      setRateLimited(false);
      setOffline(false);
      setLoaded(true);
    } catch (err) {
      if (!mounted.current) return;

      if (!(err instanceof ApiError)) {
        setError(err);
        setLoaded(true);
        return;
      }

      if (err.isAuthError) {
        // Sessão inválida/expirada: encerra e volta para o login.
        await logout().catch(() => {});
        navigate('/login', { replace: true, state: { from: path } });
        return;
      }

      if (err.isRateLimited) {
        setRateLimited(true);
        setError(null);
        setLoaded(true);
        return;
      }

      if (err.isServerOrNetworkError) {
        // Mantém os últimos dados na tela e sinaliza conexão perdida.
        setOffline(true);
        setError(null);
        setLoaded(true);
        return;
      }

      setError(err);
      setLoaded(true);
    } finally {
      inFlight.current = false;
    }
  }, [path, logout, navigate]);

  // Alterna pausa/retomada conforme a visibilidade da aba.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!visible) return undefined;

    load();
    // Backoff simples quando o servidor responde 429.
    const period = rateLimited ? intervalMs * 4 : intervalMs;
    const id = setInterval(load, period);
    return () => clearInterval(id);
  }, [enabled, visible, load, intervalMs, rateLimited]);

  // Ao voltar para a aba, atualiza imediatamente.
  useEffect(() => {
    if (enabled && visible) load();
  }, [visible, enabled, load]);

  return { data, error, loaded, offline, rateLimited, reload: load };
}
