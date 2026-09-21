import fp from 'fastify-plugin';
import {
  verifyCustomerSession,
  assertCustomerSession,
} from './customer-session.js';
import { AppError } from '../../shared/errors.js';

async function customerPlugin(app) {
  app.decorateRequest('customer', null);
  app.decorate('requireCustomerOrPermission', function (permission) {
    return async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      await app.requireTenant(request, reply);
      if (reply.sent) return;
      const authorization = request.headers.authorization;
      if (authorization !== undefined) {
        // Explicit bearer always selects customer; invalid bearer never falls
        // back to an ambient staff cookie. The browser sends credentials:omit.
        const match = /^Bearer ([^\s]+)$/i.exec(authorization);
        if (!match)
          throw new AppError(
            'CUSTOMER_UNAUTHORIZED',
            'Credencial da mesa inválida.',
            401
          );
        if (request.session)
          throw new AppError(
            'CONTEXT_FORBIDDEN',
            'Não misture sessão staff e customer.',
            403
          );
        const customer = await verifyCustomerSession(match[1]);
        if (customer.storeId !== request.storeId)
          throw new AppError(
            'CONTEXT_FORBIDDEN',
            'Credencial incompatível com a loja.',
            403
          );
        await assertCustomerSession(customer);
        request.customer = customer;
        return;
      }
      await app.requirePermission(permission)(request, reply);
    };
  });
}
export default fp(customerPlugin, {
  name: 'customer-plugin',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
