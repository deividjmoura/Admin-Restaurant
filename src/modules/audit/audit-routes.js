import fp from 'fastify-plugin';
import { AppError, errorResponse } from '../../shared/errors.js';
import { listAuditLogsForStore } from './audit.repository.js';

async function auditRoutes(app) {
  app.get(
    '/api/admin/audit-logs',
    { preHandler: [app.requireTenant, app.requirePermission('audit.read')] },
    async (request, reply) => {
      // audit.read is intentionally available in the catalog for future policy
      // changes, but audit data is currently restricted to the tenant OWNER.
      if (request.storeRole !== 'OWNER') {
        const err = new AppError('FORBIDDEN', 'Only the store owner may read audit logs.', 403);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      const q = request.query ?? {};
      return {
        storeId: request.storeId,
        logs: await listAuditLogsForStore(request.storeId, {
          limit: q.limit,
          offset: q.offset,
          action: q.action,
          resource: q.resource,
          from: q.from,
          to: q.to,
        }),
      };
    }
  );
}

export default fp(auditRoutes, {
  name: 'audit-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
