const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

import { entryContext, devTenant } from '../context/entry-context';

/**
 * Slug de tenant enviado no header X-Tenant-Slug.
 * Ordem: subdomínio resolvido → VITE_TENANT_SLUG (prod/transport) → VITE_DEV_TENANT_SLUG (só DEV).
 * Em produção cross-origin (SPA e API em hosts diferentes) configure VITE_TENANT_SLUG
 * e no backend TENANT_FALLBACK_HOSTS + TENANT_FALLBACK_ORIGINS.
 */
function resolveTenantSlug() {
  if (entryContext?.type === 'store' && entryContext.slug) {
    return entryContext.slug;
  }
  const explicit =
    (import.meta.env.VITE_TENANT_SLUG || '').trim() ||
    (import.meta.env.DEV ? (import.meta.env.VITE_DEV_TENANT_SLUG || '').trim() : '');
  return explicit || '';
}

export function getTenant() {
  if (entryContext?.type === 'platform' || entryContext?.type === 'marketing') {
    return '';
  }
  return resolveTenantSlug() || (typeof window !== 'undefined' ? window.location.hostname : '');
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

  get isAuthError() {
    return this.status === 401;
  }

  get isForbidden() {
    return this.status === 403;
  }

  get isRateLimited() {
    return this.status === 429;
  }

  get isServerOrNetworkError() {
    return this.status === 0 || this.status >= 500;
  }
}

/**
 * Fetch JSON against API with tenant header + cookies.
 */
export async function api(path, options = {}) {
  const tenant = resolveTenantSlug();
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
