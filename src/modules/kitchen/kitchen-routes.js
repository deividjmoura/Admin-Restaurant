import fp from 'fastify-plugin';
import { listStationOrders } from '../orders/orders.repository.js';
import { subscribeStoreOrders } from '../realtime/store-events.js';
import { AppError, errorResponse } from '../../shared/errors.js';

function parseStation(queryStation) {
  const s = String(queryStation || 'KITCHEN').toUpperCase();
  if (s !== 'KITCHEN' && s !== 'BAR') return null;
  return s;
}

async function kitchenRoutes(app) {
  /**
   * Painel por estação.
   * GET /api/kitchen/orders?station=KITCHEN
   * GET /api/kitchen/orders?station=BAR
   */
  app.get(
    '/api/kitchen/orders',
    { config: { allowTenantQuery: true }, preHandler: [app.requireTenant, app.requirePermission('kitchen.orders.read')] },
    async (request, reply) => {
      const station = parseStation(request.query?.station);
      if (!station) {
        const err = new AppError(
          'INVALID_STATION',
          'Use station=KITCHEN ou station=BAR.',
          400
        );
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }

      const orders = await listStationOrders(request.storeId, { station });
      return {
        storeId: request.storeId,
        station,
        orders,
      };
    }
  );

  /**
   * SSE filtrado por estação.
   * GET /api/kitchen/events?station=KITCHEN
   * GET /api/kitchen/events?station=BAR
   */
  app.get(
    '/api/kitchen/events',
    { config: { allowTenantQuery: true }, preHandler: [app.requireTenant, app.requirePermission('kitchen.orders.read')] },
    async (request, reply) => {
      const station = parseStation(request.query?.station);
      if (!station) {
        const err = new AppError(
          'INVALID_STATION',
          'Use station=KITCHEN ou station=BAR.',
          400
        );
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }

      const storeId = request.storeId;

      // Diagnóstico/handshake: devolve o tenant resolvido sem abrir o stream.
      // Mantém a rota testável (SSE hijacka a resposta) e permite ao front
      // confirmar o canal antes de assinar.
      if (request.query?.probe === '1') {
        return { storeId, station, channel: `store:${storeId}:orders:${station}` };
      }

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
        channel: `store:${storeId}:orders:${station}`,
        storeId,
        station,
      });

      const unsubscribe = subscribeStoreOrders(storeId, (payload) => {
        const stations = payload.stations || [];
        // Eventos sem stations (ex. status global) → enviam para as duas estações
        if (stations.length > 0 && !stations.includes(station)) return;
        send(payload.type || 'order', { ...payload, stationFilter: station });
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
