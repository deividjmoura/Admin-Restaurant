import fp from 'fastify-plugin';
import { z } from 'zod';
import { AppError, errorResponse } from '../../shared/errors.js';
import { listPlans, getSubscription, upsertSubscription, checkLimits } from './billing.repository.js';

const subscribeSchema = z.object({
  planId: z.enum(['basic', 'pro', 'enterprise']),
});

async function billingRoutes(app) {
  // Público: listar planos
  app.get('/api/billing/plans', async () => {
    const plans = await listPlans();
    return { plans };
  });

  // Tenant: ver assinatura
  app.get(
    '/api/billing/subscription',
    { preHandler: [app.requireTenant] },
    async (request) => {
      const sub = await getSubscription(request.storeId);
      const limits = await checkLimits(request.storeId);
      return { storeId: request.storeId, subscription: sub, limits };
    }
  );

  // Admin: assinar/alterar plano
  app.post(
    '/api/billing/subscription',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request, reply) => {
      const parsed = subscribeSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Plano inválido.', 400);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      const sub = await upsertSubscription(request.storeId, { planId: parsed.data.planId });
      return { subscription: sub };
    }
  );

  // Check limites
  app.get(
    '/api/billing/limits',
    { preHandler: [app.requireTenant] },
    async (request) => {
      const result = await checkLimits(request.storeId);
      return result;
    }
  );
}

export default fp(billingRoutes, {
  name: 'billing-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
