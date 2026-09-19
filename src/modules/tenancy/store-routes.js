import fp from 'fastify-plugin';
import { z } from 'zod';
import { findById, updateSettings } from './store.repository.js';
import { AppError, errorResponse } from '../../shared/errors.js';

const settingsPatchSchema = z.object({
  pix: z
    .object({
      key: z.string().min(1).max(200).optional(),
      name: z.string().min(1).max(25).optional(),
      city: z.string().min(1).max(15).optional(),
    })
    .optional(),
  timezone: z.string().max(64).optional(),
  displayName: z.string().max(120).optional(),
});

function publicSettings(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const pix = s.pix || {};
  return {
    displayName: s.displayName || null,
    timezone: s.timezone || process.env.APP_TIMEZONE || 'America/Sao_Paulo',
    pix: {
      configured: Boolean(pix.key),
      name: pix.name || null,
      city: pix.city || null,
      keyHint: pix.key
        ? pix.key.length > 4
          ? `${String(pix.key).slice(0, 2)}***${String(pix.key).slice(-2)}`
          : '***'
        : null,
    },
  };
}

function staffSettings(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  return {
    ...s,
    pix: s.pix || {},
  };
}

async function storeRoutes(app) {
  /** Público da loja (tenant): settings seguros */
  app.get(
    '/api/store',
    { preHandler: [app.requireTenant] },
    async (request, reply) => {
      const store = await findById(request.storeId);
      if (!store || store.status !== 'active') {
        const err = new AppError('STORE_NOT_FOUND', 'Loja não encontrada.', 404);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      return {
        id: store.id,
        slug: store.slug,
        name: store.name,
        settings: publicSettings(store.settings),
      };
    }
  );

  /** Staff: settings completos (inclui chave PIX) */
  app.get(
    '/api/admin/store/settings',
    { preHandler: [app.requireTenant, app.requirePermission('store.settings.read')] },
    async (request, reply) => {
      const store = await findById(request.storeId);
      if (!store) {
        const err = new AppError('STORE_NOT_FOUND', 'Loja não encontrada.', 404);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      return {
        id: store.id,
        slug: store.slug,
        name: store.name,
        status: store.status,
        settings: staffSettings(store.settings),
      };
    }
  );

  app.patch(
    '/api/admin/store/settings',
    { preHandler: [app.requireTenant, app.requirePermission('store.settings.write')] },
    async (request, reply) => {
      const parsed = settingsPatchSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400, {
          issues: parsed.error.issues,
        });
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      const store = await updateSettings(request.storeId, parsed.data);
      if (!store) {
        const err = new AppError('STORE_NOT_FOUND', 'Loja não encontrada.', 404);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      return {
        id: store.id,
        slug: store.slug,
        settings: staffSettings(store.settings),
      };
    }
  );
}

export default fp(storeRoutes, {
  name: 'store-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
