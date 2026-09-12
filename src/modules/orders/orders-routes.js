import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  createOrder,
  findOrderById,
  listOrderItems,
  transitionOrderStatus,
  cancelOrderAsCustomer,
  getOrderStations,
  transitionOrderItemStatus,
  listReadyItems,
  getSessionSummary,
  listOpenSessions,
} from './orders.repository.js';
import { closeSession } from '../tables/tables.repository.js';
import { publishStoreOrderEvent } from '../realtime/store-events.js';
import { AppError, errorResponse } from '../../shared/errors.js';

const createOrderSchema = z.object({
  tableSessionId: z.string().uuid().optional().nullable(),
  channel: z.enum(['TABLE', 'DELIVERY']).optional().default('TABLE'),
  notes: z.string().max(1000).optional().nullable(),
  idempotencyKey: z.string().min(8).max(128).optional().nullable(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
        notes: z.string().max(500).optional().nullable(),
        addonIds: z.array(z.string().uuid()).optional().default([]),
      })
    )
    .min(1)
    .max(50),
});

const statusSchema = z.object({
  status: z.enum(['CONFIRMED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED']),
});

const itemStatusSchema = z.object({
  status: z.enum(['PREPARING', 'READY', 'DELIVERED', 'CANCELLED']),
});

function mapOrderError(err) {
  const code = err.code || err.message;
  switch (code) {
    case 'ORDER_EMPTY':
      return new AppError('ORDER_EMPTY', 'Pedido sem itens.', 400);
    case 'PRODUCT_NOT_FOUND':
      return new AppError('PRODUCT_NOT_FOUND', 'Produto não encontrado nesta loja.', 404);
    case 'PRODUCT_UNAVAILABLE':
      return new AppError('PRODUCT_UNAVAILABLE', 'Produto indisponível.', 409);
    case 'INVALID_STATUS_TRANSITION':
      return new AppError(
        'INVALID_STATUS_TRANSITION',
        `Transição inválida: ${err.from} → ${err.to}.`,
        409
      );
    case 'INVALID_ITEM_STATUS_TRANSITION':
      return new AppError(
        'INVALID_ITEM_STATUS_TRANSITION',
        `Transição de item inválida: ${err.from} → ${err.to}.`,
        409
      );
    case 'CANCEL_NOT_ALLOWED':
      if (err.reason === 'window') {
        return new AppError(
          'CANCEL_WINDOW_EXPIRED',
          'Prazo de cancelamento pelo cliente esgotado.',
          409,
          { windowSeconds: err.windowSeconds }
        );
      }
      return new AppError(
        'CANCEL_NOT_ALLOWED',
        'Cancelamento não permitido neste status. Fale com a loja.',
        409,
        { status: err.status }
      );
    case '23505':
      return new AppError('CONFLICT', 'Conflito de idempotência. Tente novamente.', 409);
    default:
      return null;
  }
}

function emitOrder(storeId, type, order, extra = {}) {
  publishStoreOrderEvent(storeId, {
    type,
    order: {
      id: order.id,
      status: order.status,
      channel: order.channel,
      tableSessionId: order.table_session_id ?? order.tableSessionId ?? null,
      notes: order.notes,
      createdAt: order.created_at ?? order.createdAt,
      updatedAt: order.updated_at ?? order.updatedAt,
      cancelledAt: order.cancelled_at ?? order.cancelledAt ?? null,
    },
    ...extra,
  });
}

