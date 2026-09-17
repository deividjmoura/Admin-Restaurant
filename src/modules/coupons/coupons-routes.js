import fp from 'fastify-plugin';
import { z } from 'zod';
import { AppError, errorResponse } from '../../shared/errors.js';
import {
  listCoupons,
  createCoupon,
  updateCoupon,
  findCouponById,
  validateCoupon,
  CouponError,
} from './coupons.repository.js';

const createSchema = z.object({
  code: z.string().min(3).max(20),
  discountType: z.enum(['percentage', 'fixed']),
  discountValue: z.number().positive(),
  minOrderAmount: z.number().min(0).optional().default(0),
  maxUses: z.number().int().positive().optional().nullable(),
  validFrom: z.string().datetime().optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

const patchSchema = createSchema.partial();

const validateSchema = z.object({
  code: z.string().min(3).max(20),
  orderAmount: z.number().min(0).optional().default(0),
});

function mapCouponError(err) {
  if (!(err instanceof CouponError)) return null;
  const status =
    err.code === 'COUPON_NOT_FOUND' ? 404 :
    err.code === 'CODE_TAKEN' ? 409 :
    err.code.startsWith('COUPON_') || err.code === 'MIN_ORDER_NOT_MET' ? 409 :
    400;
  return new AppError(err.code, err.message, status);
}

async function couponsRoutes(app) {
  // Admin: listar
  app.get(
    '/api/coupons',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request) => {
      const coupons = await listCoupons(request.storeId, { activeOnly: false });
      return { storeId: request.storeId, coupons };
    }
  );

  // Cliente: validar cupom (público, mas tenant obrigatório)
  app.post(
    '/api/coupons/validate',
    { preHandler: [app.requireTenant] },
    async (request, reply) => {
      const parsed = validateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400, { issues: parsed.error.issues });
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      try {
        const result = await validateCoupon(request.storeId, parsed.data.code, { orderAmount: parsed.data.orderAmount });
        return result;
      } catch (err) {
        const mapped = mapCouponError(err);
        if (mapped) {
          const { statusCode, body } = errorResponse(mapped);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  // Admin: criar
  app.post(
    '/api/coupons',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request, reply) => {
      const parsed = createSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400, { issues: parsed.error.issues });
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      try {
        const coupon = await createCoupon(request.storeId, parsed.data);
        return reply.code(201).send({ coupon });
      } catch (err) {
        const mapped = mapCouponError(err);
        if (mapped) {
          const { statusCode, body } = errorResponse(mapped);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  // Admin: atualizar
  app.patch(
    '/api/coupons/:id',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request, reply) => {
      const parsed = patchSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      try {
        const coupon = await updateCoupon(request.storeId, request.params.id, parsed.data);
        if (!coupon) {
          const err = new AppError('COUPON_NOT_FOUND', 'Cupom não encontrado.', 404);
          const { statusCode, body } = errorResponse(err);
          return reply.code(statusCode).send(body);
        }
        return { coupon };
      } catch (err) {
        const mapped = mapCouponError(err);
        if (mapped) {
          const { statusCode, body } = errorResponse(mapped);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  // Admin: detalhe
  app.get(
    '/api/coupons/:id',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request, reply) => {
      const coupon = await findCouponById(request.storeId, request.params.id);
      if (!coupon) {
        const err = new AppError('COUPON_NOT_FOUND', 'Cupom não encontrado.', 404);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      return { coupon };
    }
  );
}

export default fp(couponsRoutes, {
  name: 'coupons-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
