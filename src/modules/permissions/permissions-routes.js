import fp from 'fastify-plugin';
import { z } from 'zod';
import { AppError, errorResponse } from '../../shared/errors.js';
import { PERMISSIONS } from './catalog.js';
import {
  listRolePermissions,
  setRolePermissions,
} from './permissions.repository.js';

const roleSchema = z.enum(['OWNER', 'MANAGER', 'KITCHEN', 'STAFF']);
const setPermissionsSchema = z.object({
  permissions: z.array(z.string().min(1).max(100)).min(0).max(100),
});

async function permissionsRoutes(app) {
  // List catalog (any authenticated staff can read? but restrict to OWNER/MANAGER conceptually)
  // For now requireTenant + requireStoreAccess + requirePermission('permissions.manage') for write,
  // read is allowed for any staff with at least one permission? Spec says somente OWNER for admin endpoint.
  // We'll enforce OWNER for both read/write to keep simple, plus allow MANAGER read maybe.
  // Acceptance: Endpoint de consulta por tenant/loja — somente OWNER.
  // So we enforce requirePermission('permissions.manage') which only OWNER has by default.

  app.get(
    '/api/admin/permissions',
    { preHandler: [app.requireTenant, app.requirePermission('permissions.manage')] },
    async (request) => {
      return {
        storeId: request.storeId,
        permissions: PERMISSIONS,
      };
    }
  );

  app.get(
    '/api/admin/roles/:role/permissions',
    { preHandler: [app.requireTenant, app.requirePermission('permissions.manage')] },
    async (request, reply) => {
      const parsed = roleSchema.safeParse(request.params.role);
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Papel inválido. Use OWNER, MANAGER, KITCHEN ou STAFF.', 400);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      const role = parsed.data;
      const perms = await listRolePermissions(request.storeId, role);
      return {
        storeId: request.storeId,
        role,
        permissions: perms.map((p) => p.key),
        details: perms,
      };
    }
  );

  app.put(
    '/api/admin/roles/:role/permissions',
    { preHandler: [app.requireTenant, app.requirePermission('permissions.manage')] },
    async (request, reply) => {
      const parsedRole = roleSchema.safeParse(request.params.role);
      if (!parsedRole.success) {
        const err = new AppError('VALIDATION_ERROR', 'Papel inválido.', 400);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      const role = parsedRole.data;
      const parsedBody = setPermissionsSchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload inválido. Esperado { permissions: string[] }', 400, { issues: parsedBody.error.issues });
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }

      try {
        const keys = await setRolePermissions(request.storeId, role, parsedBody.data.permissions);
        return {
          storeId: request.storeId,
          role,
          permissions: keys,
        };
      } catch (err) {
        if (err.code === 'UNKNOWN_PERMISSION') {
          const e = new AppError('UNKNOWN_PERMISSION', `Permissão desconhecida: ${err.permissionKey}`, 400);
          const { statusCode, body } = errorResponse(e);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );
}

export default fp(permissionsRoutes, {
  name: 'permissions-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
