import {
  isApexHost,
  isPlatformHost,
  normalizeHost,
} from '../modules/tenancy/tenant-host.js';
import { allowsTenantFallback } from '../modules/tenancy/resolve-tenant.js';

const list = (key) =>
  (process.env[key] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Explicit origins, separated by entry context. No wildcard / reflected Origin. */
export function isAllowedOrigin(request, origin) {
  if (!origin) return true; // Non-browser clients still require authentication.
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
    return false;
  const host = normalizeHost(request.headers.host);
  const type = isApexHost(host)
    ? 'MARKETING'
    : isPlatformHost(host)
      ? 'PLATFORM'
      : 'STORE';
  const allowed = [
    ...list('CORS_ORIGIN'),
    ...list('FRONTEND_ORIGIN'),
    ...list(`CORS_${type}_ORIGINS`),
  ];
  const sameHost =
    normalizeHost(url.host) === host &&
    url.host.toLowerCase() === request.headers.host?.toLowerCase();
  if (process.env.NODE_ENV !== 'production' && sameHost) return true;
  if (!allowed.includes(origin)) return false;
  if (
    ['/health', '/ready', '/api/public/health'].includes(
      request.url.split('?')[0]
    )
  )
    return true;
  if (sameHost) return true;
  if (type === 'MARKETING') return isApexHost(url.hostname);
  if (type === 'PLATFORM') return isPlatformHost(url.hostname);
  // A store origin is not trusted on another store. Only a controlled transport
  // endpoint may accept cross-origin store traffic and tenant fallback headers.
  return (
    allowsTenantFallback(request) &&
    !isApexHost(url.hostname) &&
    !isPlatformHost(url.hostname)
  );
}
