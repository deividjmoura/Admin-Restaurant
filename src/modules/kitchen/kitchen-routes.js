import fp from 'fastify-plugin';
import { listStationOrders } from '../orders/orders.repository.js';
import {
  subscribeStoreOrders,
  canReceiveEvent,
} from '../realtime/store-events.js';
import { listRolePermissions } from '../permissions/permissions.repository.js';
import { FALLBACK_MATRIX } from '../permissions/catalog.js';
import { AppError, errorResponse } from '../../shared/errors.js';

function parseStation(queryStation) {
  const s = String(queryStation || 'KITCHEN').toUpperCase();
  if (s !== 'KITCHEN' && s !== 'BAR') return null;
  return s;
}

/**
 * Permissões efetivas do assinante para a loja, com o mesmo fallback do
 * requirePermission (loja sem role_permissions semeado usa a matriz do código).
 */
async function loadSubscriberPermissions(request, storeId) {
  const role = request.storeRole || 'OWNER';
  const set = new Set();
  try {
    const rows = await listRolePermissions(storeId, role);
    for (const r of rows) set.add(r.key);
    if (rows.length === 0) {
      for (const k of FALLBACK_MATRIX[role] || []) set.add(k);
    }
  } catch {
    for (const k of FALLBACK_MATRIX[role] || []) set.add(k);
  }
  return set;
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

      const limit = Number(request.query?.limit) || 100;
      const orders = await listStationOrders(request.storeId, {
        station,
        limit,
      });
      return {
        storeId: request.storeId,
        station,
        limit: Math.min(Math.max(limit, 1), 200),
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
        const channel = `store:${storeId}:orders:${station}`;
        return {
          storeId,
          station,
          channel,
          resolvedChannel: channel,
        };
      }

      // Permissões do assinante decidem quais tipos de evento podem ser
      // entregues (payment.* só com payments.read; session.closed só com
      // cashier.sessions.read). Nunca confiamos no filtro do cliente.
      const permissions = await loadSubscriberPermissions(
        request,
        storeId
      );

      // Latência de stream não pertence ao histograma HTTP (conexão fica aberta
      // por horas): o onResponse observa como `stream: true`.
      request.isStream = true;
      reply.hijack();

      // Preserva os headers já calculados (CORS, Helmet, …) e só então
      // sobrescreve o que é específico de SSE.
      reply.raw.writeHead(200, {
        ...reply.getHeaders(),
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
        // Filtro por tenant + estação + permissão, sempre no servidor.
        if (
          !canReceiveEvent(payload, {
            storeId,
            station,
            permissions,
          })
        ) {
          return;
        }
        send(payload.type || 'order', { ...payload, stationFilter: station });
      }, { station });

      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(`: ping ${Date.now()}\n\n`);
        } catch {
          clearInterval(heartbeat);
        }
      }, 25000);

      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      };

      request.raw.on('close', cleanup);
      request.raw.on('error', (err) => {
        // Stream é conexão longa: o erro de socket precisa aparecer no log com
        // o contexto da loja (issue #106) — sem isso a cozinha "cai" em silêncio.
        request.log?.warn(
          { err, event: 'sse.stream_error', storeId, station },
          'sse stream error'
        );
        cleanup();
      });
    }
  );
}

export default fp(kitchenRoutes, {
  name: 'kitchen-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
