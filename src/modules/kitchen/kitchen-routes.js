import fp from 'fastify-plugin';
import { listKitchenOrders } from '../orders/orders.repository.js';
import { subscribeStoreOrders } from '../realtime/store-events.js';

async function kitchenRoutes(app) {
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

  /**
   * Server-Sent Events — channel store:{storeId}:orders
   * Auth + tenant required so one kitchen never receives another store's events.
   */
  app.get(
    '/api/kitchen/events',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request, reply) => {
      const storeId = request.storeId;

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const send = (event, data) => {
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      send('connected', {
        channel: `store:${storeId}:orders`,
        storeId,
      });

      const unsubscribe = subscribeStoreOrders(storeId, (payload) => {
        send(payload.type || 'order', payload);
      });

      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(`: ping ${Date.now()}\n\n`);
        } catch {
          clearInterval(heartbeat);
        }
      }, 25000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };

      request.raw.on('close', cleanup);
      request.raw.on('error', cleanup);
    }
  );
}

export default fp(kitchenRoutes, {
  name: 'kitchen-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
