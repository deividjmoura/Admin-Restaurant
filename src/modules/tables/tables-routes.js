import fp from 'fastify-plugin';
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
import { AppError, errorResponse } from '../../shared/errors.js';
import { ROLE_MATRIX } from '../auth/auth-plugin.js';

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
  const staffAny = {
    preHandler: [
      app.requireTenant,
      app.requireStoreAccess,
      app.requireRole(...ROLE_MATRIX['tables.list']),
    ],
  };

  const adminTables = {
    preHandler: [
      app.requireTenant,
      app.requireStoreAccess,
      app.requireRole(...ROLE_MATRIX['admin.tables']),
    ],
  };

  /**
   * Public: resolve table by QR token and ensure an open session.
   */
  app.get('/api/tables/by-token/:token', async (request, reply) => {
    const { token } = request.params;
    const table = await findTableByPublicToken(token);

    if (!table) {
      const err = new AppError('TABLE_NOT_FOUND', 'Mesa não encontrada.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    if (request.storeId && request.storeId !== table.store_id) {
      const err = new AppError('TABLE_NOT_FOUND', 'Mesa não encontrada.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    const session = await openOrGetSession(table.store_id, table.id);

    return {
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
      },
      storeId: table.store_id,
    };
  });

  /** Staff: list active tables */
  app.get('/api/tables', staffAny, async (request) => {
    const tables = await listTables(request.storeId);
    return { tables: tables.map(mapTable) };
  });

  /** Staff: list all (incl. inactive) */
  app.get('/api/admin/tables', adminTables, async (request) => {
    const tables = await listTablesAdmin(request.storeId);
    return { storeId: request.storeId, tables: tables.map(mapTable) };
  });

  app.post('/api/admin/tables', adminTables, async (request, reply) => {
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
  });

  app.patch('/api/admin/tables/:id', adminTables, async (request, reply) => {
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
        const err = new AppError('TABLE_NOT_FOUND', 'Mesa não encontrada.', 404);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
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
        const e = new AppError('INVALID_TABLE_STATUS', 'Status inválido.', 400);
        const { statusCode, body } = errorResponse(e);
        return reply.code(statusCode).send(body);
      }
      throw err;
    }
  });

  app.delete('/api/admin/tables/:id', adminTables, async (request, reply) => {
    const existing = await findTableById(request.storeId, request.params.id);
    if (!existing) {
      const err = new AppError('TABLE_NOT_FOUND', 'Mesa não encontrada.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }
    const table = await deactivateTable(request.storeId, request.params.id);
    return { table: mapTable(table) };
  });

  /** Regenera token do QR (sticker antigo invalida) */
  app.post(
    '/api/admin/tables/:id/regenerate-token',
    adminTables,
    async (request, reply) => {
      const table = await regenerateTableToken(
        request.storeId,
        request.params.id
      );
      if (!table) {
        const err = new AppError('TABLE_NOT_FOUND', 'Mesa não encontrada.', 404);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      return { table: mapTable(table) };
    }
  );
}

export default fp(tablesRoutes, {
  name: 'tables-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
