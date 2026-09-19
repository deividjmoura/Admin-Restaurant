import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  getCart,
  addCartItem,
  updateCartItem,
  removeCartItem,
  clearCart,
  getCartItemsForCheckout,
  CartConflictError,
  CartError,
} from './cart.repository.js';
import { createOrder } from '../orders/orders.repository.js';
import { publishStoreOrderEvent } from '../realtime/store-events.js';
import { AppError, errorResponse } from '../../shared/errors.js';

const addSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  notes: z.string().max(500).optional().nullable(),
  addonIds: z.array(z.string().uuid()).optional().default([]),
  expectedVersion: z.number().int().min(0),
});

const updateSchema = z.object({
  quantity: z.number().int().min(1).max(99).optional(),
  notes: z.string().max(500).optional().nullable(),
  expectedVersion: z.number().int().min(0),
});

const versionSchema = z.object({
  expectedVersion: z.number().int().min(0),
});

const checkoutSchema = z.object({
  expectedVersion: z.number().int().min(0),
  notes: z.string().max(1000).optional().nullable(),
  idempotencyKey: z.string().min(8).max(128).optional().nullable(),
});

function mapCartError(err) {
  if (err instanceof CartConflictError) {
    return new AppError(
      'CART_VERSION_CONFLICT',
      'Carrinho foi alterado por outro cliente. Recarregue e tente de novo.',
      409,
      { currentVersion: err.currentVersion }
    );
  }
  if (err instanceof CartError) {
    const status =
      err.code === 'SESSION_NOT_FOUND' || err.code === 'CART_ITEM_NOT_FOUND'
        ? 404
        : err.code === 'SESSION_CLOSED'
          ? 409
          : err.code === 'PRODUCT_UNAVAILABLE' || err.code === 'CART_EMPTY'
            ? 409
            : 400;
    return new AppError(err.code, err.message, status);
  }
  return null;
}

/**
 * Resolve storeId da sessão quando a rota é pública (QR).
 * Se houver tenant no request, deve bater com a sessão.
 */
async function resolveSessionStore(request, sessionId) {
  const { query } = await import('../../infrastructure/db.js');
  const { rows } = await query(
    `SELECT id, store_id, status FROM table_sessions WHERE id = $1`,
    [sessionId]
  );
  const session = rows[0];
  if (!session) return null;
  if (request.storeId && request.storeId !== session.store_id) {
    return null; // hide cross-tenant
  }
  return session;
}

