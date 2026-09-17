/**
 * Factory da aplicação Fastify (sem listen).
 * Usado por server.js e pelos testes de isolamento.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import couponsRoutes from './modules/coupons/coupons-routes.js';
import reportsRoutes from './modules/reports/reports-routes.js';
import storeRoutes from './modules/tenancy/store-routes.js';
import signupRoutes from './modules/onboarding/signup-routes.js';

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

  // CORS: credentials:true requires an explicit Origin (or reflection).
  // When CORS_ORIGIN / FRONTEND_ORIGIN is unset in production the previous
  // fallback (`false`) blocked the browser from reading the login response
  // and from storing the httpOnly session cookie — login appeared broken.
  // Reflection (`true`) is safe for SameSite=None cookies and restores login.
  // Prefer setting CORS_ORIGIN to the exact frontend origin(s) in production.
  const corsOriginEnv = process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN;
  let corsOrigin;
  if (corsOriginEnv) {
    corsOrigin = corsOriginEnv.split(',').map((s) => s.trim()).filter(Boolean);
  } else if (isProd) {
    // Reflect request Origin so credentialed requests work until env is set.
    // Log once so the operator knows to configure it properly.
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
  await app.register(couponsRoutes);
  await app.register(reportsRoutes);
  await app.register(storeRoutes);
  await app.register(signupRoutes);

  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  app.get('/ready', async (_request, reply) => {
    try {
      const { pool } = await import('./infrastructure/db.js');
      const { getJobQueueMetrics } = await import('./workers/job-queue.js');
      const r = await pool.query('SELECT 1 AS ok');
      if (!r.rows[0]) {
        return reply.code(503).send({ status: 'not_ready', db: false });
      }
      // T9 (issue #52): readiness com check de DB + métricas básicas da fila.
      return {
        status: 'ready',
        db: true,
        jobs: getJobQueueMetrics(),
        ts: new Date().toISOString(),
      };
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

  // API serve o front em produção (docs/DEPLOY.md): frontend/dist como SPA
  // Em dev o Vite faz proxy de /api; em prod o mesmo origin serve tudo com caminhos relativos.
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const distPath = path.resolve(__dirname, '../frontend/dist');
    if (fs.existsSync(distPath) && fs.existsSync(path.join(distPath, 'index.html'))) {
      const fastifyStatic = (await import('@fastify/static')).default;
      await app.register(fastifyStatic, {
        root: distPath,
        prefix: '/',
        wildcard: false,
        decorateReply: false,
      });
      // Fallback SPA: qualquer GET não-API que não casou com arquivo → index.html
      app.setNotFoundHandler(async (request, reply) => {
        const url = request.url.split('?')[0];
        if (url.startsWith('/api/') || url === '/health' || url === '/ready' || url.startsWith('/api/me')) {
          return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } });
        }
        // Se for GET e aceitar html, serve SPA
        if (request.method === 'GET' && request.headers.accept?.includes('text/html')) {
          return reply.sendFile('index.html');
        }
        // Outros métodos ou assets não encontrados
        if (request.method === 'GET' && url.includes('.')) {
          return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Asset não encontrado.' } });
        }
        // SPA fallback genérico para rotas do front (/m/:token, /kitchen, /admin/*, etc.)
        if (request.method === 'GET') {
          return reply.sendFile('index.html');
        }
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } });
      });
    }
  } catch (err) {
    // Não falha o boot se o front ainda não foi buildado (ex.: CI sem build)
    app.log.warn({ err: err.message }, 'frontend static not served');
  }

  return app;
}
