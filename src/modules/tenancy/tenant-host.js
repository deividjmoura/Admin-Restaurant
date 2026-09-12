/**
 * Pure helpers for host / subdomain parsing.
 * Kept free of DB imports so unit tests run without pg installed.
 */

const BASE_DOMAIN = (process.env.BASE_DOMAIN || 'localhost').toLowerCase();

/**
 * Extrai o host sem porta.
 * @param {string} hostHeader
 * @returns {string}
 */
export function normalizeHost(hostHeader) {
  if (!hostHeader || typeof hostHeader !== 'string') return '';
  return hostHeader.split(':')[0].trim().toLowerCase();
}

/**
 * Dado o host, tenta extrair o slug do subdomínio em relação ao BASE_DOMAIN.
 * @param {string} host
 * @returns {string|null}
 */
export function extractSubdomainSlug(host) {
  const h = normalizeHost(host);
  if (!h) return null;

  if (h === BASE_DOMAIN || h === `www.${BASE_DOMAIN}`) {
    return null;
  }

  const suffix = `.${BASE_DOMAIN}`;
  if (h.endsWith(suffix)) {
    const sub = h.slice(0, -suffix.length);
    if (sub && !sub.includes('.')) {
      return sub;
    }
  }

  return null;
}

export function getBaseDomain() {
  return BASE_DOMAIN;
}
