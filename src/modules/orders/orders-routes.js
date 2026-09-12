import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  createOrder,
  findOrderById,
  listOrderItems,
  transitionOrderStatus,
} from './orders.repository.js';
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
    case '23505': // unique violation (idempotency race)
      return new AppError('CONFLICT', 'Conflito de idempotência. Tente novamente.', 409);
    default:
      return null;
  }
}

async function ordersRoutes(app) {
  /** Create order (public for table channel when tenant is known). */
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

      // Prefer header for idempotency (also accept body)
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
          items: result.items.map((it) => ({
            id: it.id,
            productId: it.product_id,
            productName: it.product_name,
            unitPrice: Number(it.unit_price),
            quantity: it.quantity,
            notes: it.notes,
            status: it.status,
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

  /** Get order by id (tenant-scoped). */
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
        })),
      };
    }
  );

  /** Status transition — staff only. */
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
}

export default fp(ordersRoutes, {
  name: 'orders-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
