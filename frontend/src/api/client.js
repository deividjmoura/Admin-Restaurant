const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const DEFAULT_TENANT = import.meta.env.VITE_TENANT_SLUG || 'demo';

function getTenantSlug() {
  const params = new URLSearchParams(window.location.search);
  return params.get('tenant') || localStorage.getItem('tenantSlug') || DEFAULT_TENANT;
}

export function setTenantSlug(slug) {
  if (slug) localStorage.setItem('tenantSlug', slug);
}

export function getTenant() {
  return getTenantSlug();
}

/**
 * Fetch JSON against API with tenant header + cookies.
 * options.idempotencyKey → header Idempotency-Key (operações críticas).
 */
export async function api(path, options = {}) {
  const { idempotencyKey, headers: extraHeaders, ...rest } = options;

  const headers = {
    'Content-Type': 'application/json',
    'X-Tenant-Slug': getTenantSlug(),
    ...(extraHeaders || {}),
  };

  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    ...rest,
    headers,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(data?.error?.message || data?.message || res.statusText);
    err.status = res.status;
    err.code = data?.error?.code || data?.code;
    err.data = data;
    throw err;
  }
  return data;
}

export function apiUrl(path) {
  return `${API_URL}${path}`;
}
