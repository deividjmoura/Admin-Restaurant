/**
 * Factory da aplicação Fastify (sem listen).
 * Usado por server.js e pelos testes de isolamento.
 */
import Fastify from 'fastify';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fastifyStatic from '@fastify/static';
import customerPlugin from './modules/customer/customer-plugin.js';
import { isAllowedOrigin } from './shared/origin-policy.js';
import platformRoutes from './modules/platform/platform-routes.js';
import marketingRoutes from './modules/marketing/marketing-routes.js';
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
import { AppError, errorResponse } from './shared/errors.js';

/**
 * Tratamento global de erros.
 *
 * PRECISA ser registrado ANTES das rotas: o Fastify resolve o error handler no
 * contexto em que a rota foi registrada, então um `setErrorHandler` chamado
 * depois de `app.register(...)` não se aplica a elas (o 500 padrão vazava
 * stack/erro de banco).
 */
function registerErrorHandling(app, spaEnabled = false) {
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
    request.log?.error({ err }, 'unhandled error');

    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno do servidor.',
      },
    });
  });

  if (spaEnabled) {
    // SPA fallback: tudo que não é /api, /health ou /ready devolve index.html.
    app.setNotFoundHandler((request, reply) => {
      const url = (request.url || '').split('?')[0];
      if (url.startsWith('/api') || url === '/health' || url === '/ready') {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' },
        });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((request, reply) => {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' },
      });
    });
  }
}

/**
 * @param {{ logger?: boolean | object }} [opts]
 */
export async function buildApp(opts = {}) {
  const isProd = process.env.NODE_ENV === 'production';

  const redactRequest = (req) => ({
    method: req.method,
    url: req.url
      ?.replace(/(\/api\/tables\/by-token\/)[^?]+/, '$1[redacted]')
      .split('?')[0],
    hostname: req.hostname,
    remoteAddress: req.ip,
  });
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: isProd ? 'info' : 'warn',
            ...(typeof opts.logger === 'object' ? opts.logger : {}),
            serializers: { req: redactRequest },
            redact: ['req.headers.authorization', 'req.headers.cookie'],
          },
    // Sem trustProxy o rate limit usa o IP do proxy em produção (todos os
    // clientes viram um só). Configure TRUST_PROXY=1 atrás de um proxy confiável.
    trustProxy: process.env.TRUST_PROXY
      ? Number(process.env.TRUST_PROXY)
      : false,
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

  if (
    isProd &&
    (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
  ) {
    throw new Error(
      'JWT_SECRET é obrigatório em produção (mínimo 32 caracteres).'
    );
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

  // SPA: quando o build do frontend (`frontend/dist`) existe, servimos os
  // assets estáticos e fazemos SPA fallback. Isso permite um deploy de
  // ORIGEM ÚNICA (ex.: um serviço Render) onde SPA e API dividem o mesmo host
  // — necessário para a resolução de tenant por Host e para cookies same-origin.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const spaDir = path.join(__dirname, '..', 'frontend', 'dist');
  const spaEnabled = fs.existsSync(spaDir);
  if (spaEnabled) {
    await app.register(fastifyStatic, {
      root: spaDir,
      prefix: '/',
      wildcard: false,
    });
  }

  // Erros antes das rotas: ver comentário em registerErrorHandling().
  registerErrorHandling(app, spaEnabled);
  // CORS alone does not prevent simple-form CSRF. Reject disallowed browser
  // origins before resolving stores or executing state-changing handlers.
  app.addHook('onRequest', async (request) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      !isAllowedOrigin(request, request.headers.origin)
    ) {
      throw new AppError('ORIGIN_FORBIDDEN', 'Origem não autorizada.', 403);
    }
  });

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

  app.get('/health', async () => ({
    status: 'ok',
    ts: new Date().toISOString(),
  }));

  app.get('/ready', async (_request, reply) => {
    try {
      const { pool } = await import('./infrastructure/db.js');
      const r = await pool.query('SELECT 1 AS ok');
      if (!r.rows[0]) {
        return reply.code(503).send({ status: 'not_ready', db: false });
      }
      return { status: 'ready', db: true, ts: new Date().toISOString() };
    } catch (err) {
      return reply.code(503).send({
        status: 'not_ready',
        db: false,
        error:
          process.env.NODE_ENV === 'production'
            ? 'db_unavailable'
            : String(err.message),
      });
    }
  });

  // The frontend/proxy serves the SPA at /. API root never exposes identity/tenant.
  // Quando o SPA está habilitado, @fastify/static já serve `/` e os assets; o
  // SPA fallback (rotas não-API) é tratado no notFoundHandler.
  if (!spaEnabled) {
    app.get('/', async () => ({ name: 'Admin-Restaurant', version: '0.1.0' }));
  }

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
