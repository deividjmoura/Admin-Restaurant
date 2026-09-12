import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

const app = Fastify({
  logger: {
    level: isProd ? 'info' : 'debug',
  },
});

await app.register(helmet, {
  contentSecurityPolicy: false, // ajustar depois com frontend
});

await app.register(cors, {
  origin: isProd ? false : true, // restringir em produção
  credentials: true,
});

await app.register(cookie, {
  secret: process.env.COOKIE_SECRET || 'dev-cookie-secret-change-me',
});

await app.register(rateLimit, {
  max: 200,
  timeWindow: '1 minute',
});

// Health checks
app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));
app.get('/ready', async () => ({ status: 'ready' }));

// Placeholder — módulos serão registrados aqui
app.get('/', async () => ({
  name: 'Admin-Restaurant',
  version: '0.1.0',
  message: 'SaaS multi-tenant para lanchonetes — em construção',
}));

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server listening on http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