async function cartRoutes(app) {
  /**
   * GET /api/sessions/:sessionId/cart
   * Público (clientes na mesa) — isolado por sessão + store.
   */
  app.get('/api/sessions/:sessionId/cart', async (request, reply) => {
    const session = await resolveSessionStore(request, request.params.sessionId);
    if (!session) {
      const err = new AppError('SESSION_NOT_FOUND', 'Sessão não encontrada.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    const cart = await getCart(session.store_id, session.id);
    if (!cart) {
      const err = new AppError('SESSION_NOT_FOUND', 'Sessão não encontrada.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }
    return cart;
  });

  /**
   * POST /api/sessions/:sessionId/cart/items
   * Body: { productId, quantity, notes?, addonIds?, expectedVersion }
   */
  app.post('/api/sessions/:sessionId/cart/items', async (request, reply) => {
    const parsed = addSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400, {
        issues: parsed.error.issues,
      });
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    const session = await resolveSessionStore(request, request.params.sessionId);
    if (!session) {
      const err = new AppError('SESSION_NOT_FOUND', 'Sessão não encontrada.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    try {
      const result = await addCartItem(session.store_id, session.id, parsed.data);
      const cart = await getCart(session.store_id, session.id);
      return reply.code(201).send({
        addedItemId: result.cartItemId,
        version: result.version,
        cart,
      });
    } catch (err) {
      const mapped = mapCartError(err);
      if (mapped) {
        const { statusCode, body } = errorResponse(mapped);
        return reply.code(statusCode).send(body);
      }
      throw err;
    }
  });

  /**
   * PATCH /api/sessions/:sessionId/cart/items/:itemId
   */
  app.patch('/api/sessions/:sessionId/cart/items/:itemId', async (request, reply) => {
    const parsed = updateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    const session = await resolveSessionStore(request, request.params.sessionId);
    if (!session) {
      const err = new AppError('SESSION_NOT_FOUND', 'Sessão não encontrada.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    try {
      const result = await updateCartItem(
        session.store_id, session.id,
        request.params.itemId,
        parsed.data
      );
      const cart = await getCart(session.store_id, session.id);
      return { version: result.version, cart };
    } catch (err) {
      const mapped = mapCartError(err);
      if (mapped) {
        const { statusCode, body } = errorResponse(mapped);
        return reply.code(statusCode).send(body);
      }
      throw err;
    }
  });

  /**
   * DELETE /api/sessions/:sessionId/cart/items/:itemId
   * Body: { expectedVersion }
   */
  app.delete('/api/sessions/:sessionId/cart/items/:itemId', async (request, reply) => {
    const parsed = versionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const err = new AppError(
        'VALIDATION_ERROR',
        'expectedVersion é obrigatório no body.',
        400
      );
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    const session = await resolveSessionStore(request, request.params.sessionId);
    if (!session) {
      const err = new AppError('SESSION_NOT_FOUND', 'Sessão não encontrada.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    try {
      const result = await removeCartItem(
        session.store_id,
        session.id,
        request.params.itemId,
        parsed.data.expectedVersion
      );
      const cart = await getCart(session.store_id, session.id);
      return { version: result.version, cart };
    } catch (err) {
      const mapped = mapCartError(err);
      if (mapped) {
        const { statusCode, body } = errorResponse(mapped);
        return reply.code(statusCode).send(body);
      }
      throw err;
    }
  });

  /**
   * POST /api/sessions/:sessionId/cart/checkout
   * Converte carrinho → pedido e esvazia o carrinho.
   * Idempotência resolvida ANTES de ler o carrinho (permite retry seguro).
   */
  app.post('/api/sessions/:sessionId/cart/checkout', async (request, reply) => {
    const parsed = checkoutSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    const session = await resolveSessionStore(request, request.params.sessionId);
    if (!session) {
      const err = new AppError('SESSION_NOT_FOUND', 'Sessão não encontrada.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    const headerKey = request.headers['idempotency-key'];
    const idempotencyKey =
      (typeof headerKey === 'string' && headerKey.trim()) ||
      parsed.data.idempotencyKey ||
      null;

    try {
      // Idempotency FIRST — before cart read. Enables safe client retries
      // after network failure. Also blocks cross-session key reuse.
      if (idempotencyKey) {
        const {
          findOrderByIdempotencyKey,
          listOrderItems,
          getOrderStations,
        } = await import('../orders/orders.repository.js');
        const existing = await findOrderByIdempotencyKey(
          session.store_id,
          idempotencyKey
        );
        if (existing) {
          if (existing.table_session_id !== session.id) {
            const err = new AppError(
              'IDEMPOTENCY_KEY_REUSED',
              'Chave de idempotência já usada em outra sessão.',
              409
            );
            const { statusCode, body } = errorResponse(err);
            return reply.code(statusCode).send(body);
          }
          const orderItems = await listOrderItems(session.store_id, existing.id);
          const stations = await getOrderStations(session.store_id, existing.id);
          return reply.code(200).send({
            replayed: true,
            order: {
              id: existing.id,
              status: existing.status,
              tableSessionId: existing.table_session_id,
              createdAt: existing.created_at,
            },
            items: orderItems.map((it) => ({
              id: it.id,
              productName: it.product_name,
              quantity: it.quantity,
              station: it.station,
              status: it.status,
            })),
            stations: stations || [],
          });
        }
      }

      const snapshot = await getCartItemsForCheckout(session.store_id, session.id);
      if (snapshot.version !== parsed.data.expectedVersion) {
        throw new CartConflictError(snapshot.version);
      }

      const result = await createOrder(session.store_id, {
        tableSessionId: session.id,
        channel: 'TABLE',
        notes: parsed.data.notes ?? null,
        idempotencyKey,
        items: snapshot.items,
      });

      // Só limpa se não foi replay de idempotência
      if (!result.replayed) {
        try {
          await clearCart(session.store_id, session.id, snapshot.version);
        } catch (clearErr) {
          // pedido já criado — não falha o checkout se clear conflitar
          request.log?.warn({ err: clearErr }, 'cart clear after checkout failed');
        }

        publishStoreOrderEvent(session.store_id, {
          type: 'order.created',
          order: {
            id: result.order.id,
            status: result.order.status,
            channel: result.order.channel,
            tableSessionId: result.order.table_session_id,
          },
          stations: result.stations || [],
        });
      }

      const statusCode = result.replayed ? 200 : 201;
      return reply.code(statusCode).send({
        replayed: result.replayed,
        order: {
          id: result.order.id,
          status: result.order.status,
          tableSessionId: result.order.table_session_id,
          createdAt: result.order.created_at,
        },
        items: result.items.map((it) => ({
          id: it.id,
          productName: it.product_name,
          quantity: it.quantity,
          station: it.station,
          status: it.status,
        })),
        stations: result.stations || [],
      });
    } catch (err) {
      const mapped = mapCartError(err);
      if (mapped) {
        const { statusCode, body } = errorResponse(mapped);
        return reply.code(statusCode).send(body);
      }
      throw err;
    }
  });
}

export default fp(cartRoutes, {
  name: 'cart-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin'],
});
