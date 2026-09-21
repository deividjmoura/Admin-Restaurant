/**
 * Factory da aplicação Fastify (sem listen).
 * Usado por server.js e pelos testes de isolamento.
 *
 * Merge de main (entry-contexts + customer sessions + delivery checkout) +
 * PR #152 (observabilidade + caixa físico).
 */
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import customerPlugin from './modules/customer/customer-plugin.js';
import { isAllowedOrigin } from './shared/origin-policy.js';
import platformRoutes from './modules/platform/platform-routes.js';
import marketingRoutes from './modules/marketing/marketing-routes.js';
import tenantPlugin from './modules/tenancy/tenant-plugin.js';
import authPlugin from './modules/auth/auth-plugin.js';
import menuRoutes from './modules/menu/menu-routes.js';
import menuAdminRoutes from './modules/menu/menu-admin-routes.js';
import tablesRoutes from './modules/tables/tables-routes.js';
import ordersRoutes from './modules/orders/orders-routes.js';
import kitchenRoutes from './modules/kitchen/kitchen-routes.js';
import cartRoutes from './modules/tables/cart-routes.js';
import deliveryRoutes from './modules/delivery/delivery-routes.js';
import paymentsRoutes from './modules/payments/payments-routes.js';
import reportsRoutes from './modules/reports/reports-routes.js';
import storeRoutes from './modules/tenancy/store-routes.js';
import permissionsRoutes from './modules/permissions/permissions-routes.js';
import crmRoutes from './modules/crm/crm-routes.js';
import auditRoutes from './modules/audit/audit-routes.js';
import cashRoutes from './modules/cash/cash-routes.js';
import opsRoutes from './modules/ops/ops-routes.js';
import requestContext, { sanitizeRequestId } from './infrastructure/request-context.js';
import { buildLoggerOptions, SERVICE_NAME, SERVICE_VERSION } from './infrastructure/logger.js';
import { startEventLoopSampler, stopEventLoopSampler, observeAppError } from './infrastructure/metrics.js';
import { AppError, errorResponse } from './shared/errors.js';

/**
 * Tratamento global de erros.
 * PRECISA ser registrado ANTES das rotas.
 */
function registerErrorHandling(app) {
  app.setErrorHandler((err, request, reply) => {
    if (err?.code === '22P02') {
      return reply.code(400).send({
        error: {
          code: 'INVALID_ID',
          message: 'Identificador inválido.',
        },
      });
    }

    if (err instanceof AppError) {
      const { statusCode, body } = errorResponse(err);
      observeAppError({
        code: err.code,
        route: request.routeOptions?.url || request.url?.split('?')[0] || 'unmatched',
        status: statusCode,
        storeId: request.storeId || null,
      });
      return reply.code(statusCode).send(body);
    }

    if (err?.statusCode && err.statusCode < 500) {
      const status = err.statusCode;
      const message =
        status === 404
          ? 'Rota não encontrada.'
          : status === 429
            ? 'Muitas requisições.'
            : status === 415
              ? 'Content-Type não suportado.'
              : status === 413
                ? 'Payload muito grande.'
                : 'Requisição inválida.';
      const codeByStatus = {
        400: 'BAD_REQUEST',
        404: 'NOT_FOUND',
        413: 'PAYLOAD_TOO_LARGE',
        415: 'UNSUPPORTED_CONTENT_TYPE',
        429: 'RATE_LIMITED',
      };
      const code = codeByStatus[status] || 'BAD_REQUEST';
      return reply.code(status).send({ error: { code, message } });
    }

    observeAppError({
      code: 'INTERNAL_ERROR',
      route: request.routeOptions?.url || request.url?.split('?')[0] || 'unmatched',
      status: 500,
      storeId: request.storeId || null,
    });
    request.log?.error({ err, event: 'http.error', status: 500 }, 'unhandled error');

    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno do servidor.',
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Rota não encontrada.',
      },
    });
  });
}

