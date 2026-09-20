import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  getCart,
  addCartItem,
  updateCartItem,
  removeCartItem,
  checkoutCart,
  CartConflictError,
  CartError,
} from './cart.repository.js';
import { OrderError } from '../orders/orders.repository.js';
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

const CODE_STATUS = {
  SESSION_NOT_FOUND: 404,
  CART_ITEM_NOT_FOUND: 404,
  PRODUCT_NOT_FOUND: 404,
  PRODUCT_UNAVAILABLE: 409,
  CART_EMPTY: 409,
  SESSION_CLOSED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  STATUS_CONFLICT: 409,
  ADDON_INVALID: 400,
  INVALID_QUANTITY: 400,
  VERSION_REQUIRED: 400,
  ORDER_EMPTY: 400,
  ORDER_SESSION_REQUIRED: 400,
};

function mapCartError(err) {
  if (err instanceof CartConflictError) {
    return new AppError(
      'CART_VERSION_CONFLICT',
      'Carrinho foi alterado por outro cliente. Recarregue e tente de novo.',
      409,
      { currentVersion: err.currentVersion }
    );
  }
  if (err instanceof CartError || err instanceof OrderError) {
    const status = CODE_STATUS[err.code] ?? 400;
    return new AppError(err.code, err.message, status);
  }
  return null;
}

function send(reply, err) {
  const { statusCode, body } = errorResponse(err);
  return reply.code(statusCode).send(body);
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
   * Converte carrinho → pedido e esvazia o carrinho — ATÔMICO.
   *
   * Duas chamadas concorrentes na mesma sessão/versão: o lock da sessão
   * (FOR UPDATE) serializa, a versão do carrinho decide quem vence e o perdedor
   * recebe 409 CART_VERSION_CONFLICT (sem criar pedido).
   */
  app.post('/api/sessions/:sessionId/cart/checkout', async (request, reply) => {
    const parsed = checkoutSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return send(reply, new AppError('VALIDATION_ERROR', 'Payload inválido.', 400));
    }

    const session = await resolveSessionStore(request, request.params.sessionId);
    if (!session) {
      return send(reply, new AppError('SESSION_NOT_FOUND', 'Sessão não encontrada.', 404));
    }

    const headerKey = request.headers['idempotency-key'];
    const idempotencyKey =
      (typeof headerKey === 'string' && headerKey.trim()) ||
      parsed.data.idempotencyKey ||
      null;

    try {
      const result = await checkoutCart(session.store_id, session.id, {
        expectedVersion: parsed.data.expectedVersion,
        idempotencyKey,
        notes: parsed.data.notes ?? null,
      });

      // Efeito colateral só DEPOIS do commit.
      if (!result.replayed) {
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

      return reply.code(result.replayed ? 200 : 201).send({
        replayed: result.replayed,
        order: {
          id: result.order.id,
          status: result.order.status,
          tableSessionId: result.order.table_session_id,
          createdAt: result.order.created_at,
        },
        items: (result.items || []).map((it) => ({
          id: it.id,
          productName: it.product_name,
          quantity: it.quantity,
          station: it.station,
          status: it.status,
          addonsTotal: Number(it.addons_total) || 0,
        })),
        stations: result.stations || [],
        cartVersion: result.version,
      });
    } catch (err) {
      const mapped = mapCartError(err);
      if (mapped) return send(reply, mapped);
      throw err;
    }
  });
}

export default fp(cartRoutes, {
  name: 'cart-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin'],
});
