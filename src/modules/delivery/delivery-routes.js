import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  listZones,
  createZone,
  updateZone,
  findZoneById,
  quoteDelivery,
  createDeliveryOrder,
  getDeliveryByOrderId,
  rotateDeliveryCredential,
  DeliveryError,
} from './delivery.repository.js';
import {
  issueDeliveryCheckout,
  assertDeliveryOrderScope,
  DELIVERY_TERMINAL_STATUSES,
} from './delivery-checkout.js';
import {
  cancelOrderAsCustomer,
  cancelOrderAsStaff,
} from '../orders/orders.repository.js';
import { publishStoreOrderEvent } from '../realtime/store-events.js';
import { AppError, errorResponse } from '../../shared/errors.js';
import { auditRequest } from '../audit/audit-context.js';

/** Credenciais no response body: proibido cacheá-las (espelho do fluxo QR). */
function noStore(reply) {
  reply.header('Cache-Control', 'no-store');
  reply.header('Referrer-Policy', 'no-referrer');
}

/** Mesma política de cancelamento da mesa vale para o checkout: janela curta e
 * status PENDING/CONFIRMED. Mapeia os OrderError do cancelamento sem importar
 * o mapa inteiro de orders-routes. */
function mapCancelError(err) {
  if (err?.code === 'CANCEL_NOT_ALLOWED') {
    if (err.reason === 'window')
      return new AppError(
        'CANCEL_WINDOW_EXPIRED',
        'Prazo de cancelamento pelo cliente esgotado.',
        409,
        { windowSeconds: err.windowSeconds }
      );
    return new AppError(
      'CANCEL_NOT_ALLOWED',
      'Cancelamento não permitido neste status. Fale com a loja.',
      409,
      { status: err.status }
    );
  }
  if (err?.code === 'STATUS_CONFLICT')
    return new AppError(
      'STATUS_CONFLICT',
      'O pedido foi alterado por outra operação. Recarregue e tente novamente.',
      409
    );
  return null;
}

/** O plano mesa/QR nunca opera checkouts de delivery (e vice-versa: o dispatcher
 * de assertOrderScope/recuso na origem — este gate protege a SHAPE da rota). */
function assertDeliveryPlane(customer) {
  if (customer && customer.kind !== 'delivery')
    throw new AppError(
      'CONTEXT_FORBIDDEN',
      'Esta credencial não autoriza o checkout de delivery.',
      403
    );
}

