/**
 * Rotas do caixa operacional — issues #107 (sessão), #108 (movimentações),
 * #109 (pagamento parcial/combinado e estorno), #110 (relatório/fechamento).
 *
 * Autorização (sempre no backend):
 *   - tenant resolvido pelo plugin (host/domínio/header/query opt-in);
 *   - permissão granular por rota (`cashier.cash.*`, `cashier.movements.write`,
 *     `payments.confirm`, `payments.refund`, `reports.read`);
 *   - gaveta é do operador: STAFF só vê/Move a própria sessão; OWNER/MANAGER
 *     (e super admin) operam qualquer sessão DA MESMA LOJA;
 *   - sessão de outra loja → **404** (nunca 403): não confirmamos existência.
 *
 * Nada aqui decide valor: esperado/contado/diferença vêm do ledger
 * (`cash.repository`), que é append-only.
 */
import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  openSession,
  findSessionById,
  getOpenSessionForOperator,
  listSessions,
  recordMovement,
  listMovements,
  closeSession,
  closingReport,
  cashReport,
  checkoutSummary,
  sessionTotals,
  payInSession,
  refundInSession,
  mapCashError,
  MANUAL_MOVEMENT_TYPES,
} from './cash.repository.js';
import { mapPaymentError } from '../payments/payments-routes.js';
import { publishStoreOrderEvent } from '../realtime/store-events.js';
import { auditRequest } from '../audit/audit-context.js';
import { AppError, errorResponse } from '../../shared/errors.js';

function sendError(reply, err) {
  const { statusCode, body } = errorResponse(err);
  return reply.code(statusCode).send(body);
}

function toAppError(err) {
  return mapCashError(err) || mapPaymentError(err);
}

const openSchema = z
  .object({
    operatorId: z.string().uuid().optional().nullable(),
    openingAmount: z.number().min(0).max(1_000_000).optional().default(0),
    notes: z.string().max(280).optional().nullable(),
    idempotencyKey: z.string().min(8).max(128).optional().nullable(),
  })
  .strict('Campo não aceito na abertura de caixa.');

const movementSchema = z
  .object({
    type: z.enum(MANUAL_MOVEMENT_TYPES),
    amount: z.number().positive().max(1_000_000),
    direction: z.enum(['IN', 'OUT']).optional().nullable(),
    reason: z.string().min(3).max(200).optional().nullable(),
    idempotencyKey: z.string().min(8).max(128).optional().nullable(),
    orderId: z.string().uuid().optional().nullable(),
    tableSessionId: z.string().uuid().optional().nullable(),
  })
  .strict('Campo não aceito na movimentação de caixa.');

const splitItemSchema = z
  .object({
    method: z.enum(['PIX', 'CASH', 'CARD', 'OTHER']),
    amount: z.number().positive().max(1_000_000),
    tenderedAmount: z.number().min(0).max(1_000_000).optional().nullable(),
    confirm: z.boolean().optional(),
    notes: z.string().max(200).optional().nullable(),
  })
  .strict();

const paySchema = z
  .object({
    orderId: z.string().uuid().optional().nullable(),
    sessionId: z.string().uuid().optional().nullable(),
    items: z.array(splitItemSchema).min(1).max(8),
    idempotencyKey: z.string().min(8).max(128).optional().nullable(),
  })
  .strict('Campo não aceito no pagamento de caixa.')
  .refine((value) => Boolean(value.orderId || value.sessionId), {
    message: 'Informe orderId ou sessionId.',
    path: ['orderId'],
  });

const refundSchema = z
  .object({
    paymentId: z.string().uuid(),
    reason: z.string().min(3).max(200).optional().nullable(),
    idempotencyKey: z.string().min(8).max(128).optional().nullable(),
  })
  .strict('Campo não aceito no estorno de caixa.');

// `countedAmount` é opcional no schema de propósito: quem responde "faltou a
// contagem" é o domínio (CASH_COUNT_REQUIRED), não o validador genérico.
const closeSchema = z
  .object({
    countedAmount: z.number().min(0).max(10_000_000).optional().nullable(),
    notes: z.string().max(280).optional().nullable(),
  })
  .strict('Campo não aceito no fechamento de caixa.');

const reportQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/** Gaveta é do operador: STAFF só a própria; OWNER/MANAGER qualquer da loja. */
function canOperateSession(request, session) {
  if (request.user?.isSuperAdmin || request.user?.isPlatformOwner) return true;
  if (session.operatorId === request.user?.id) return true;
  return ['OWNER', 'MANAGER'].includes(request.storeRole);
}

