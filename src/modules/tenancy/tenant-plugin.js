import fp from 'fastify-plugin';
import { resolveStoreFromRequest, resolveTenantFromQuery } from './resolve-tenant.js';
import { errorResponse, AppError } from '../../shared/errors.js';

import { isApexHost, isPlatformHost } from './tenant-host.js';

const SKIP_PREFIXES = ['/health', '/ready', '/api/public/health'];

function shouldSkipTenant(url) {
  const path = url.split('?')[0];
  return SKIP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Plugin Fastify: resolve o tenant e anexa em request.store / request.storeId.
 */
async function tenantPlugin(app) {
  app.decorateRequest('store', null);
  app.decorateRequest('storeId', null);
  app.decorateRequest('isPlatform', false);
  app.decorateRequest('isMarketing', false);

  app.addHook('onRequest', async (request, reply) => {
    request.isPlatform = isPlatformHost(request.headers.host);
    request.isMarketing = isApexHost(request.headers.host);
    if (shouldSkipTenant(request.url)) {
      return;
    }

    try {
      const store = await resolveStoreFromRequest(request);
      if (store) {
        request.store = store;
        request.storeId = store.id;
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
    // SSE same-origin resolves the store by Host without a query. Only a
    // permitted dev/controlled transport host can use the route's query opt-in;
    // reserved marketing/platform hosts can never be converted into tenants.
    // Query is transport, not authorization: token scope + membership still apply.
    if (!request.storeId) {
      try {
        const store = await resolveTenantFromQuery(request);
        if (store) {
          request.store = store;
          request.storeId = store.id;
        }
      } catch (err) {
        if (err instanceof AppError) {
          const { statusCode, body } = errorResponse(err);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }

    if (request.storeId && request.session &&
        (request.session.type !== 'store' || request.session.storeId !== request.storeId)) {
      throw new AppError('CONTEXT_FORBIDDEN', 'Sessão incompatível com a loja.', 403);
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
