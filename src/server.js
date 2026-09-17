import 'dotenv/config';
import { buildApp } from './app.js';
import { startJobWorker } from './infrastructure/jobs.js';
import { log } from './infrastructure/logger.js';

const PORT = Number(process.env.PORT) || 3000;

const app = await buildApp({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
});

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  log.info('server.listening', { port: PORT });

  if (process.env.JOBS_WORKER !== 'false') {
    startJobWorker({
      intervalMs: Number(process.env.JOBS_POLL_MS) || 2000,
    });
  }
} catch (err) {
  log.error('server.start_failed', { error: err.message });
  process.exit(1);
}
