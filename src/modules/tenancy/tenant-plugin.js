import fp from 'fastify-plugin';
import { resolveStoreFromRequest, resolveTenantFromQuery } from './resolve-tenant.js';
import { bindRequestLog } from '../../infrastructure/request-context.js';
import { errorResponse, AppError } from '../../shared/errors.js';

// Rotas de plataforma: não têm tenant (probes e métricas — issue #106).
const SKIP_PREFIXES = ['/health', '/ready', '/metrics'];

function shouldSkipTenant(url) {
  const path = url.split('?')[0];
  return SKIP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Plugin Fastify: resolve o tenant e anexa em request.store / request.storeId.
 */
/** De onde veio o tenant: host/custom_domain/header — nunca do body. */
function resolveTenantSource(request, store) {
  const headerSlug = request.headers?.['x-tenant-slug'];
  if (typeof headerSlug === 'string' && headerSlug.trim() === store.slug) return 'header';
  const querySlug = request.query?.tenant;
  if (typeof querySlug === 'string' && querySlug.trim() === store.slug) return 'query';
  return 'host';
}

async function tenantPlugin(app) {
  app.decorateRequest('store', null);
  app.decorateRequest('storeId', null);
  app.decorateRequest('tenantSource', null);

  app.addHook('onRequest', async (request, reply) => {
    if (shouldSkipTenant(request.url)) {
      return;
    }

    try {
      const store = await resolveStoreFromRequest(request);
      if (store) {
        request.store = store;
        request.storeId = store.id;
        request.tenantSource = resolveTenantSource(request, store);
        bindRequestLog(request, {
          storeId: store.id,
          storeSlug: store.slug,
          tenantSource: request.tenantSource,
        });
      }
    } catch (err) {
      if (err instanceof AppError) {
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      throw err;
    }
  });

  app.decorate('requireTenant', async function requireTenant(request, reply) {
    // Rotas marcadas com `allowTenantQuery: true` aceitam `?tenant=<slug>`.
    // Motivo: EventSource (SSE) não envia headers, então em deploy de host único
    // (API servindo a SPA) o browser não tem como mandar X-Tenant-Slug.
    // A autorização continua no `requireStoreAccess` da rota: quem não é membro
    // da loja resolve 403 — o query só substitui o *transporte* do slug.
    if (!request.storeId) {
      try {
        const store = await resolveTenantFromQuery(request);
        if (store) {
          request.store = store;
          request.storeId = store.id;
          request.tenantSource = 'query';
          bindRequestLog(request, {
            storeId: store.id,
            storeSlug: store.slug,
            tenantSource: 'query',
          });
        }
      } catch (err) {
        if (err instanceof AppError) {
          const { statusCode, body } = errorResponse(err);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }

    if (!request.storeId) {
      const err = new AppError(
        'TENANT_REQUIRED',
        'Esta rota exige um tenant (subdomínio ou domínio da loja).',
        400
      );
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }
  });
}

export default fp(tenantPlugin, {
  name: 'tenant-plugin',
  fastify: '5.x',
});
