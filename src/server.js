import 'dotenv/config';
import { buildApp } from './app.js';

const PORT = Number(process.env.PORT) || 3000;

const app = await buildApp({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
});

// T9 (issue #52): inicia a fila de jobs (impressão/notificações)
// desacoplada do request path; encerra junto com o app (hook onClose).
const { initWorkers } = await import('./workers/index.js');
await initWorkers(app);

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server listening on http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
