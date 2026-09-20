import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  createPayment,
  confirmPayment,
  refundPayment,
  findPaymentById,
  listPayments,
  processWebhookEvent,
  getPixConfigForStore,
  toPublicPayment,
  PaymentError,
} from './payments.repository.js';
import {
  normalizeProviderEvent,
  readSignatureHeader,
  verifyHmac,
  webhookSecret,
} from './webhook-auth.js';
import { publishStoreOrderEvent } from '../realtime/store-events.js';
import { auditRequest } from '../audit/audit-context.js';
import { AppError, errorResponse } from '../../shared/errors.js';

/**
 * Schema público de criação de pagamento.
 *
 * `metadata` foi REMOVIDO: era um canal para o cliente injetar dados internos
 * (payload de webhook, dados de cartão, flags de confirmação). O que o servidor
 * grava em metadata é gerado por ele mesmo.
 *
 * `provider` / `providerPaymentId` também não são aceitos aqui: apenas fluxos
 * internos (integração com provider) podem registrá-los.
 */
const createSchema = z
  .object({
    amount: z.number().positive().max(1_000_000),
    method: z.enum(['PIX', 'CASH', 'CARD', 'OTHER']).default('PIX'),
    orderId: z.string().uuid().optional().nullable(),
    sessionId: z.string().uuid().optional().nullable(),
    idempotencyKey: z.string().min(8).max(128).optional().nullable(),
  })
  .strict('Campo não aceito no payload público de pagamento.');

const PAYMENT_ERROR_STATUS = {
  ORDER_NOT_FOUND: 404,
  ORDER_CANCELLED: 409,
  SESSION_NOT_FOUND: 404,
  SESSION_CLOSED: 409,
  PAYMENT_NOT_FOUND: 404,
  AMOUNT_EXCEEDS_DUE: 409,
  TARGET_REQUIRED: 400,
  INVALID_AMOUNT: 400,
  STORE_NOT_FOUND: 404,
  PIX_NOT_CONFIGURED: 503,
  INVALID_STATUS: 409,
  WEBHOOK_INVALID: 400,
  WEBHOOK_PROVIDER_UNKNOWN: 404,
  WEBHOOK_SIGNATURE_INVALID: 401,
};

export function mapPaymentError(err) {
  if (!(err instanceof PaymentError)) return null;
  const status =
    err.details?.statusCode ??
    PAYMENT_ERROR_STATUS[err.code] ??
    400;
  return new AppError(err.code, err.message, status, err.details);
}

