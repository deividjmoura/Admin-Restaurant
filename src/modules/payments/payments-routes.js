import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  createPayment,
  confirmPayment,
  findPaymentById,
  listPayments,
  processWebhookEvent,
  findPaymentStoreId,
  getPixConfigForStore,
  PaymentError,
} from './payments.repository.js';
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
    err.code === 'PIX_NOT_CONFIGURED'
      ? 503
      : err.code === 'INVALID_STATUS'
        ? 409
        : 400;
  return new AppError(err.code, err.message, status);
}

async function paymentsRoutes(app) {
  /** Público (tenant): config PIX mascarada */
  app.get(
    '/api/payments/pix-config',
    { preHandler: [app.requireTenant] },
    async (request) => {
      const config = await getPixConfigForStore(request.storeId);
      return { storeId: request.storeId, pix: config };
    }
  );

  /** Criar pagamento (cliente ou caixa) */
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

  /** Detalhe */
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

  /** Listar por sessão ou pedido */
  app.get(
    '/api/payments',
    { preHandler: [app.requireTenant, app.requirePermission('payments.read')] },
    async (request) => {
      const payments = await listPayments(request.storeId, {
        sessionId: request.query?.sessionId || null,
        orderId: request.query?.orderId || null,
        status: request.query?.status || null,
      });
      return { storeId: request.storeId, payments };
    }
  );

  /**
   * Caixa confirma pagamento (PIX informado / dinheiro / card presencial).
   * PATCH /api/payments/:id/confirm
   */
  app.post(
    '/api/payments/:id/confirm',
    { preHandler: [app.requireTenant, app.requirePermission('payments.confirm')] },
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
   * Webhook genérico (provider futuro: mercadopago, stripe, etc.).
   * POST /api/payments/webhooks/:provider
   *
   * Body esperado (normalizado):
   * {
   *   "externalEventId": "evt_xxx",
   *   "eventType": "payment.paid",
   *   "paymentId": "uuid-interno-opcional",
   *   "storeId": "uuid-opcional",
   *   "markPaid": true,
   *   "providerPaymentId": "ext_pay_1",
   *   ...resto no payload
   * }
   *
   * Duplicata do mesmo externalEventId → 200 { duplicate: true } sem reprocessar.
   */
  app.post('/api/payments/webhooks/:provider', async (request, reply) => {
    const provider = String(request.params.provider || '').toLowerCase();
    const body = request.body || {};
    const externalEventId =
      body.externalEventId || body.id || body.event_id || null;
    const eventType = body.eventType || body.type || 'unknown';
    const paymentId = body.paymentId || null;
    const clientStoreId = body.storeId || null;
    const requestStoreId = request.storeId || null;
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
      // Nunca confie em body.storeId como fonte de tenant.
      // Se houver paymentId, o tenant é derivado do próprio pagamento.
      // Sem paymentId, só aceitamos tenant resolvido pelo host/header.
      const paymentStoreId = paymentId
        ? await findPaymentStoreId(paymentId)
        : null;

      if (paymentId && !paymentStoreId) {
        const err = new AppError('PAYMENT_NOT_FOUND', 'Pagamento não encontrado.', 404);
        const { statusCode, body: b } = errorResponse(err);
        return reply.code(statusCode).send(b);
      }

      const storeId = paymentStoreId || requestStoreId;

      if (!storeId) {
        const err = new AppError(
          'WEBHOOK_TENANT_REQUIRED',
          'Não foi possível resolver a loja do webhook com segurança.',
          400
        );
        const { statusCode, body: b } = errorResponse(err);
        return reply.code(statusCode).send(b);
      }

      if (clientStoreId && clientStoreId !== storeId) {
        const err = new AppError('PAYMENT_NOT_FOUND', 'Pagamento não encontrado.', 404);
        const { statusCode, body: b } = errorResponse(err);
        return reply.code(statusCode).send(b);
      }

      if (requestStoreId && requestStoreId !== storeId) {
        const err = new AppError('PAYMENT_NOT_FOUND', 'Pagamento não encontrado.', 404);
        const { statusCode, body: b } = errorResponse(err);
        return reply.code(statusCode).send(b);
      }

      const result = await processWebhookEvent({
        storeId,
        provider,
        externalEventId: String(externalEventId),
        eventType: String(eventType),
        payload: body,
        paymentId,
        markPaid: Boolean(markPaid && paymentId),
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
