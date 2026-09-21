import fp from 'fastify-plugin';
import { issueCustomerSession } from '../customer/customer-session.js';
import { z } from 'zod';
import {
  findTableByPublicToken,
  openOrGetSession,
  listTables,
  listTablesAdmin,
  createTable,
  updateTable,
  deactivateTable,
  regenerateTableToken,
  findTableById,
} from './tables.repository.js';
import { findById as findStoreById } from '../tenancy/store.repository.js';
import { auditRequest } from '../audit/audit-context.js';
import { AppError, errorResponse } from '../../shared/errors.js';

const tableBodySchema = z.object({
  number: z.number().int().positive().max(9999),
  label: z.string().max(80).optional().nullable(),
});

const tablePatchSchema = z.object({
  number: z.number().int().positive().max(9999).optional(),
  label: z.string().max(80).optional().nullable(),
  status: z.enum(['free', 'occupied']).optional(),
  isActive: z.boolean().optional(),
});

function mapTable(t) {
  return {
    id: t.id,
    number: t.number,
    label: t.label,
    publicToken: t.public_token,
    status: t.status,
    isActive: t.is_active,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

async function tablesRoutes(app) {
  /**
   * Public: resolve table by QR token and ensure an open session.
   */
  app.get(
    '/api/tables/by-token/:token',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      preHandler: [app.requireTenant],
    },
    async (request, reply) => {
      const { token } = request.params;
      const table = await findTableByPublicToken(request.storeId, token);

      if (!table) {
        const err = new AppError(
          'TABLE_NOT_FOUND',
          'Mesa não encontrada.',
          404
        );
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }

      if (request.storeId && request.storeId !== table.store_id) {
        const err = new AppError(
          'TABLE_NOT_FOUND',
          'Mesa não encontrada.',
          404
        );
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }

      const session = await openOrGetSession(table.store_id, table.id);

      // Loja resolvida PELO token da mesa (store_id da própria tabela).
      // Nunca por body/query do cliente: o QR é a única credencial aqui.
      const store = await findStoreById(table.store_id);
      if (!store) {
        const err = new AppError(
          'TABLE_NOT_FOUND',
          'Mesa não encontrada.',
          404
        );
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }

      if (session.created) {
        await auditRequest(request, {
          storeId: store.id,
          action: 'cashier.session_opened',
          resource: 'table_session',
          resourceId: session.id,
          metadata: { tableId: table.id, tableNumber: table.number },
        });
      }

      const customerSession = await issueCustomerSession(
        store.id,
        table,
        session
      );
      reply.header('Cache-Control', 'no-store');
      reply.header('Referrer-Policy', 'no-referrer');
      return {
        customerSession,
        storeId: store.id,
        storeSlug: store.slug,
        storeName: store.name,
        table: {
          id: table.id,
          number: table.number,
          label: table.label,
          publicToken: table.public_token,
          status: table.status,
        },
        session: {
          id: session.id,
          status: session.status,
          openedAt: session.opened_at,
          cartVersion: session.cart_version ?? 0,
          expired: Boolean(session.expired),
          expiredAt: session.expired_at ?? null,
        },
      };
    }
  );

  /** Staff: list active tables */
  app.get(
    '/api/tables',
    { preHandler: [app.requireTenant, app.requirePermission('tables.read')] },
    async (request) => {
      const tables = await listTables(request.storeId);
      return { tables: tables.map(mapTable) };
    }
  );

  /** Staff: list all (incl. inactive) */
  app.get(
    '/api/admin/tables',
    { preHandler: [app.requireTenant, app.requirePermission('tables.read')] },
    async (request) => {
      const tables = await listTablesAdmin(request.storeId);
      return { storeId: request.storeId, tables: tables.map(mapTable) };
    }
  );

  app.post(
    '/api/admin/tables',
    { preHandler: [app.requireTenant, app.requirePermission('tables.write')] },
    async (request, reply) => {
      const parsed = tableBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400, {
          issues: parsed.error.issues,
        });
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      try {
        const table = await createTable(request.storeId, parsed.data);
        await auditRequest(request, {
          action: 'table.created',
          resource: 'table',
          resourceId: table.id,
          metadata: { number: table.number, label: table.label },
        });
        return reply.code(201).send({ table: mapTable(table) });
      } catch (err) {
        if (err.code === 'TABLE_NUMBER_TAKEN') {
          const e = new AppError(
            'TABLE_NUMBER_TAKEN',
            'Já existe mesa com este número nesta loja.',
            409
          );
          const { statusCode, body } = errorResponse(e);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  app.patch(
    '/api/admin/tables/:id',
    { preHandler: [app.requireTenant, app.requirePermission('tables.write')] },
    async (request, reply) => {
      const parsed = tablePatchSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      try {
        const table = await updateTable(
          request.storeId,
          request.params.id,
          parsed.data
        );
        if (!table) {
          const err = new AppError(
            'TABLE_NOT_FOUND',
            'Mesa não encontrada.',
            404
          );
          const { statusCode, body } = errorResponse(err);
          return reply.code(statusCode).send(body);
        }
        await auditRequest(request, {
          action: 'table.updated',
          resource: 'table',
          resourceId: table.id,
          metadata: { fields: Object.keys(parsed.data) },
        });
        return { table: mapTable(table) };
      } catch (err) {
        if (err.code === 'TABLE_NUMBER_TAKEN') {
          const e = new AppError(
            'TABLE_NUMBER_TAKEN',
            'Já existe mesa com este número nesta loja.',
            409
          );
          const { statusCode, body } = errorResponse(e);
          return reply.code(statusCode).send(body);
        }
        if (err.code === 'INVALID_TABLE_STATUS') {
          const e = new AppError(
            'INVALID_TABLE_STATUS',
            'Status inválido.',
            400
          );
          const { statusCode, body } = errorResponse(e);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  app.delete(
    '/api/admin/tables/:id',
    { preHandler: [app.requireTenant, app.requirePermission('tables.write')] },
    async (request, reply) => {
      const existing = await findTableById(request.storeId, request.params.id);
      if (!existing) {
        const err = new AppError(
          'TABLE_NOT_FOUND',
          'Mesa não encontrada.',
          404
        );
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      const table = await deactivateTable(request.storeId, request.params.id);
      await auditRequest(request, {
        action: 'table.deleted',
        resource: 'table',
        resourceId: table.id,
        metadata: { softDelete: true, number: table.number },
      });
      return { table: mapTable(table) };
    }
  );

  /** Regenera token do QR (sticker antigo invalida) */
  app.post(
    '/api/admin/tables/:id/regenerate-token',
    { preHandler: [app.requireTenant, app.requirePermission('tables.write')] },
    async (request, reply) => {
      const table = await regenerateTableToken(
        request.storeId,
        request.params.id
      );
      if (!table) {
        const err = new AppError(
          'TABLE_NOT_FOUND',
          'Mesa não encontrada.',
          404
        );
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      await auditRequest(request, {
        action: 'table.token_regenerated',
        resource: 'table',
        resourceId: table.id,
        // o token em si NUNCA entra na auditoria
        metadata: { number: table.number },
      });
      return { table: mapTable(table) };
    }
  );
}

export default fp(tablesRoutes, {
  name: 'tables-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
