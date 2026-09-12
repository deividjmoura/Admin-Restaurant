import { findBySlug, findByCustomDomain } from './store.repository.js';
import { AppError } from '../../shared/errors.js';
import {
  normalizeHost,
  extractSubdomainSlug,
  getBaseDomain,
} from './tenant-host.js';

export { normalizeHost, extractSubdomainSlug };

const isDev = process.env.NODE_ENV !== 'production';

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

  if (host && host !== getBaseDomain() && host !== `www.${getBaseDomain()}`) {
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
