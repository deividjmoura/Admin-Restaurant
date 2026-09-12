import fp from 'fastify-plugin';
import { listKitchenOrders } from '../orders/orders.repository.js';

async function kitchenRoutes(app) {
  /**
   * Active orders for the kitchen board (one store only).
   * Not realtime yet — polling or SSE comes in a follow-up (#25).
   */
  app.get(
    '/api/kitchen/orders',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request) => {
      const orders = await listKitchenOrders(request.storeId);
      return {
        storeId: request.storeId,
        orders,
      };
    }
  );
}

export default fp(kitchenRoutes, {
  name: 'kitchen-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
