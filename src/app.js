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
import tablesRoutes from './modules/tables/tables-routes.js';
import ordersRoutes from './modules/orders/orders-routes.js';
import kitchenRoutes from './modules/kitchen/kitchen-routes.js';
import cartRoutes from './modules/tables/cart-routes.js';
import deliveryRoutes from './modules/delivery/delivery-routes.js';
import paymentsRoutes from './modules/payments/payments-routes.js';
import reportsRoutes from './modules/reports/reports-routes.js';

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

  await app.register(cors, {
    origin: isProd ? false : true,
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
  await app.register(tablesRoutes);
  await app.register(ordersRoutes);
  await app.register(kitchenRoutes);
  await app.register(cartRoutes);
  await app.register(deliveryRoutes);
  await app.register(paymentsRoutes);
  await app.register(reportsRoutes);

  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));
  app.get('/ready', async () => ({ status: 'ready' }));

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
