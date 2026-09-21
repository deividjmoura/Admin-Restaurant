import 'dotenv/config';
import { buildApp } from './app.js';
import { getAppLogger, logLevel } from './infrastructure/logger.js';
import { startWorker, stopWorker } from './modules/jobs/worker.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = await buildApp({
  logger: {
    level: process.env.LOG_LEVEL || logLevel(),
  },
});

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(
    { event: 'server.listening', port: PORT, bindHost: HOST },
    `Server listening on http://${HOST}:${PORT}`
  );
  startWorker();
  app.log.info({ event: 'job.worker_started' }, 'job worker started');
} catch (err) {
  app.log.error({ err, event: 'server.listen_failed' });
  process.exit(1);
}

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const log = getAppLogger();
  log.info({ event: 'server.shutdown_started', signal }, 'shutting down');

  const forceExit = setTimeout(() => {
    log.error({ event: 'server.shutdown_timeout' }, 'shutdown timed out — exiting');
    process.exit(1);
  }, Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000);
  forceExit.unref?.();

  try {
    stopWorker();
    await app.close();
    const { pool } = await import('./infrastructure/db.js');
    await pool.end();
    clearTimeout(forceExit);
    log.info({ event: 'server.shutdown_complete', signal }, 'shutdown complete');
    process.exit(0);
  } catch (err) {
    log.error({ err, event: 'server.shutdown_failed' });
    process.exit(1);
  }
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => shutdown(signal));
}

process.on('unhandledRejection', (reason) => {
  getAppLogger().error({ err: reason, event: 'process.unhandled_rejection' });
});

process.on('uncaughtException', (err) => {
  getAppLogger().fatal({ err, event: 'process.uncaught_exception' });
  shutdown('uncaughtException');
});