const zoneBodySchema = z.object({
  name: z.string().min(1).max(120),
  fee: z.number().min(0).max(9999).optional().default(0),
  minOrderAmount: z.number().min(0).max(99999).optional().default(0),
  etaMinutesMin: z.number().int().min(0).max(300).optional().default(30),
  etaMinutesMax: z.number().int().min(0).max(300).optional().default(60),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

const zonePatchSchema = zoneBodySchema.partial();

const quoteSchema = z.object({
  zoneId: z.string().uuid(),
  subtotal: z.number().min(0),
});

const addressSchema = z.object({
  street: z.string().min(1).max(200),
  number: z.string().max(30).optional().nullable(),
  complement: z.string().max(120).optional().nullable(),
  neighborhood: z.string().max(120).optional().nullable(),
  city: z.string().min(1).max(120),
  state: z.string().max(2).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
});

const createDeliverySchema = z.object({
  zoneId: z.string().uuid(),
  customerName: z.string().min(1).max(120),
  customerPhone: z.string().max(30).optional().nullable(),
  address: addressSchema,
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

function mapDeliveryError(err) {
  if (!(err instanceof DeliveryError) && err?.code) {
    // erros de createOrder
    const code = err.code || err.message;
    if (code === 'IDEMPOTENCY_KEY_REUSED') {
      return new AppError('IDEMPOTENCY_KEY_REUSED', 'Chave já utilizada em outro contexto.', 409);
    }
    if (code === 'PRODUCT_NOT_FOUND') {
      return new AppError('PRODUCT_NOT_FOUND', 'Produto não encontrado nesta loja.', 404);
    }
    if (code === 'PRODUCT_UNAVAILABLE') {
      return new AppError('PRODUCT_UNAVAILABLE', 'Produto indisponível.', 409);
    }
    if (code === 'ORDER_EMPTY') {
      return new AppError('ORDER_EMPTY', 'Pedido sem itens.', 400);
    }
  }
  if (err instanceof DeliveryError) {
    const status =
      err.code === 'ZONE_NOT_FOUND'
        ? 404
        : err.code === 'MIN_ORDER_NOT_MET' || err.code === 'PRODUCT_UNAVAILABLE'
          ? 409
          : 400;
    return new AppError(err.code, err.message, status);
  }
  return null;
}

async function deliveryRoutes(app) {
  /** Público: listar zonas ativas da loja (tenant obrigatório) */
  app.get(
    '/api/delivery/zones',
    { preHandler: [app.requireTenant] },
    async (request) => {
      const zones = await listZones(request.storeId, { activeOnly: true });
      return { storeId: request.storeId, zones };
    }
  );

  /** Staff: listar todas as zonas (inclui inativas) */
  app.get(
    '/api/delivery/zones/admin',
    { preHandler: [app.requireTenant, app.requirePermission('delivery.zones.read')] },
    async (request) => {
      const zones = await listZones(request.storeId, { activeOnly: false });
      return { storeId: request.storeId, zones };
    }
  );

  /** Staff: criar zona */
  app.post(
    '/api/delivery/zones',
    { preHandler: [app.requireTenant, app.requirePermission('delivery.zones.write')] },
    async (request, reply) => {
      const parsed = zoneBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400, {
          issues: parsed.error.issues,
        });
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      try {
        const zone = await createZone(request.storeId, parsed.data);
        await auditRequest(request, {
          action: 'delivery.zone_created',
          resource: 'delivery_zone',
          resourceId: zone.id,
          metadata: { name: zone.name, fee: zone.fee },
        });
        return reply.code(201).send({ zone });
      } catch (err) {
        const mapped = mapDeliveryError(err);
        if (mapped) {
          const { statusCode, body } = errorResponse(mapped);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  /** Staff: atualizar zona */
  app.patch(
    '/api/delivery/zones/:id',
    { preHandler: [app.requireTenant, app.requirePermission('delivery.zones.write')] },
    async (request, reply) => {
      const parsed = zonePatchSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      try {
        const zone = await updateZone(request.storeId, request.params.id, parsed.data);
        if (!zone) {
          const err = new AppError('ZONE_NOT_FOUND', 'Zona não encontrada.', 404);
          const { statusCode, body } = errorResponse(err);
          return reply.code(statusCode).send(body);
        }
        await auditRequest(request, {
          action: 'delivery.zone_updated',
          resource: 'delivery_zone',
          resourceId: zone.id,
          metadata: { fields: Object.keys(parsed.data) },
        });
        return { zone };
      } catch (err) {
        const mapped = mapDeliveryError(err);
        if (mapped) {
          const { statusCode, body } = errorResponse(mapped);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  /** Público: cotação de taxa */
  app.post(
    '/api/delivery/quote',
    { preHandler: [app.requireTenant] },
    async (request, reply) => {
      const parsed = quoteSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      try {
        const quote = await quoteDelivery(request.storeId, parsed.data);
        return quote;
      } catch (err) {
        const mapped = mapDeliveryError(err);
        if (mapped) {
          const { statusCode, body } = errorResponse(mapped);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  /** Público: criar pedido delivery — emite a credencial do checkout.
   * Rate limit por IP espelha a entrada de mesa (60/min): criação anônima é
   * permitida, mas enumerar/inundar não. */
  app.post(
    '/api/delivery/orders',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      preHandler: [app.requireTenant],
    },
    async (request, reply) => {
      const parsed = createDeliverySchema.safeParse(request.body ?? {});
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
        const result = await createDeliveryOrder(request.storeId, {
          ...parsed.data,
          idempotencyKey,
        });

        if (!result.replayed) {
          await auditRequest(request, {
            action: 'delivery.order_created',
            resource: 'order',
            resourceId: result.order.id,
            metadata: {
              zoneId: result.delivery?.zoneId ?? null,
              // sem endereço completo: apenas bairro/cidade
              city: result.delivery?.address?.city ?? null,
              neighborhood: result.delivery?.address?.neighborhood ?? null,
              deliveryFee: result.delivery?.deliveryFee ?? null,
              items: (result.items || []).length,
            },
          });

          publishStoreOrderEvent(request.storeId, {
            type: 'order.created',
            order: {
              id: result.order.id,
              status: result.order.status,
              channel: 'DELIVERY',
              tableSessionId: null,
            },
            stations: result.stations || [],
            delivery: result.delivery
              ? {
                  customerName: result.delivery.customerName,
                  neighborhood: result.delivery.address?.neighborhood,
                  city: result.delivery.address?.city,
                  fee: result.delivery.deliveryFee,
                }
              : null,
          });
        }

        // Credencial emitida só para checkout aberto com segredo (rotação
        // revogou? o replay ainda devolve o recibo, sem credencial nova).
        let customerSession = null;
        if (
          result.credential?.checkoutToken &&
          !DELIVERY_TERMINAL_STATUSES.has(result.order.status)
        ) {
          customerSession = await issueDeliveryCheckout(
            request.storeId,
            result.order,
            result.credential
          );
        }
        noStore(reply);

        return reply.code(result.replayed ? 200 : 201).send({
          replayed: result.replayed,
          customerSession,
          order: {
            id: result.order.id,
            status: result.order.status,
            channel: result.order.channel,
            createdAt: result.order.created_at,
          },
          delivery: result.delivery,
          quote: result.quote ?? null,
          stations: result.stations || [],
          items: (result.items || []).map((it) => ({
            id: it.id,
            productName: it.product_name,
            quantity: it.quantity,
            station: it.station,
            status: it.status,
          })),
        });
      } catch (err) {
        const mapped = mapDeliveryError(err);
        if (mapped) {
          const { statusCode, body } = errorResponse(mapped);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  /** Credencial do checkout (ou staff): tracking — status do pedido + dados de entrega.
   * Antes era público por ID e vazava endereço/telefone de qualquer pedido da loja.
   * Customer só alcança o PRÓPRIO checkout (404 esconde os demais). */
  app.get(
    '/api/delivery/orders/:orderId',
    { preHandler: [app.requireCustomerOrPermission('orders.read')] },
    async (request, reply) => {
      assertDeliveryPlane(request.customer);
      if (request.customer) {
        await assertDeliveryOrderScope(
          request.customer,
          request.storeId,
          request.params.orderId
        );
        noStore(reply);
      }
      const { findOrderById, listOrderItems } = await import(
        '../orders/orders.repository.js'
      );
      const order = await findOrderById(request.storeId, request.params.orderId);
      if (!order || order.channel !== 'DELIVERY') {
        const err = new AppError('ORDER_NOT_FOUND', 'Pedido delivery não encontrado.', 404);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      const delivery = await getDeliveryByOrderId(request.storeId, order.id);
      const items = await listOrderItems(request.storeId, order.id);
      return {
        order: {
          id: order.id,
          status: order.status,
          channel: order.channel,
          notes: order.notes,
          createdAt: order.created_at,
          updatedAt: order.updated_at,
        },
        delivery,
        items: items.map((it) => ({
          id: it.id,
          productName: it.product_name,
          quantity: it.quantity,
          status: it.status,
          station: it.station,
        })),
      };
    }
  );

  /** Cancelamento — customer dono do checkout (janela/status) ou staff (orders.status.write).
   * Pedidos delivery nunca passam por /api/orders/:id/cancel: o plano de mesa é
   * barrado antes e o alvo aqui é sempre o pedido do token. */
  app.post(
    '/api/delivery/orders/:orderId/cancel',
    { preHandler: [app.requireCustomerOrPermission('orders.status.write')] },
    async (request, reply) => {
      try {
        assertDeliveryPlane(request.customer);
        if (request.customer) {
          await assertDeliveryOrderScope(
            request.customer,
            request.storeId,
            request.params.orderId
          );
          noStore(reply);
        }
        const order = request.customer
          ? await cancelOrderAsCustomer(
              request.storeId,
              request.params.orderId,
              { customer: request.customer, actor: 'customer' }
            )
          : await cancelOrderAsStaff(request.storeId, request.params.orderId);
        if (!order) {
          const err = new AppError('ORDER_NOT_FOUND', 'Pedido delivery não encontrado.', 404);
          const { statusCode, body } = errorResponse(err);
          return reply.code(statusCode).send(body);
        }

        await auditRequest(request, {
          action: 'delivery.order_cancelled',
          resource: 'order',
          resourceId: order.id,
          metadata: {
            channel: 'DELIVERY',
            actor: request.customer ? 'customer' : 'staff',
          },
        });

        publishStoreOrderEvent(request.storeId, {
          type: 'order.cancelled',
          order: {
            id: order.id,
            status: order.status,
            channel: 'DELIVERY',
            tableSessionId: null,
            cancelledAt: order.cancelled_at ?? null,
          },
        });

        return {
          order: {
            id: order.id,
            status: order.status,
            cancelledAt: order.cancelled_at,
          },
        };
      } catch (err) {
        const mapped = mapDeliveryError(err) || mapCancelError(err);
        if (mapped) {
          const { statusCode, body } = errorResponse(mapped);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  /** Staff: revoga a credencial do checkout girando o segredo interno.
   * O pedido/endereço permanecem; o cliente reativa por replay da própria
   * Idempotency-Key (mesmo comportamento do "escanear de novo" na mesa). */
  app.post(
    '/api/delivery/orders/:orderId/credential/revoke',
    {
      preHandler: [
        app.requireTenant,
        app.requirePermission('delivery.checkout.revoke'),
      ],
    },
    async (request, reply) => {
      const rotated = await rotateDeliveryCredential(
        request.storeId,
        request.params.orderId
      );
      if (!rotated) {
        const err = new AppError('ORDER_NOT_FOUND', 'Pedido delivery não encontrado.', 404);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      await auditRequest(request, {
        action: 'delivery.checkout_revoked',
        resource: 'order',
        resourceId: rotated.order_id,
        metadata: { credentialRotated: true },
      });
      return { ok: true, orderId: rotated.order_id };
    }
  );
}

export default fp(deliveryRoutes, {
  name: 'delivery-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
