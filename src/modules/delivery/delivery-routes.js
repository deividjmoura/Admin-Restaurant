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
  DeliveryError,
} from './delivery.repository.js';
import { publishStoreOrderEvent } from '../realtime/store-events.js';
import { AppError, errorResponse } from '../../shared/errors.js';
import { auditRequest } from '../audit/audit-context.js';

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

  /** Público: criar pedido delivery */
  app.post(
    '/api/delivery/orders',
    { preHandler: [app.requireTenant] },
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

        return reply.code(result.replayed ? 200 : 201).send({
          replayed: result.replayed,
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

  /** Público/staff: tracking — status do pedido + dados de entrega */
  app.get(
    '/api/delivery/orders/:orderId',
    { preHandler: [app.requireTenant] },
    async (request, reply) => {
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
}

export default fp(deliveryRoutes, {
  name: 'delivery-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
