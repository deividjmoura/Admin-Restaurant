import fp from 'fastify-plugin';
import { resolveStoreFromRequest, resolveTenantFromQuery } from './resolve-tenant.js';
import { errorResponse, AppError } from '../../shared/errors.js';
import { isApexHost, isPlatformHost } from './tenant-host.js';
import { bindRequestLog } from '../../infrastructure/request-context.js';

const SKIP_PREFIXES = ['/health', '/ready', '/metrics', '/api/public/health'];

function shouldSkipTenant(url) {
  const path = url.split('?')[0];
  return SKIP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

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
  app.decorateRequest('isPlatform', false);
  app.decorateRequest('isMarketing', false);
  app.decorateRequest('tenantSource', null);

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
        request.tenantSource = resolveTenantSource(request, store);
        try {
          bindRequestLog(request, {
            storeId: store.id,
            storeSlug: store.slug,
            tenantSource: request.tenantSource,
          });
        } catch {}
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
    if (!request.storeId) {
      try {
        const store = await resolveTenantFromQuery(request);
        if (store) {
          request.store = store;
          request.storeId = store.id;
          request.tenantSource = 'query';
          try {
            bindRequestLog(request, {
              storeId: store.id,
              storeSlug: store.slug,
              tenantSource: 'query',
            });
          } catch {}
        }
      } catch (err) {
        if (err instanceof AppError) {
          const { statusCode, body } = errorResponse(err);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }

    if (
      request.storeId &&
      request.session &&
      request.session.type !== 'store' &&
      request.session.type !== 'platform'
    ) {
      // Customer sessions are allowed but don't satisfy requireTenant for staff routes
      // Staff check is done in requireStoreAccess; here we only check context mismatch for store type
      if (request.session.type === 'store' && request.session.storeId !== request.storeId) {
        throw new AppError('CONTEXT_FORBIDDEN', 'Sessão incompatível com a loja.', 403);
      }
    }

    if (request.storeId && request.session && request.session.type === 'store' && request.session.storeId !== request.storeId) {
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
