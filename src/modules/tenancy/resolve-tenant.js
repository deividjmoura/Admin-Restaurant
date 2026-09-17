import { findBySlug, findByCustomDomain } from './store.repository.js';
import { AppError } from '../../shared/errors.js';
import {
  normalizeHost,
  extractSubdomainSlug,
  getBaseDomain,
} from './tenant-host.js';

export { normalizeHost, extractSubdomainSlug };

/**
 * Resolve a loja a partir do request.
 * Ordem:
 * 1. Subdomínio do BASE_DOMAIN
 * 2. custom_domain (host completo)
 * 3. Header X-Tenant-Slug (fallback — necessário para SPA em domínio diferente)
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

  if (host && host !== getBaseDomain() && host !== `www.${getBaseDomain()}`) {
    const byDomain = await findByCustomDomain(host);
    if (byDomain) {
      if (byDomain.status !== 'active') {
        throw new AppError('TENANT_INACTIVE', 'Loja indisponível.', 403);
      }
      return byDomain;
    }
  }

  // Fallback: header (SPA em domínio separado, ou ferramentas como curl/Postman)
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

  // Fallback extra para EventSource/SSE: tenant via query ?tenant=slug
  // EventSource não permite custom headers, então o frontend passa o tenant na URL.
  const querySlug = request.query?.tenant || request.query?.store || request.query?.storeSlug || request.query?.slug;
  if (typeof querySlug === 'string' && querySlug.trim()) {
    const store = await findBySlug(querySlug.trim());
    if (!store) {
      throw new AppError('TENANT_NOT_FOUND', 'Loja não encontrada.', 404);
    }
    if (store.status !== 'active') {
      throw new AppError('TENANT_INACTIVE', 'Loja indisponível.', 403);
    }
    return store;
  }

  return null;
}
