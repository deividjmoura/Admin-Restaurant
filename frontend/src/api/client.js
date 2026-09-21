const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

import { entryContext, devTenant } from '../context/entry-context';

export function getTenant() {
  return entryContext.type === 'store' ? entryContext.slug || devTenant || window.location.hostname : '';
}

/** UUID v4 for Idempotency-Key (safe client retries). */
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = null, data = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }

  /** 4xx de autenticação/autorização → a sessão precisa ser refeita. */
  get isAuthError() {
    return this.status === 401;
  }

  /** 403 — autenticado, mas sem permissão para a ação. */
  get isForbidden() {
    return this.status === 403;
  }

  /** 429 — limite de requisições. */
  get isRateLimited() {
    return this.status === 429;
  }

  /** 5xx ou falha de rede — o painel deve sinalizar conexão perdida. */
  get isServerOrNetworkError() {
    return this.status === 0 || this.status >= 500;
  }
}

/**
 * Fetch JSON against API with tenant header + cookies.
 */
export async function api(path, options = {}) {
  const tenant = devTenant;
  const headers = {
    'Content-Type': 'application/json',
    ...(tenant ? { 'X-Tenant-Slug': tenant } : {}),
    ...(options.headers || {}),
  };

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      credentials: 'include',
      ...options,
      headers,
    });
  } catch (networkErr) {
    throw new ApiError('Sem conexão com o servidor.', { status: 0 });
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new ApiError(data?.error?.message || data?.message || res.statusText, {
      status: res.status,
      code: data?.error?.code || data?.code || null,
      data,
    });
  }
  return data;
}

export function apiUrl(path) {
  return `${API_URL}${path}`;
}