function forbiddenOtherOperator() {
  return new AppError(
    'FORBIDDEN',
    'Sessão de caixa pertence a outro operador.',
    403
  );
}

function parseValidationError(reply, parsed) {
  if (parsed.success) return null;
  return sendError(
    reply,
    new AppError('VALIDATION_ERROR', 'Payload de caixa inválido.', 400, {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })
  );
}

async function cashRoutes(app) {
  /**
   * Abre a gaveta. `operatorId` opcional: por padrão é quem chama; abrir para outro
   * operador exige OWNER/MANAGER (supervisor abrindo o caixa do operador).
   */
  app.post(
    '/api/cash/sessions',
    { preHandler: [app.requireTenant, app.requirePermission('cashier.cash.open')] },
    async (request, reply) => {
      const parsed = openSchema.safeParse(request.body ?? {});
      const invalid = parseValidationError(reply, parsed);
      if (invalid) return invalid;

      const operatorId = parsed.data.operatorId || request.user.id;
      if (operatorId !== request.user.id && !['OWNER', 'MANAGER'].includes(request.storeRole) && !(request.user.isSuperAdmin || request.user.isPlatformOwner)) {
        return sendError(
          reply,
          new AppError(
            'FORBIDDEN',
            'Apenas gerente ou dono abre sessão de caixa para outro operador.',
            403
          )
        );
      }

      const idempotencyKey =
        request.headers['idempotency-key']?.toString?.().trim() ||
        parsed.data.idempotencyKey ||
        null;

      try {
        const result = await openSession(request.storeId, {
          operatorId,
          openingAmount: parsed.data.openingAmount ?? 0,
          notes: parsed.data.notes ?? null,
          idempotencyKey,
          actorUserId: request.user.id,
        });

        if (!result.replayed) {
          await auditRequest(request, {
            action: 'cash.session_opened',
            resource: 'cash_session',
            resourceId: result.session.id,
            metadata: {
              operatorId,
              openingAmount: result.session.openingAmount,
            },
          });
          publishStoreOrderEvent(request.storeId, {
            type: 'cash.session_opened',
            session: {
              id: result.session.id,
              operatorId,
              status: 'open',
              openingAmount: result.session.openingAmount,
            },
          });
        }

        return reply.code(result.replayed ? 200 : 201).send({
          replayed: result.replayed,
          session: result.session,
          openingMovement: result.openingMovement,
        });
      } catch (err) {
        const mapped = toAppError(err);
        if (mapped) return sendError(reply, mapped);
        throw err;
      }
    }
  );

  /** Lista sessões da loja (filtro por status/operador/período). */
  app.get(
    '/api/cash/sessions',
    { preHandler: [app.requireTenant, app.requirePermission('cashier.cash.read')] },
    async (request, reply) => {
      const isManager =
        request.user?.isSuperAdmin || request.user?.isPlatformOwner || ['OWNER', 'MANAGER'].includes(request.storeRole);
      const operatorId = isManager
        ? request.query?.operatorId || null
        : request.user.id;

      try {
        const sessions = await listSessions(request.storeId, {
          status: request.query?.status || null,
          operatorId,
          from: request.query?.from || null,
          to: request.query?.to || null,
          limit: Number(request.query?.limit) || 50,
        });
        return { storeId: request.storeId, sessions };
      } catch (err) {
        const mapped = toAppError(err);
        if (mapped) return sendError(reply, mapped);
        throw err;
      }
    }
  );

  /** Gaveta aberta do operador (o painel do caixa chama ao entrar). */
  app.get(
    '/api/cash/sessions/active',
    { preHandler: [app.requireTenant, app.requirePermission('cashier.cash.read')] },
    async (request, reply) => {
      const isManager =
        request.user?.isSuperAdmin || request.user?.isPlatformOwner || ['OWNER', 'MANAGER'].includes(request.storeRole);
      const operatorId =
        isManager && request.query?.operatorId
          ? String(request.query.operatorId)
          : request.user.id;

      try {
        const session = await getOpenSessionForOperator(request.storeId, operatorId);
        if (!session) return { storeId: request.storeId, session: null, totals: null };
        const totals = await sessionTotals(request.storeId, session.id);
        return { storeId: request.storeId, session: { ...session, totals }, totals };
      } catch (err) {
        const mapped = toAppError(err);
        if (mapped) return sendError(reply, mapped);
        throw err;
      }
    }
  );

  /** Resumo do que falta pagar (base do pagamento parcial/combinado). */
  app.get(
    '/api/cash/checkout-summary',
    { preHandler: [app.requireTenant, app.requirePermission('payments.read')] },
    async (request, reply) => {
      const orderId = request.query?.orderId || null;
      const sessionId = request.query?.sessionId || null;
      if (!orderId && !sessionId) {
        return sendError(
          reply,
          new AppError('TARGET_REQUIRED', 'Informe orderId ou sessionId.', 400)
        );
      }
      try {
        return await checkoutSummary(request.storeId, { orderId, sessionId });
      } catch (err) {
        const mapped = toAppError(err);
        if (mapped) return sendError(reply, mapped);
        throw err;
      }
    }
  );

  /** Detalhe da sessão + totais do ledger. */
  app.get(
    '/api/cash/sessions/:id',
    { preHandler: [app.requireTenant, app.requirePermission('cashier.cash.read')] },
    async (request, reply) => {
      try {
        const session = await findSessionById(request.storeId, request.params.id);
        if (!session) {
          return sendError(
            reply,
            new AppError('CASH_SESSION_NOT_FOUND', 'Sessão de caixa não encontrada.', 404)
          );
        }
        if (!canOperateSession(request, session)) return sendError(reply, forbiddenOtherOperator());

        const totals = await sessionTotals(request.storeId, session.id);
        return { storeId: request.storeId, session: { ...session, totals }, totals };
      } catch (err) {
        const mapped = toAppError(err);
        if (mapped) return sendError(reply, mapped);
        throw err;
      }
    }
  );

  /** Ledger da sessão (append-only). */
  app.get(
    '/api/cash/sessions/:id/movements',
    { preHandler: [app.requireTenant, app.requirePermission('cashier.cash.read')] },
    async (request, reply) => {
      try {
        const session = await findSessionById(request.storeId, request.params.id);
        if (!session) {
          return sendError(
            reply,
            new AppError('CASH_SESSION_NOT_FOUND', 'Sessão de caixa não encontrada.', 404)
          );
        }
        if (!canOperateSession(request, session)) return sendError(reply, forbiddenOtherOperator());

        const movements = await listMovements(request.storeId, {
          sessionId: session.id,
          type: request.query?.type || null,
          limit: Number(request.query?.limit) || 200,
        });
        return { storeId: request.storeId, sessionId: session.id, movements };
      } catch (err) {
        const mapped = toAppError(err);
        if (mapped) return sendError(reply, mapped);
        throw err;
      }
    }
  );

  /**
   * Movimentação manual: suprimento (IN), sangria (OUT) ou ajuste (IN/OUT com
   * motivo). Idempotente por `Idempotency-Key`.
   */
  app.post(
    '/api/cash/sessions/:id/movements',
    { preHandler: [app.requireTenant, app.requirePermission('cashier.movements.write')] },
    async (request, reply) => {
      const parsed = movementSchema.safeParse(request.body ?? {});
      const invalid = parseValidationError(reply, parsed);
      if (invalid) return invalid;

      try {
        const session = await findSessionById(request.storeId, request.params.id);
        if (!session) {
          return sendError(
            reply,
            new AppError('CASH_SESSION_NOT_FOUND', 'Sessão de caixa não encontrada.', 404)
          );
        }
        if (!canOperateSession(request, session)) return sendError(reply, forbiddenOtherOperator());

        const idempotencyKey =
          request.headers['idempotency-key']?.toString?.().trim() ||
          parsed.data.idempotencyKey ||
          null;

        const result = await recordMovement(request.storeId, session.id, {
          type: parsed.data.type,
          amount: parsed.data.amount,
          direction: parsed.data.direction ?? null,
          reason: parsed.data.reason ?? null,
          idempotencyKey,
          actorUserId: request.user.id,
          orderId: parsed.data.orderId ?? null,
          tableSessionId: parsed.data.tableSessionId ?? null,
        });

        if (!result.replayed) {
          await auditRequest(request, {
            action: 'cash.movement_recorded',
            resource: 'cash_movement',
            resourceId: result.movement?.id ?? null,
            metadata: {
              sessionId: session.id,
              type: parsed.data.type,
              direction: result.movement?.direction,
              amount: parsed.data.amount,
              reason: parsed.data.reason ?? null,
            },
          });
          publishStoreOrderEvent(request.storeId, {
            type: 'cash.movement_recorded',
            session: { id: session.id },
            movement: {
              id: result.movement?.id ?? null,
              type: result.movement?.type,
              direction: result.movement?.direction,
              amount: result.movement?.amount,
            },
          });
        }

        return reply.code(result.replayed ? 200 : 201).send({
          replayed: result.replayed,
          movement: result.movement,
          session: result.session,
        });
      } catch (err) {
        const mapped = toAppError(err);
        if (mapped) return sendError(reply, mapped);
        throw err;
      }
    }
  );

  /**
   * Pagamento parcial/combinado na gaveta — issue #109.
   * `items` aceita vários métodos; a soma não pode passar do devido.
   */
  app.post(
    '/api/cash/sessions/:id/payments',
    { preHandler: [app.requireTenant, app.requirePermission('payments.confirm')] },
    async (request, reply) => {
      const parsed = paySchema.safeParse(request.body ?? {});
      const invalid = parseValidationError(reply, parsed);
      if (invalid) return invalid;

      try {
        const session = await findSessionById(request.storeId, request.params.id);
        if (!session) {
          return sendError(
            reply,
            new AppError('CASH_SESSION_NOT_FOUND', 'Sessão de caixa não encontrada.', 404)
          );
        }
        if (!canOperateSession(request, session)) return sendError(reply, forbiddenOtherOperator());

        const idempotencyKey =
          request.headers['idempotency-key']?.toString?.().trim() ||
          parsed.data.idempotencyKey ||
          null;

        const result = await payInSession(request.storeId, session.id, {
          orderId: parsed.data.orderId ?? null,
          sessionId: parsed.data.sessionId ?? null,
          items: parsed.data.items,
          idempotencyKey,
          actorUserId: request.user.id,
        });

        if (!result.replayed) {
          await auditRequest(request, {
            action: 'cash.payment_split',
            resource: 'payment',
            resourceId: result.payments[0]?.id ?? null,
            metadata: {
              sessionId: session.id,
              methods: result.payments.map((payment) => payment.method),
              amounts: result.payments.map((payment) => payment.amount),
              charged: result.totals?.charged ?? null,
              remainingDue: result.totals?.due ?? null,
              splitGroup: result.splitGroup,
            },
          });
          publishStoreOrderEvent(request.storeId, {
            type: 'payment.paid',
            payment: {
              id: result.payments[0]?.id ?? null,
              method: result.payments[0]?.method ?? null,
              amount: result.totals?.charged ?? null,
              orderId: parsed.data.orderId ?? null,
              sessionId: parsed.data.sessionId ?? null,
            },
          });
        }

        return reply.code(result.replayed ? 200 : 201).send({
          replayed: result.replayed,
          splitGroup: result.splitGroup,
          payments: result.payments,
          totals: result.totals,
          session: result.session,
        });
      } catch (err) {
        const mapped = toAppError(err);
        if (mapped) return sendError(reply, mapped);
        throw err;
      }
    }
  );

  /** Estorno idempotente com saída da gaveta — issue #109. */
  app.post(
    '/api/cash/sessions/:id/refunds',
    { preHandler: [app.requireTenant, app.requirePermission('payments.refund')] },
    async (request, reply) => {
      const parsed = refundSchema.safeParse(request.body ?? {});
      const invalid = parseValidationError(reply, parsed);
      if (invalid) return invalid;

      try {
        const session = await findSessionById(request.storeId, request.params.id);
        if (!session) {
          return sendError(
            reply,
            new AppError('CASH_SESSION_NOT_FOUND', 'Sessão de caixa não encontrada.', 404)
          );
        }
        if (!canOperateSession(request, session)) return sendError(reply, forbiddenOtherOperator());

        const result = await refundInSession(request.storeId, session.id, {
          paymentId: parsed.data.paymentId,
          reason: parsed.data.reason ?? null,
          actorUserId: request.user.id,
        });

        if (!result.alreadyRefunded) {
          await auditRequest(request, {
            action: 'cash.refund',
            resource: 'payment',
            resourceId: result.payment.id,
            metadata: {
              sessionId: session.id,
              amount: result.payment.amount,
              method: result.payment.method,
              reason: parsed.data.reason ?? null,
              cashMovementId: result.cashMovement?.id ?? null,
            },
          });
          publishStoreOrderEvent(request.storeId, {
            type: 'payment.updated',
            payment: {
              id: result.payment.id,
              status: result.payment.status,
              amount: result.payment.amount,
              method: result.payment.method,
            },
          });
        }

        return {
          alreadyRefunded: result.alreadyRefunded,
          payment: result.payment,
          cashMovement: result.cashMovement ?? null,
          session: result.session,
        };
      } catch (err) {
        const mapped = toAppError(err);
        if (mapped) return sendError(reply, mapped);
        throw err;
      }
    }
  );

  /**
   * Fechamento com reconciliação — issue #107/#110.
   * `countedAmount` é obrigatório: sem contagem não há reconciliação possível.
   */
  app.post(
    '/api/cash/sessions/:id/close',
    { preHandler: [app.requireTenant, app.requirePermission('cashier.cash.close')] },
    async (request, reply) => {
      const parsed = closeSchema.safeParse(request.body ?? {});
      const invalid = parseValidationError(reply, parsed);
      if (invalid) return invalid;

      try {
        const session = await findSessionById(request.storeId, request.params.id);
        if (!session) {
          return sendError(
            reply,
            new AppError('CASH_SESSION_NOT_FOUND', 'Sessão de caixa não encontrada.', 404)
          );
        }
        if (!canOperateSession(request, session)) return sendError(reply, forbiddenOtherOperator());

        const result = await closeSession(request.storeId, session.id, {
          countedAmount: parsed.data.countedAmount,
          notes: parsed.data.notes ?? null,
          actorUserId: request.user.id,
        });
        if (!result) {
          return sendError(
            reply,
            new AppError('CASH_SESSION_NOT_FOUND', 'Sessão de caixa não encontrada.', 404)
          );
        }

        if (!result.alreadyClosed) {
          await auditRequest(request, {
            action: 'cash.session_closed',
            resource: 'cash_session',
            resourceId: result.session.id,
            metadata: {
              operatorId: result.session.operatorId,
              expected: result.session.expectedAmount,
              counted: result.session.countedAmount,
              difference: result.session.differenceAmount,
              warnings: result.warnings.map((warning) => warning.code),
            },
          });
          publishStoreOrderEvent(request.storeId, {
            type: 'cash.session_closed',
            session: {
              id: result.session.id,
              operatorId: result.session.operatorId,
              status: 'closed',
              expectedAmount: result.session.expectedAmount,
              countedAmount: result.session.countedAmount,
              differenceAmount: result.session.differenceAmount,
            },
          });
        }

        return {
          alreadyClosed: result.alreadyClosed,
          session: result.session,
          totals: result.session.totals,
          warnings: result.warnings,
        };
      } catch (err) {
        const mapped = toAppError(err);
        if (mapped) return sendError(reply, mapped);
        throw err;
      }
    }
  );

  /** Relatório de fechamento reconciliável de UMA sessão — issue #110. */
  app.get(
    '/api/cash/sessions/:id/report',
    { preHandler: [app.requireTenant, app.requirePermission('cashier.cash.read')] },
    async (request, reply) => {
      try {
        const session = await findSessionById(request.storeId, request.params.id);
        if (!session) {
          return sendError(
            reply,
            new AppError('CASH_SESSION_NOT_FOUND', 'Sessão de caixa não encontrada.', 404)
          );
        }
        if (!canOperateSession(request, session)) return sendError(reply, forbiddenOtherOperator());

        const report = await closingReport(request.storeId, session.id);
        return { storeId: request.storeId, report };
      } catch (err) {
        const mapped = toAppError(err);
        if (mapped) return sendError(reply, mapped);
        throw err;
      }
    }
  );

  /** Relatório consolidado do caixa por período — issue #110. */
  app.get(
    '/api/cash/report',
    { preHandler: [app.requireTenant, app.requirePermission('reports.read')] },
    async (request, reply) => {
      const parsed = reportQuery.safeParse(request.query ?? {});
      const invalid = parseValidationError(reply, parsed);
      if (invalid) return invalid;

      try {
        return await cashReport(request.storeId, {
          from: parsed.data.from ?? null,
          to: parsed.data.to ?? null,
        });
      } catch (err) {
        const mapped = toAppError(err);
        if (mapped) return sendError(reply, mapped);
        throw err;
      }
    }
  );
}

export default fp(cashRoutes, {
  name: 'cash-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin', 'request-context'],
});
