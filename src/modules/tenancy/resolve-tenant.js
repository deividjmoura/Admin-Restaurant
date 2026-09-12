import { findBySlug, findByCustomDomain } from './store.repository.js';
import { AppError } from '../../shared/errors.js';

const BASE_DOMAIN = (process.env.BASE_DOMAIN || 'localhost').toLowerCase();
const isDev = process.env.NODE_ENV !== 'production';

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
 * Exemplos (BASE_DOMAIN=seudominio.com):
 *   loja1.seudominio.com  → loja1
 *   www.seudominio.com    → null (apex / www)
 *   seudominio.com        → null
 *
 * Para localhost:
 *   demo.localhost        → demo
 *   localhost             → null
 *
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

/**
 * Resolve a loja a partir do request.
 * Ordem:
 * 1. Subdomínio do BASE_DOMAIN
 * 2. custom_domain (host completo)
 * 3. (somente dev) header X-Tenant-Slug
 *
 * Nunca confia em store_id enviado pelo cliente como fonte de verdade.
 *
 * @param {import('fastify').FastifyRequest} request
 * @returns {Promise<object|null>} store ou null se não houver tenant no host
 */
export async function resolveStoreFromRequest(request) {
  const host = normalizeHost(request.headers.host);

  const slug = extractSubdomainSlug(host);
  if (slug) {
    const store = await findBySlug(slug);
    if (!store) {
      throw new AppError('TENANT_NOT_FOUND', 'Loja não encontrada.', 404);
    }
    if (store.status !== 'active') {
      throw new AppError('TENANT_INACTIVE', 'Loja indisponível.', 403);
    }
    return store;
  }

  if (host && host !== BASE_DOMAIN && host !== `www.${BASE_DOMAIN}`) {
    const byDomain = await findByCustomDomain(host);
    if (byDomain) {
      if (byDomain.status !== 'active') {
        throw new AppError('TENANT_INACTIVE', 'Loja indisponível.', 403);
      }
      return byDomain;
    }
  }

  if (isDev) {
    const headerSlug = request.headers['x-tenant-slug'];
    if (typeof headerSlug === 'string' && headerSlug.trim()) {
      const store = await findBySlug(headerSlug.trim());
      if (!store) {
        throw new AppError('TENANT_NOT_FOUND', 'Loja não encontrada.', 404);
      }
      if (store.status !== 'active') {
        throw new AppError('TENANT_INACTIVE', 'Loja indisponível.', 403);
      }
      return store;
    }
  }

  return null;
}
