/** UI routing only. The backend independently resolves and authorizes every request. */
export function resolveEntryContext(hostname, baseDomain) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const base = baseDomain.toLowerCase().replace(/\.$/, '');
  if (host === base || host === `www.${base}`)
    return { type: 'marketing', slug: null };
  if (host === `app.${base}` || host === `platform.${base}`)
    return { type: 'platform', slug: null };
  const suffix = `.${base}`;
  const sub = host.endsWith(suffix) ? host.slice(0, -suffix.length) : null;
  return { type: 'store', slug: sub && !sub.includes('.') ? sub : null };
}

export const BASE_DOMAIN = (import.meta.env?.VITE_BASE_DOMAIN || 'localhost')
  .trim()
  .toLowerCase()
  .replace(/\.$/, '');
export const entryContext =
  typeof window === 'undefined'
    ? null
    : resolveEntryContext(window.location.hostname, BASE_DOMAIN);
// Only an explicitly configured dev transport host can supply a fallback slug.
export const devTenant =
  import.meta.env?.DEV && entryContext?.type === 'store'
    ? import.meta.env.VITE_DEV_TENANT_SLUG || ''
    : '';
