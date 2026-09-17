import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  createPayment,
  confirmPayment,
  findPaymentById,
  listPayments,
  processWebhookEvent,
  getPixConfigForStore,
  PaymentError,
} from './payments.repository.js';
import {
  verifyMercadoPagoWebhook,
  normalizeMercadoPagoWebhook,
  getMercadoPagoPayment,
} from './providers/mercadopago.js';
import { publishStoreOrderEvent } from '../realtime/store-events.js';
import { AppError, errorResponse } from '../../shared/errors.js';

const createSchema = z.object({
  amount: z.number().positive().max(1_000_000),
  method: z.enum(['PIX', 'CASH', 'CARD', 'OTHER']).default('PIX'),
  orderId: z.string().uuid().optional().nullable(),
  sessionId: z.string().uuid().optional().nullable(),
  idempotencyKey: z.string().min(8).max(128).optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

function mapPaymentError(err) {
  if (!(err instanceof PaymentError)) return null;
  const status =
    err.code === 'PIX_NOT_CONFIGURED' || err.code === 'MP_NOT_CONFIGURED'
      ? 503
      : err.code === 'INVALID_STATUS'
        ? 409
        : err.code === 'MP_CREATE_FAILED'
          ? 502
          : 400;
  return new AppError(err.code, err.message, status);
}

async function paymentsRoutes(app) {
  app.get(
    '/api/payments/pix-config',
    { preHandler: [app.requireTenant] },
    async (request) => {
      const config = await getPixConfigForStore(request.storeId);
      return { storeId: request.storeId, pix: config };
    }
  );

  app.post(
    '/api/payments',
    { preHandler: [app.requireTenant] },
    async (request, reply) => {
      const parsed = createSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400, {
          issues: parsed.error.issues,
        });
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }

      const headerKey = request.headers['idempotency-key'];
      const idempotencyKey =
        (typeof headerKey === 'string' && headerKey.trim()) ||
        parsed.data.idempotencyKey ||
        null;

      try {
        const result = await createPayment(request.storeId, {
          ...parsed.data,
          idempotencyKey,
        });

        if (!result.replayed) {
          publishStoreOrderEvent(request.storeId, {
            type: 'payment.created',
            payment: {
              id: result.payment.id,
              method: result.payment.method,
              status: result.payment.status,
              amount: result.payment.amount,
              sessionId: result.payment.sessionId,
              orderId: result.payment.orderId,
              provider: result.payment.provider,
            },
          });
        }

        return reply.code(result.replayed ? 200 : 201).send({
          replayed: result.replayed,
          payment: result.payment,
        });
      } catch (err) {
        const mapped = mapPaymentError(err);
        if (mapped) {
          const { statusCode, body } = errorResponse(mapped);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  app.get(
    '/api/payments/:id',
    { preHandler: [app.requireTenant] },
    async (request, reply) => {
      const payment = await findPaymentById(request.storeId, request.params.id);
      if (!payment) {
        const err = new AppError('PAYMENT_NOT_FOUND', 'Pagamento não encontrado.', 404);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      return { payment };
    }
  );

  app.get(
    '/api/payments',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request) => {
      const payments = await listPayments(request.storeId, {
        sessionId: request.query?.sessionId || null,
        orderId: request.query?.orderId || null,
        status: request.query?.status || null,
      });
      return { storeId: request.storeId, payments };
    }
  );

  app.post(
    '/api/payments/:id/confirm',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request, reply) => {
      try {
        const result = await confirmPayment(request.storeId, request.params.id, {
          metadata: {
            confirmedBy: request.user?.id || null,
            confirmedAt: new Date().toISOString(),
          },
        });
        if (!result) {
          const err = new AppError('PAYMENT_NOT_FOUND', 'Pagamento não encontrado.', 404);
          const { statusCode, body } = errorResponse(err);
          return reply.code(statusCode).send(body);
        }

        if (!result.alreadyPaid) {
          publishStoreOrderEvent(request.storeId, {
            type: 'payment.paid',
            payment: {
              id: result.payment.id,
              method: result.payment.method,
              amount: result.payment.amount,
              sessionId: result.payment.sessionId,
              orderId: result.payment.orderId,
            },
          });
        }

        return {
          alreadyPaid: result.alreadyPaid,
          payment: result.payment,
        };
      } catch (err) {
        const mapped = mapPaymentError(err);
        if (mapped) {
          const { statusCode, body } = errorResponse(mapped);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  /**
   * Webhook genérico + normalização Mercado Pago.
   * POST /api/payments/webhooks/:provider
   * Idempotente via payment_events (provider, external_event_id).
   */
  app.post('/api/payments/webhooks/:provider', async (request, reply) => {
    const provider = String(request.params.provider || '').toLowerCase();
    const body = request.body || {};

    if (provider === 'mercadopago' || provider === 'mp') {
      const verify = verifyMercadoPagoWebhook(request.headers || {}, body);
      if (!verify.ok) {
        const err = new AppError('WEBHOOK_INVALID', 'Assinatura inválida.', 401);
        const { statusCode, body: b } = errorResponse(err);
        return reply.code(statusCode).send(b);
      }

      const norm = normalizeMercadoPagoWebhook(body);
      let markPaid = false;
      let providerPaymentId = norm.providerPaymentId;

      // Confirma status real no MP quando possível
      if (providerPaymentId) {
        const mpPay = await getMercadoPagoPayment(providerPaymentId);
        if (mpPay) {
          markPaid = mpPay.status === 'approved';
          providerPaymentId = String(mpPay.id);
        } else {
          markPaid = norm.markPaid;
        }
      }

      try {
        const result = await processWebhookEvent({
          storeId: body.storeId || null,
          provider: 'mercadopago',
          externalEventId: norm.externalEventId,
          eventType: norm.eventType,
          payload: body,
          paymentId: body.paymentId || null,
          providerPaymentId,
          markPaid,
        });

        if (result.payment && !result.duplicate) {
          publishStoreOrderEvent(result.payment.storeId, {
            type: 'payment.paid',
            payment: {
              id: result.payment.id,
              method: result.payment.method,
              amount: result.payment.amount,
              status: result.payment.status,
            },
          });
        }

        return {
          ok: true,
          duplicate: result.duplicate,
          eventId: result.event?.id || null,
          payment: result.payment
            ? { id: result.payment.id, status: result.payment.status }
            : null,
        };
      } catch (err) {
        const mapped = mapPaymentError(err);
        if (mapped) {
          const { statusCode, body: b } = errorResponse(mapped);
          return reply.code(statusCode).send(b);
        }
        throw err;
      }
    }

    // Genérico
    const externalEventId =
      body.externalEventId || body.id || body.event_id || null;
    const eventType = body.eventType || body.type || 'unknown';
    const paymentId = body.paymentId || null;
    const storeId = body.storeId || request.storeId || null;
    const markPaid =
      body.markPaid === true ||
      eventType === 'payment.paid' ||
      eventType === 'payment.updated';

    if (!externalEventId) {
      const err = new AppError(
        'WEBHOOK_INVALID',
        'externalEventId (ou id) é obrigatório.',
        400
      );
      const { statusCode, body: b } = errorResponse(err);
      return reply.code(statusCode).send(b);
    }

    try {
      const result = await processWebhookEvent({
        storeId,
        provider,
        externalEventId: String(externalEventId),
        eventType: String(eventType),
        payload: body,
        paymentId,
        markPaid: Boolean(markPaid && paymentId && storeId),
        providerPaymentId: body.providerPaymentId || null,
      });

      if (result.payment && !result.duplicate) {
        publishStoreOrderEvent(result.payment.storeId, {
          type: 'payment.paid',
          payment: {
            id: result.payment.id,
            method: result.payment.method,
            amount: result.payment.amount,
            status: result.payment.status,
          },
        });
      }

      return {
        ok: true,
        duplicate: result.duplicate,
        eventId: result.event?.id || null,
        payment: result.payment
          ? { id: result.payment.id, status: result.payment.status }
          : null,
      };
    } catch (err) {
      const mapped = mapPaymentError(err);
      if (mapped) {
        const { statusCode, body: b } = errorResponse(mapped);
        return reply.code(statusCode).send(b);
      }
      throw err;
    }
  });
}

export default fp(paymentsRoutes, {
  name: 'payments-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
