import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  listPlans,
  getSubscription,
  upsertSubscription,
  setSubscriptionStatus,
  resolveEntitlements,
  BillingError,
} from './billing.repository.js';
import { createSubscriptionIntent, normalizeBillingWebhook } from './gateway.js';
import { AppError, errorResponse } from '../../shared/errors.js';
import { auditRequest } from '../audit/audit-context.js';

function mapBillingError(err) {
  if (!(err instanceof BillingError)) return null;
  const status =
    err.code === 'PLAN_NOT_FOUND' ? 404 : err.code === 'INVALID_STATUS' ? 400 : 400;
  return new AppError(err.code, err.message, status, err.details);
}

function sendError(reply, err) {
  const { statusCode, body } = errorResponse(err);
  return reply.code(statusCode).send(body);
}

const subscribeSchema = z
  .object({
    planCode: z.string().min(2).max(40),
    trialDays: z.number().int().min(0).max(90).optional(),
  })
  .strict();

async function billingRoutes(app) {
  /** Catálogo público de planos (marketing / onboarding). */
  app.get('/api/billing/plans', async () => {
    const plans = await listPlans({ activeOnly: true });
    return { plans };
  });

  /** Assinatura da loja atual. */
  app.get(
    '/api/billing/subscription',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request) => {
      const subscription = await getSubscription(request.storeId);
      const entitlements = await resolveEntitlements(request.storeId);
      return { subscription, entitlements };
    }
  );

  /** Inicia / troca plano (OWNER). Gateway mock ativa na hora. */
  app.post(
    '/api/billing/subscribe',
    {
      preHandler: [
        app.requireTenant,
        app.requireStoreAccess,
        app.requirePermission('store.settings.write'),
      ],
    },
    async (request, reply) => {
      const parsed = subscribeSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return sendError(
          reply,
          new AppError('VALIDATION_ERROR', 'Payload inválido.', 400, {
            issues: parsed.error.issues,
          })
        );
      }

      try {
        const intent = await createSubscriptionIntent({
          planCode: parsed.data.planCode,
          storeId: request.storeId,
          customerEmail: request.user?.email || null,
        });

        const trialDays =
          parsed.data.trialDays !== undefined
            ? parsed.data.trialDays
            : intent.provider === 'mock_billing'
              ? 14
              : 0;

        const subscription = await upsertSubscription(request.storeId, {
          planCode: parsed.data.planCode,
          trialDays,
          provider: intent.provider,
          providerSubscriptionId: intent.providerSubscriptionId,
          metadata: intent.metadata || {},
          status: trialDays > 0 ? 'trial' : 'active',
        });

        await auditRequest(request, {
          action: 'billing.subscribed',
          resource: 'subscription',
          resourceId: subscription?.id,
          metadata: { planCode: parsed.data.planCode, provider: intent.provider },
        });

        return reply.code(201).send({
          subscription,
          checkoutUrl: intent.checkoutUrl,
        });
      } catch (err) {
        const mapped = mapBillingError(err);
        if (mapped) return sendError(reply, mapped);
        throw err;
      }
    }
  );

  /** Webhook do provider de assinatura (público + secret opcional). */
  app.post('/api/billing/webhooks/:provider', async (request, reply) => {
    const provider = String(request.params.provider || '').toLowerCase();
    const secret = process.env[`BILLING_WEBHOOK_SECRET_${provider.toUpperCase()}`];
    if (secret) {
      const hdr = request.headers['x-billing-signature'] || request.headers['x-signature'];
      if (hdr !== secret) {
        return sendError(
          reply,
          new AppError('WEBHOOK_SIGNATURE_INVALID', 'Assinatura inválida.', 401)
        );
      }
    }

    const event = normalizeBillingWebhook(provider, request.body || {});
    if (!event.storeId && !event.providerSubscriptionId) {
      return sendError(
        reply,
        new AppError('WEBHOOK_INVALID', 'storeId ou subscription id obrigatório.', 400)
      );
    }

    // Mock / mapeamento simples de status
    const statusMap = {
      'subscription.activated': 'active',
      'subscription.past_due': 'past_due',
      'subscription.cancelled': 'cancelled',
      'subscription.suspended': 'suspended',
      active: 'active',
      past_due: 'past_due',
      cancelled: 'cancelled',
      suspended: 'suspended',
    };
    const nextStatus = statusMap[event.type] || statusMap[event.status];
    if (nextStatus && event.storeId) {
      await setSubscriptionStatus(event.storeId, nextStatus, {
        metadata: { webhookType: event.type, provider },
      });
    }

    return { ok: true, applied: Boolean(nextStatus) };
  });
}

export default fp(billingRoutes, {
  name: 'billing-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
