import fp from 'fastify-plugin';
import {
  findTableByPublicToken,
  openOrGetSession,
  listTables,
} from './tables.repository.js';
import { AppError, errorResponse } from '../../shared/errors.js';

async function tablesRoutes(app) {
  /**
   * Public: resolve table by QR token and ensure an open session.
   * Token is global unique; we still verify store matches tenant when present.
   */
  app.get('/api/tables/by-token/:token', async (request, reply) => {
    const { token } = request.params;
    const table = await findTableByPublicToken(token);

    if (!table) {
      const err = new AppError('TABLE_NOT_FOUND', 'Mesa não encontrada.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    // If tenant was resolved (subdomain), it must match the table's store
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

  /** Staff: list tables for current tenant */
  app.get(
    '/api/tables',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request) => {
      const tables = await listTables(request.storeId);
      return {
        tables: tables.map((t) => ({
          id: t.id,
          number: t.number,
          label: t.label,
          publicToken: t.public_token,
          status: t.status,
        })),
      };
    }
  );
}

export default fp(tablesRoutes, {
  name: 'tables-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
