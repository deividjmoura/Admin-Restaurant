/**
 * Pure helpers for host / subdomain parsing.
 * Kept free of DB imports so unit tests run without pg installed.
 */

const baseDomain = () => (process.env.BASE_DOMAIN || 'localhost').trim().toLowerCase();
export const RESERVED_SLUGS = ['www', 'app', 'platform', 'api', 'admin', 'static', 'cdn', 'mail'];

export function isApexHost(host) {
  const h = normalizeHost(host);
  return h === baseDomain() || h === `www.${baseDomain()}`;
}

export function isPlatformHost(host) {
  const h = normalizeHost(host);
  return h === `app.${baseDomain()}` || h === `platform.${baseDomain()}`;
}

/**
 * Extrai o host sem porta.
 * @param {string} hostHeader
 * @returns {string}
 */
export function normalizeHost(hostHeader) {
  if (!hostHeader || typeof hostHeader !== 'string') return '';
  return hostHeader.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

/**
 * Dado o host, tenta extrair o slug do subdomínio em relação ao BASE_DOMAIN.
 * @param {string} host
 * @returns {string|null}
 */
export function extractSubdomainSlug(host) {
  const h = normalizeHost(host);
  if (!h) return null;

  if (isApexHost(h) || isPlatformHost(h)) {
    return null;
  }

  const suffix = `.${baseDomain()}`;
  if (h.endsWith(suffix)) {
    const sub = h.slice(0, -suffix.length);
    if (sub && !sub.includes('.')) {
      return sub;
    }
  }

  return null;
}

export function getBaseDomain() {
  return baseDomain();
}
