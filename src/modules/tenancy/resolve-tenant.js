import { findBySlug, findByCustomDomain } from './store.repository.js';
import { AppError } from '../../shared/errors.js';
import {
  normalizeHost,
  extractSubdomainSlug,
  getBaseDomain,
  isApexHost,
  isPlatformHost,
} from './tenant-host.js';

export { normalizeHost, extractSubdomainSlug };

/**
 * Busca a loja pelo slug e garante que está ativa.
 * Usado pelos fallbacks de slug (header e query) — o host continua sendo a
 * fonte preferencial em `resolveStoreFromRequest`.
 *
 * @param {string} slug
 * @returns {Promise<object>} store
 */
export async function findActiveStoreBySlug(slug) {
  const store = await findBySlug(slug);
  if (!store) {
    throw new AppError('TENANT_NOT_FOUND', 'Loja não encontrada.', 404);
  }
  if (store.status !== 'active') {
    throw new AppError('TENANT_INACTIVE', 'Loja indisponível.', 403);
  }
  return store;
}

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

  // Reserved entry hosts can NEVER be converted into a store via fallbacks.
  if (isApexHost(host) || isPlatformHost(host)) return null;

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
  if (allowsTenantFallback(request) && typeof headerSlug === 'string' && headerSlug.trim()) {
    const store = await findBySlug(headerSlug.trim());
    if (!store) {
      throw new AppError('TENANT_NOT_FOUND', 'Loja não encontrada.', 404);
    }
    if (store.status !== 'active') {
      throw new AppError('TENANT_INACTIVE', 'Loja indisponível.', 403);
    }
    return store;
  }

  // Demo single-origin: quando nenhum tenant resolve pelo Host e DEFAULT_STORE_SLUG
  // está definido (ex.: deploy de loja única em host sem subdomínio de loja, como
  // um serviço Render), usa essa loja como padrão. Desligado por padrão — não
  // afeta deploy multi-tenant normal (onde a variável fica vazia).
  const defaultSlug = (process.env.DEFAULT_STORE_SLUG || '').trim();
  if (defaultSlug) {
    return findActiveStoreBySlug(defaultSlug);
  }

  return null;
}

/**
 * Fallback de slug por query — só quando a rota optou com
 * `config: { allowTenantQuery: true }`. Nunca global.
 */
export async function resolveTenantFromQuery(request) {
  if (!allowsTenantFallback(request)) return null;
  if (!request.routeOptions?.config?.allowTenantQuery) return null;
  const slug = request.query?.tenant;
  if (typeof slug !== 'string' || !slug.trim()) return null;
  return findActiveStoreBySlug(slug.trim());
}

// Production cross-origin transport is opt-in for BOTH the API host and origin.
// Origin is transport policy, not authorization; JWT/membership checks still apply.
export function allowsTenantFallback(request) {
  const host = normalizeHost(request.headers?.host);
  if (isApexHost(host) || isPlatformHost(host)) return false;
  if (process.env.NODE_ENV !== 'production') return true;
  const hosts = (process.env.TENANT_FALLBACK_HOSTS || '').split(',').map(normalizeHost);
  const origins = (process.env.TENANT_FALLBACK_ORIGINS || '').split(',').filter(Boolean);
  return !!host && hosts.includes(host) && origins.includes(request.headers?.origin);
}
