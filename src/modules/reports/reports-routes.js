import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  getDashboardSummary,
  getTopProducts,
  getDailySeries,
  getAveragePrepMinutes,
  getLiveOps,
} from './reports.repository.js';
import { AppError, errorResponse } from '../../shared/errors.js';

const periodQuery = z.object({
  preset: z
    .enum(['today', 'yesterday', 'week', 'month', 'custom'])
    .optional()
    .default('today'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

function parsePeriod(query) {
  const parsed = periodQuery.safeParse(query ?? {});
  if (!parsed.success) {
    return {
      error: new AppError('VALIDATION_ERROR', 'Parâmetros de período inválidos.', 400, {
        issues: parsed.error.issues,
      }),
    };
  }
  const { preset, from, to, limit } = parsed.data;
  if (preset === 'custom' && (!from || !to)) {
    return {
      error: new AppError(
        'VALIDATION_ERROR',
        'preset=custom exige from e to (ISO 8601).',
        400
      ),
    };
  }
  return { period: { preset, from, to }, limit };
}

async function reportsRoutes(app) {
  /**
   * Dashboard completo do dono.
   * GET /api/reports/dashboard?preset=today|yesterday|week|month|custom&from=&to=
   */
  app.get(
    '/api/reports/dashboard',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request, reply) => {
      const { period, error } = parsePeriod(request.query);
      if (error) {
        const { statusCode, body } = errorResponse(error);
        return reply.code(statusCode).send(body);
      }

      const [summary, topProducts, series, prep, live] = await Promise.all([
        getDashboardSummary(request.storeId, period),
        getTopProducts(request.storeId, period, { limit: 10 }),
        getDailySeries(request.storeId, period),
        getAveragePrepMinutes(request.storeId, period),
        getLiveOps(request.storeId),
      ]);

      return {
        storeId: request.storeId,
        summary,
        topProducts,
        dailySeries: series,
        prep,
        live,
      };
    }
  );

  /** Só resumo */
  app.get(
    '/api/reports/summary',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request, reply) => {
      const { period, error } = parsePeriod(request.query);
      if (error) {
        const { statusCode, body } = errorResponse(error);
        return reply.code(statusCode).send(body);
      }
      const summary = await getDashboardSummary(request.storeId, period);
      return { storeId: request.storeId, summary };
    }
  );

  /** Top produtos */
  app.get(
    '/api/reports/top-products',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request, reply) => {
      const { period, limit, error } = parsePeriod(request.query);
      if (error) {
        const { statusCode, body } = errorResponse(error);
        return reply.code(statusCode).send(body);
      }
      const products = await getTopProducts(request.storeId, period, {
        limit: limit || 10,
      });
      return { storeId: request.storeId, products };
    }
  );

  /** Operação ao vivo */
  app.get(
    '/api/reports/live',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request) => {
      const live = await getLiveOps(request.storeId);
      return { storeId: request.storeId, live };
    }
  );
}

export default fp(reportsRoutes, {
  name: 'reports-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
