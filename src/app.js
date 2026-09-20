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
import { AppError, errorResponse } from './shared/errors.js';

/**
 * @param {{ logger?: boolean | object }} [opts]
 */
export async function buildApp(opts = {}) {
  const isProd = process.env.NODE_ENV === 'production';

  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : opts.logger ?? {
            level: isProd ? 'info' : 'warn',
          },
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // CORS: credentials needs explicit Origin or reflection.
  // When CORS_ORIGIN / FRONTEND_ORIGIN is unset in production, reflect request
  // Origin so SPA login cookies work. Prefer setting the env in real deploys.
  const corsOriginEnv = process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN;
  let corsOrigin;
  if (corsOriginEnv) {
    corsOrigin = corsOriginEnv.split(',').map((s) => s.trim()).filter(Boolean);
  } else if (isProd) {
    if (!globalThis.__corsOriginWarned) {
      console.warn(
        '[cors] CORS_ORIGIN / FRONTEND_ORIGIN not set. Reflecting request Origin. Set the env to your frontend URL(s) for production.'
      );
      globalThis.__corsOriginWarned = true;
    }
    corsOrigin = true;
  } else {
    corsOrigin = true;
  }

  await app.register(cors, {
    origin: corsOrigin,
    credentials: true,
  });

  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET || 'dev-cookie-secret-change-me',
  });

  await app.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
  });

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

  // GOLDEN_RULES: never leak 500 on malformed UUID / invalid input syntax
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
    request.log?.error({ err }, 'unhandled error');
    const { statusCode, body } = errorResponse(err);
    return reply.code(statusCode).send(body);
  });

  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

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
        error: process.env.NODE_ENV === 'production' ? 'db_unavailable' : String(err.message),
      });
    }
  });

  app.get('/', async (request) => ({
    name: 'Admin-Restaurant',
    version: '0.1.0',
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