async function ordersRoutes(app) {
  app.post(
    '/api/orders',
    { preHandler: [app.requireTenant] },
    async (request, reply) => {
      const parsed = createOrderSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload de pedido inválido.', 400, {
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
        const result = await createOrder(request.storeId, {
          tableSessionId: parsed.data.tableSessionId ?? null,
          channel: parsed.data.channel,
          notes: parsed.data.notes ?? null,
          idempotencyKey,
          items: parsed.data.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            notes: i.notes,
            addonIds: i.addonIds,
          })),
        });

        if (!result.replayed) {
          emitOrder(request.storeId, 'order.created', result.order, {
            stations: result.stations || [],
            items: result.items.map((it) => ({
              id: it.id,
              productName: it.product_name,
              quantity: it.quantity,
              station: it.station,
            })),
          });
        }

        const statusCode = result.replayed ? 200 : 201;
        return reply.code(statusCode).send({
          replayed: result.replayed,
          order: {
            id: result.order.id,
            status: result.order.status,
            channel: result.order.channel,
            tableSessionId: result.order.table_session_id,
            notes: result.order.notes,
            createdAt: result.order.created_at,
          },
          stations: result.stations || [],
          items: result.items.map((it) => ({
            id: it.id,
            productId: it.product_id,
            productName: it.product_name,
            unitPrice: Number(it.unit_price),
            quantity: it.quantity,
            notes: it.notes,
            status: it.status,
            station: it.station,
          })),
        });
      } catch (err) {
        const mapped = mapOrderError(err);
        if (mapped) {
          const { statusCode, body } = errorResponse(mapped);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  app.get(
    '/api/orders/:id',
    { preHandler: [app.requireTenant] },
    async (request, reply) => {
      const order = await findOrderById(request.storeId, request.params.id);
      if (!order) {
        const err = new AppError('ORDER_NOT_FOUND', 'Pedido não encontrado.', 404);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }

      const items = await listOrderItems(request.storeId, order.id);
      return {
        order: {
          id: order.id,
          status: order.status,
          channel: order.channel,
          tableSessionId: order.table_session_id,
          notes: order.notes,
          createdAt: order.created_at,
          updatedAt: order.updated_at,
        },
        items: items.map((it) => ({
          id: it.id,
          productId: it.product_id,
          productName: it.product_name,
          unitPrice: Number(it.unit_price),
          quantity: it.quantity,
          notes: it.notes,
          status: it.status,
          station: it.station,
        })),
      };
    }
  );

  app.post(
    '/api/orders/:id/cancel',
    { preHandler: [app.requireTenant] },
    async (request, reply) => {
      try {
        const order = await cancelOrderAsCustomer(request.storeId, request.params.id);
        if (!order) {
          const err = new AppError('ORDER_NOT_FOUND', 'Pedido não encontrado.', 404);
          const { statusCode, body } = errorResponse(err);
          return reply.code(statusCode).send(body);
        }
        const stations = await getOrderStations(request.storeId, order.id);
        emitOrder(request.storeId, 'order.cancelled', order, { stations });
        return {
          order: {
            id: order.id,
            status: order.status,
            cancelledAt: order.cancelled_at,
          },
        };
      } catch (err) {
        const mapped = mapOrderError(err);
        if (mapped) {
          const { statusCode, body } = errorResponse(mapped);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  app.patch(
    '/api/orders/:id/status',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request, reply) => {
      const parsed = statusSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Status inválido.', 400);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }

      try {
        const order = await transitionOrderStatus(
          request.storeId,
          request.params.id,
          parsed.data.status
        );
        if (!order) {
          const err = new AppError('ORDER_NOT_FOUND', 'Pedido não encontrado.', 404);
          const { statusCode, body } = errorResponse(err);
          return reply.code(statusCode).send(body);
        }

        const stations = await getOrderStations(request.storeId, order.id);
        emitOrder(request.storeId, 'order.status_changed', order, { stations });

        return {
          order: {
            id: order.id,
            status: order.status,
            updatedAt: order.updated_at,
            cancelledAt: order.cancelled_at,
          },
        };
      } catch (err) {
        const mapped = mapOrderError(err);
        if (mapped) {
          const { statusCode, body } = errorResponse(mapped);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  /**
   * Transição de status de item (cozinha / garçom / manager).
   * PATCH /api/orders/items/:itemId/status
   * Body: { "status": "PREPARING" | "READY" | "DELIVERED" | "CANCELLED" }
   */
  app.patch(
    '/api/orders/items/:itemId/status',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request, reply) => {
      const parsed = itemStatusSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Status de item inválido.', 400);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }

      try {
        const item = await transitionOrderItemStatus(
          request.storeId,
          request.params.itemId,
          parsed.data.status
        );
        if (!item) {
          const err = new AppError('ITEM_NOT_FOUND', 'Item não encontrado nesta loja.', 404);
          const { statusCode, body } = errorResponse(err);
          return reply.code(statusCode).send(body);
        }

        publishStoreOrderEvent(request.storeId, {
          type: 'order.item_status_changed',
          item: {
            id: item.id,
            orderId: item.order_id,
            status: item.status,
            station: item.station,
            productName: item.product_name,
            quantity: item.quantity,
            deliveredAt: item.delivered_at,
          },
        });

        return {
          item: {
            id: item.id,
            orderId: item.order_id,
            status: item.status,
            station: item.station,
            productName: item.product_name,
            quantity: item.quantity,
            deliveredAt: item.delivered_at,
            updatedAt: item.updated_at,
          },
        };
      } catch (err) {
        const mapped = mapOrderError(err);
        if (mapped) {
          const { statusCode, body } = errorResponse(mapped);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  /**
   * Garçom: itens READY aguardando entrega.
   * GET /api/waiter/ready-items?station=KITCHEN|BAR
   */
  app.get(
    '/api/waiter/ready-items',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request) => {
      const station = request.query?.station
        ? String(request.query.station).toUpperCase()
        : null;
      const items = await listReadyItems(request.storeId, {
        station: station === 'KITCHEN' || station === 'BAR' ? station : null,
      });
      return { storeId: request.storeId, items };
    }
  );

  /**
   * Atalho: marcar item READY → DELIVERED.
   * PATCH /api/waiter/items/:itemId/deliver
   */
  app.patch(
    '/api/waiter/items/:itemId/deliver',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request, reply) => {
      try {
        const item = await transitionOrderItemStatus(
          request.storeId,
          request.params.itemId,
          'DELIVERED'
        );
        if (!item) {
          const err = new AppError('ITEM_NOT_FOUND', 'Item não encontrado nesta loja.', 404);
          const { statusCode, body } = errorResponse(err);
          return reply.code(statusCode).send(body);
        }

        publishStoreOrderEvent(request.storeId, {
          type: 'order.item_delivered',
          item: {
            id: item.id,
            orderId: item.order_id,
            status: item.status,
            station: item.station,
            productName: item.product_name,
            quantity: item.quantity,
            deliveredAt: item.delivered_at,
          },
        });

        return {
          item: {
            id: item.id,
            orderId: item.order_id,
            status: item.status,
            deliveredAt: item.delivered_at,
          },
        };
      } catch (err) {
        const mapped = mapOrderError(err);
        if (mapped) {
          const { statusCode, body } = errorResponse(mapped);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  /**
   * Caixa: sessões abertas com totais.
   * GET /api/cashier/sessions
   */
  app.get(
    '/api/cashier/sessions',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request) => {
      const sessions = await listOpenSessions(request.storeId);
      return { storeId: request.storeId, sessions };
    }
  );

  /**
   * Caixa: detalhe + consumo de uma sessão.
   * GET /api/cashier/sessions/:id
   */
  app.get(
    '/api/cashier/sessions/:id',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request, reply) => {
      const summary = await getSessionSummary(request.storeId, request.params.id);
      if (!summary) {
        const err = new AppError('SESSION_NOT_FOUND', 'Sessão não encontrada.', 404);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      return summary;
    }
  );

  /**
   * Caixa: fecha a sessão e libera a mesa.
   * POST /api/cashier/sessions/:id/close
   * (pagamentos reais virão em etapa posterior)
   */
  app.post(
    '/api/cashier/sessions/:id/close',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request, reply) => {
      const session = await closeSession(request.storeId, request.params.id);
      if (!session) {
        const err = new AppError(
          'SESSION_NOT_FOUND',
          'Sessão não encontrada ou já fechada.',
          404
        );
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }

      publishStoreOrderEvent(request.storeId, {
        type: 'session.closed',
        session: {
          id: session.id,
          tableId: session.table_id,
          closedAt: session.closed_at,
        },
      });

      return {
        session: {
          id: session.id,
          tableId: session.table_id,
          status: session.status,
          closedAt: session.closed_at,
        },
      };
    }
  );
}

export default fp(ordersRoutes, {
  name: 'orders-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
