/**
 * Factory da aplicação Fastify (sem listen).
 * Usado por server.js e pelos testes de isolamento.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
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
import opsRoutes from './modules/ops/ops-routes.js';
import requestContext, { sanitizeRequestId } from './infrastructure/request-context.js';
import { buildLoggerOptions, SERVICE_NAME, SERVICE_VERSION } from './infrastructure/logger.js';
import { startEventLoopSampler, stopEventLoopSampler, observeAppError } from './infrastructure/metrics.js';
import { randomUUID } from 'node:crypto';
import { AppError, errorResponse } from './shared/errors.js';

/**
 * Tratamento global de erros.
 *
 * PRECISA ser registrado ANTES das rotas: o Fastify resolve o error handler no
 * contexto em que a rota foi registrada, então um `setErrorHandler` chamado
 * depois de `app.register(...)` não se aplica a elas (o 500 padrão vazava
 * stack/erro de banco).
 */
function registerErrorHandling(app) {
  // GOLDEN_RULES: nunca vazar 500 em UUID malformado / erro de cliente.
  // Erros do próprio Fastify (400/415/429) preservam o status original.
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
      // Códigos estáveis para o cliente: nunca expor códigos internos do
      // runtime (FST_ERR_*) nem detalhes de banco.
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

    // 5xx: loga com stack trace no servidor e responde genérico (sem stack).
    observeAppError({
      code: 'INTERNAL_ERROR',
      route: request.routeOptions?.url || request.url?.split('?')[0] || 'unmatched',
      status: 500,
      storeId: request.storeId || null,
    });
    request.log?.error(
      { err, event: 'http.error', status: 500 },
      'unhandled error'
    );

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

/**
 * Resolve a opção de logger do Fastify preservando o padrão estruturado
 * (issue #106): `{ level }` simples ganha formatters/redact/base; opções pino
 * completas (com `formatters`) ou uma instância (`loggerInstance`) passam direto.
 *
 * @param {{ logger?: boolean | object, loggerInstance?: object }} opts
 */
export function resolveLoggerConfig(opts = {}) {
  const isProd = process.env.NODE_ENV === 'production';

  if (opts.logger === false) return { logger: false };

  if (opts.loggerInstance) {
    // Instância pronta (ex.: logger em memória nos testes de observabilidade).
    return { loggerInstance: opts.loggerInstance };
  }

  if (opts.logger && typeof opts.logger === 'object') {
    const alreadyConfigured =
      opts.logger.formatters || opts.logger.redact || opts.logger.base;
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

/**
 * O access log é nosso (onResponse em request-context.js, com route pattern,
 * statusClass, storeId, userId e durationMs) — o log por requisição do Fastify
 * fica desligado para não duplicar linha.
 *
 * `logController` é a API do Fastify ≥ 5.12; `disableRequestLogging` é o
 * fallback para versões anteriores (o pacote declara `^5.2.1`).
 */
function resolveRequestLoggingOption() {
  // `requestIdLogLabel: 'requestId'`: o binding automático do Fastify já sai com
  // o nome que o playbook de observabilidade documenta (nada de `reqId` + `requestId`).
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

/**
 * Id de correlação da requisição: `x-request-id` do proxy quando válido, UUID
 * caso contrário. Validar aqui (e não só no hook) impede que um cabeçalho
 * forjado entre em log — log injection é vetor real em observabilidade.
 */
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
    // Sem trustProxy o rate limit usa o IP do proxy em produção (todos os
    // clientes viram um só). Configure TRUST_PROXY=1 atrás de um proxy confiável.
    trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : false,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // CORS fail-closed: em produção a lista de origens é obrigatória e NUNCA
  // refletimos o Origin do request (com credentials:true isso seria um
  // open redirect de sessão).
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

  await app.register(cors, {
    origin: isProd ? origins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'X-Tenant-Slug',
      'Idempotency-Key',
      'X-Signature',
    ],
  });

  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET || 'dev-cookie-secret-change-me',
  });

  await app.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
  });

  // Erros antes das rotas: ver comentário em registerErrorHandling().
  registerErrorHandling(app);

  await app.register(requestContext);
  await app.register(tenantPlugin);
  await app.register(authPlugin);
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
  // /health, /ready e /metrics (issue #106) vivem num módulo só.
  await app.register(opsRoutes);

  startEventLoopSampler();
  app.addHook('onClose', async () => {
    stopEventLoopSampler();
  });

  app.get('/', async (request) => ({
    name: SERVICE_NAME,
    version: SERVICE_VERSION,
    message: 'SaaS multi-tenant para lanchonetes — em construção',
    tenant: request.store
      ? { id: request.store.id, slug: request.store.slug, name: request.store.name }
      : null,
    user: request.user
      ? { id: request.user.id, email: request.user.email, isSuperAdmin: request.user.isSuperAdmin }
      : null,
  }));

  app.get(
    '/api/me/store',
    { preHandler: [app.requireTenant] },
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