export function resolveLoggerConfig(opts = {}) {
  const isProd = process.env.NODE_ENV === 'production';

  if (opts.logger === false) return { logger: false };

  if (opts.loggerInstance) {
    return { loggerInstance: opts.loggerInstance };
  }

  if (opts.logger && typeof opts.logger === 'object') {
    const alreadyConfigured = opts.logger.formatters || opts.logger.redact || opts.logger.base;
    return {
      logger: alreadyConfigured
        ? opts.logger
        : buildLoggerOptions({
            level: opts.logger.level || (isProd ? 'info' : 'debug'),
          }),
    };
  }

  return { logger: buildLoggerOptions({ level: isProd ? 'info' : 'debug' }) };
}

function resolveRequestLoggingOption() {
  const LogController = Fastify.LogController;
  if (typeof LogController === 'function') {
    return {
      logController: new LogController({
        disableRequestLogging: true,
        requestIdLogLabel: 'requestId',
      }),
    };
  }
  return { disableRequestLogging: true, requestIdLogLabel: 'requestId' };
}

function requestIdGenerator(rawRequest) {
  return sanitizeRequestId(rawRequest?.headers?.['x-request-id']) || randomUUID();
}

/**
 * @param {{ logger?: boolean | object, loggerInstance?: object }} [opts]
 */
export async function buildApp(opts = {}) {
  const isProd = process.env.NODE_ENV === 'production';

  const app = Fastify({
    ...resolveLoggerConfig(opts),
    ...resolveRequestLoggingOption(),
    genReqId: requestIdGenerator,
    trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : false,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  const origins = (process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (isProd && origins.length === 0) {
    throw new Error(
      'CORS_ORIGIN é obrigatório em produção (lista de origens separada por vírgula).'
    );
  }

  if (isProd && !process.env.COOKIE_SECRET) {
    throw new Error('COOKIE_SECRET é obrigatório em produção.');
  }

  if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
    throw new Error('JWT_SECRET é obrigatório em produção (mínimo 32 caracteres).');
  }

  await app.register(cors, {
    delegator: (request, cb) =>
      cb(null, {
        origin: isAllowedOrigin(request, request.headers.origin)
          ? request.headers.origin || false
          : false,
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
          'Content-Type',
          'X-Tenant-Slug',
          'Idempotency-Key',
          'X-Signature',
          'Authorization',
        ],
      }),
  });

  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET || 'dev-cookie-secret-change-me',
  });

  await app.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
  });

  registerErrorHandling(app);

  app.addHook('onRequest', async (request) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      !isAllowedOrigin(request, request.headers.origin)
    ) {
      throw new AppError('ORIGIN_FORBIDDEN', 'Origem não autorizada.', 403);
    }
  });

  await app.register(requestContext);
  await app.register(tenantPlugin);
  await app.register(authPlugin);
  await app.register(customerPlugin);
  await app.register(platformRoutes);
  await app.register(marketingRoutes);
  await app.register(menuRoutes);
  await app.register(menuAdminRoutes);
  await app.register(tablesRoutes);
  await app.register(ordersRoutes);
  await app.register(kitchenRoutes);
  await app.register(cartRoutes);
  await app.register(deliveryRoutes);
  await app.register(paymentsRoutes);
  await app.register(reportsRoutes);
  await app.register(storeRoutes);
  await app.register(permissionsRoutes);
  await app.register(crmRoutes);
  await app.register(auditRoutes);
  await app.register(cashRoutes);
  await app.register(opsRoutes);

  startEventLoopSampler();
  app.addHook('onClose', async () => {
    stopEventLoopSampler();
  });

  app.get('/', async () => ({ name: 'Admin-Restaurant', version: '0.1.0' }));

  app.get(
    '/api/me/store',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request) => ({
      store: {
        id: request.store.id,
        slug: request.store.slug,
        name: request.store.name,
        status: request.store.status,
      },
    })
  );

  return app;
}
