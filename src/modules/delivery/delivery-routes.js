import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  listZones,
  createZone,
  updateZone,
  quoteDelivery,
  createDeliveryOrder,
  getDeliveryByOrderId,
  listDeliveryOrders,
  updateCourierStatus,
  DeliveryError,
  COURIER_TRANSITIONS,
} from './delivery.repository.js';
import { publishStoreOrderEvent } from '../realtime/store-events.js';
import { AppError, errorResponse } from '../../shared/errors.js';

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

const courierStatusSchema = z.object({
  courierStatus: z.enum([
    'PENDING',
    'CONFIRMED',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'CANCELLED',
  ]),
});

function mapDeliveryError(err) {
  if (!(err instanceof DeliveryError) && err?.code) {
    const code = err.code || err.message;
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
      err.code === 'ZONE_NOT_FOUND' || err.code === 'ORDER_NOT_FOUND'
        ? 404
        : err.code === 'MIN_ORDER_NOT_MET' ||
            err.code === 'PRODUCT_UNAVAILABLE' ||
            err.code === 'INVALID_COURIER_TRANSITION'
          ? 409
          : 400;
    return new AppError(err.code, err.message, status);
  }
  return null;
}

async function deliveryRoutes(app) {
  app.get(
    '/api/delivery/zones',
    { preHandler: [app.requireTenant] },
    async (request) => {
      const zones = await listZones(request.storeId, { activeOnly: true });
      return { storeId: request.storeId, zones };
    }
  );

  app.get(
    '/api/delivery/zones/admin',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request) => {
      const zones = await listZones(request.storeId, { activeOnly: false });
      return { storeId: request.storeId, zones };
    }
  );

  app.post(
    '/api/delivery/zones',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
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

  app.patch(
    '/api/delivery/zones/:id',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
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
        return await quoteDelivery(request.storeId, parsed.data);
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
                  courierStatus: result.delivery.courierStatus,
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

  /** Staff: listar pedidos delivery ativos */
  app.get(
    '/api/delivery/orders',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request) => {
      const orders = await listDeliveryOrders(request.storeId, {
        courierStatus: request.query?.courierStatus || null,
        limit: request.query?.limit,
      });
      return { storeId: request.storeId, orders };
    }
  );

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
        courierTransitions: delivery
          ? COURIER_TRANSITIONS[delivery.courierStatus] || []
          : [],
      };
    }
  );

  /** Staff: avançar status do entregador */
  app.patch(
    '/api/delivery/orders/:orderId/courier-status',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request, reply) => {
      const parsed = courierStatusSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      try {
        const delivery = await updateCourierStatus(
          request.storeId,
          request.params.orderId,
          parsed.data.courierStatus
        );
        publishStoreOrderEvent(request.storeId, {
          type: 'delivery.courier_status_changed',
          orderId: request.params.orderId,
          courierStatus: delivery.courierStatus,
        });
        return { delivery };
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
}

export default fp(deliveryRoutes, {
  name: 'delivery-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
