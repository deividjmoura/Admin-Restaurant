import 'dotenv/config';
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

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

const app = Fastify({
  logger: {
    level: isProd ? 'info' : 'debug',
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
  max: 200,
  timeWindow: '1 minute',
});

await app.register(tenantPlugin);
await app.register(authPlugin);
await app.register(menuRoutes);
await app.register(tablesRoutes);
await app.register(ordersRoutes);
await app.register(kitchenRoutes);

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
  {
    preHandler: [app.requireTenant],
  },
  async (request) => ({
    store: {
      id: request.store.id,
      slug: request.store.slug,
      name: request.store.name,
      status: request.store.status,
    },
  })
);

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server listening on http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
