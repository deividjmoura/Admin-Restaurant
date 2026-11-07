import fp from 'fastify-plugin';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { verifyHmac } from '../payments/webhook-auth.js';
import {
  listPlans,
  getSubscription,
  upsertSubscription,
  processBillingWebhook,
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

  // The only defined webhook contract is the local mock. A real provider must
  // implement its own authenticated adapter before it can be enabled here.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
      try {
        request.rawBody = body;
        done(null, body.length ? JSON.parse(body.toString('utf8')) : {});
      } catch (err) {
        err.statusCode = 400;
        done(err);
      }
    });

    scope.post('/api/billing/webhooks/:provider', {
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      const provider = String(request.params.provider || '').toLowerCase();
      const secret = provider === 'mock_billing' ? process.env.BILLING_WEBHOOK_SECRET_MOCK_BILLING : null;
      if (!secret || !secret.trim()) {
        return sendError(reply, new AppError('WEBHOOK_PROVIDER_UNKNOWN', 'Provider não habilitado.', 404));
      }
      const signature = request.headers['x-billing-signature'] || request.headers['x-signature'];
      if (!verifyHmac(request.rawBody, signature, secret)) {
        return sendError(reply, new AppError('WEBHOOK_SIGNATURE_INVALID', 'Assinatura inválida.', 401));
      }

      const event = normalizeBillingWebhook(provider, request.body || {});
      const validId = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 255;
      if (!validId(event.externalEventId) || !validId(event.providerSubscriptionId) ||
          (event.storeId != null && !validId(event.storeId))) {
        return sendError(reply, new AppError('WEBHOOK_INVALID', 'ID do evento e referência da assinatura são obrigatórios.', 400));
      }
      const statusMap = {
        'subscription.activated': 'active', 'subscription.past_due': 'past_due',
        'subscription.cancelled': 'cancelled', 'subscription.suspended': 'suspended',
        active: 'active', past_due: 'past_due', cancelled: 'cancelled', suspended: 'suspended',
      };
      // Only an explicitly supported event type can change state; no arbitrary
      // body status fallback for unknown event types.
      const nextStatus = Object.hasOwn(statusMap, event.type) ? statusMap[event.type] : null;
      if (!nextStatus) return sendError(reply, new AppError('WEBHOOK_INVALID', 'Tipo de evento não suportado.', 400));

      try {
        const result = await processBillingWebhook({
          provider, externalEventId: event.externalEventId,
          providerSubscriptionId: event.providerSubscriptionId, bodyStoreId: event.storeId,
          status: nextStatus, payloadHash: createHash('sha256').update(request.rawBody).digest('hex'),
        });
        if (result.applied) await auditRequest(request, {
          action: 'billing.webhook_applied', storeId: result.storeId,
          resource: 'subscription', resourceId: result.subscriptionId,
          metadata: { provider, eventType: event.type },
        });
        return { ok: true, applied: result.applied, duplicate: result.duplicate };
      } catch (err) {
        if (err instanceof BillingError) {
          const code = err.code === 'SUBSCRIPTION_NOT_FOUND' ? 404 : 409;
          return sendError(reply, new AppError(err.code, err.message, code));
        }
        throw err;
      }
    });
  });

}

export default fp(billingRoutes, {
  name: 'billing-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