function sendError(reply, err) {
  const { statusCode, body } = errorResponse(err);
  return reply.code(statusCode).send(body);
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
        return sendError(
          reply,
          new AppError('VALIDATION_ERROR', 'Payload de pagamento inválido.', 400, {
            issues: parsed.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          })
        );
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
          await auditRequest(request, {
            action: 'payment.created',
            resource: 'payment',
            resourceId: result.payment.id,
            metadata: {
              method: result.payment.method,
              status: result.payment.status,
              amount: result.payment.amount,
              orderId: result.payment.orderId,
              sessionId: result.payment.sessionId,
            },
          });

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
          payment: toPublicPayment(result.payment),
        });
      } catch (err) {
        const mapped = mapPaymentError(err);
        if (mapped) return sendError(reply, mapped);
        throw err;
      }
    }
  );

  /**
   * Detalhe público do pagamento — shape mínimo.
   * Nunca devolve metadata, providerPaymentId, idempotencyKey nem dados da loja.
   */
  app.get(
    '/api/payments/:id',
    { preHandler: [app.requireTenant] },
    async (request, reply) => {
      const payment = await findPaymentById(request.storeId, request.params.id);
      if (!payment) {
        return sendError(
          reply,
          new AppError('PAYMENT_NOT_FOUND', 'Pagamento não encontrado.', 404)
        );
      }
      return { payment: toPublicPayment(payment) };
    }
  );

  /** Listar por sessão ou pedido (staff — shape completo) */
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
   * POST /api/payments/:id/confirm
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
          return sendError(
            reply,
            new AppError('PAYMENT_NOT_FOUND', 'Pagamento não encontrado.', 404)
          );
        }

        await auditRequest(request, {
          action: 'payment.confirmed',
          resource: 'payment',
          resourceId: result.payment.id,
          metadata: {
            amount: result.payment.amount,
            method: result.payment.method,
            alreadyPaid: result.alreadyPaid,
          },
        });

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

        return { alreadyPaid: result.alreadyPaid, payment: result.payment };
      } catch (err) {
        const mapped = mapPaymentError(err);
        if (mapped) return sendError(reply, mapped);
        throw err;
      }
    }
  );

  /**
   * Estorno (OWNER). Nunca remove o pagamento: muda status para REFUNDED,
   * preservando o rastro financeiro.
   */
  app.post(
    '/api/payments/:id/refund',
    { preHandler: [app.requireTenant, app.requirePermission('payments.refund')] },
    async (request, reply) => {
      try {
        const result = await refundPayment(request.storeId, request.params.id, {
          reason: request.body?.reason ?? null,
          actorUserId: request.user?.id ?? null,
        });
        if (!result) {
          return sendError(
            reply,
            new AppError('PAYMENT_NOT_FOUND', 'Pagamento não encontrado.', 404)
          );
        }
        await auditRequest(request, {
          action: 'payment.refunded',
          resource: 'payment',
          resourceId: result.payment.id,
          metadata: {
            amount: result.payment.amount,
            alreadyRefunded: result.alreadyRefunded,
          },
        });

        return { alreadyRefunded: result.alreadyRefunded, payment: result.payment };
      } catch (err) {
        const mapped = mapPaymentError(err);
        if (mapped) return sendError(reply, mapped);
        throw err;
      }
    }
  );

  /**
   * Webhooks — escopo ENCAPSULADO com parser que preserva o corpo bruto.
   *
   * O parser é local ao escopo: rotas fora daqui continuam usando o parser
   * JSON padrão do Fastify.
   *
   * Ordem obrigatória: provider conhecido → assinatura HMAC válida → só então
   * normalizar/gravar o evento. Um payload não assinado nunca toca o banco.
   */
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (request, body, done) => {
        try {
          request.rawBody = body;
          done(null, body.length ? JSON.parse(body.toString('utf8')) : {});
        } catch (err) {
          err.statusCode = 400;
          done(err);
        }
      }
    );

    scope.post(
      '/api/payments/webhooks/:provider',
      { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const provider = String(request.params.provider || '')
          .trim()
          .toLowerCase();

        const secret = webhookSecret(provider);
        if (!secret) {
          return sendError(
            reply,
            new AppError(
              'WEBHOOK_PROVIDER_UNKNOWN',
              'Provider não habilitado.',
              404
            )
          );
        }

        if (
          !verifyHmac(
            request.rawBody,
            readSignatureHeader(request.headers),
            secret
          )
        ) {
          return sendError(
            reply,
            new AppError(
              'WEBHOOK_SIGNATURE_INVALID',
              'Assinatura inválida.',
              401
            )
          );
        }

        // Só depois da assinatura válida o body é considerado.
        const event = normalizeProviderEvent(provider, request.body || {});

        if (!event.externalEventId) {
          return sendError(
            reply,
            new AppError(
              'WEBHOOK_INVALID',
              'externalEventId (ou id) é obrigatório.',
              400
            )
          );
        }

        try {
          const result = await processWebhookEvent({
            provider,
            externalEventId: event.externalEventId,
            eventType: event.eventType,
            providerPaymentId: event.providerPaymentId,
            amount: event.amount,
            payload: request.body || {},
            // dado NÃO confiável: usado só para diagnóstico de divergência
            bodyStoreId: event.storeIdFromBody,
          });

          await auditRequest(request, {
            action: 'payment.webhook_received',
            storeId: result.payment?.storeId ?? result.event?.storeId ?? null,
            resource: 'payment',
            resourceId: result.payment?.id ?? null,
            metadata: {
              provider,
              eventType: result.event?.eventType ?? null,
              duplicate: Boolean(result.duplicate),
              mismatched: Boolean(result.mismatched),
              changed: Boolean(result.changed),
            },
          });

          if (
            result.payment &&
            result.changed &&
            result.payment.storeId
          ) {
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
            mismatched: Boolean(result.mismatched),
            eventId: result.event?.id || null,
            payment: result.payment
              ? { id: result.payment.id, status: result.payment.status }
              : null,
          };
        } catch (err) {
          const mapped = mapPaymentError(err);
          if (mapped) return sendError(reply, mapped);
          throw err;
        }
      }
    );
  });
}

export default fp(paymentsRoutes, {
  name: 'payments-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
