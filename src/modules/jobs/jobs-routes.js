import fp from 'fastify-plugin';
import { z } from 'zod';
import { enqueueJob, listJobs, countByStatus } from './jobs.repository.js';
import { getWorkerStatus } from './worker.js';
import { AppError, errorResponse } from '../../shared/errors.js';

const enqueueSchema = z
  .object({
    type: z.string().min(2).max(64),
    payload: z.record(z.unknown()).optional(),
    queue: z.string().min(1).max(40).optional(),
    idempotencyKey: z.string().min(4).max(128).optional().nullable(),
  })
  .strict();

async function jobsRoutes(app) {
  app.get(
    '/api/jobs',
    {
      preHandler: [
        app.requireTenant,
        app.requireStoreAccess,
        app.requirePermission('store.settings.read'),
      ],
    },
    async (request) => {
      const jobs = await listJobs(request.storeId, {
        status: request.query?.status || null,
        limit: request.query?.limit || 50,
      });
      return { jobs };
    }
  );

  app.get(
    '/api/jobs/stats',
    {
      preHandler: [
        app.requireTenant,
        app.requireStoreAccess,
        app.requirePermission('store.settings.read'),
      ],
    },
    async () => {
      const counts = await countByStatus();
      return { counts, worker: getWorkerStatus() };
    }
  );

  app.post(
    '/api/jobs',
    {
      preHandler: [
        app.requireTenant,
        app.requireStoreAccess,
        app.requirePermission('store.settings.write'),
      ],
    },
    async (request, reply) => {
      const parsed = enqueueSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const { statusCode, body } = errorResponse(
          new AppError('VALIDATION_ERROR', 'Payload inválido.', 400)
        );
        return reply.code(statusCode).send(body);
      }
      const headerKey = request.headers['idempotency-key'];
      const idempotencyKey =
        (typeof headerKey === 'string' && headerKey.trim()) ||
        parsed.data.idempotencyKey ||
        null;

      const result = await enqueueJob({
        storeId: request.storeId,
        type: parsed.data.type,
        payload: parsed.data.payload || {},
        queue: parsed.data.queue || 'default',
        idempotencyKey,
      });

      return reply.code(result.replayed ? 200 : 201).send(result);
    }
  );
}

export default fp(jobsRoutes, {
  name: 'jobs-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
