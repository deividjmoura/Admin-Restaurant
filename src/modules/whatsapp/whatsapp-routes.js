import fp from 'fastify-plugin';
import { z } from 'zod';
import { AppError, errorResponse } from '../../shared/errors.js';
import { saveMessage, listMessages, parseOrderFromText } from './whatsapp.repository.js';

const webhookSchema = z.object({
  from: z.string().min(5).max(30),
  body: z.string().min(1).max(2000),
  externalId: z.string().min(3).max(100).optional(),
  id: z.string().min(3).max(100).optional(),
});

async function whatsappRoutes(app) {
  // Webhook público (verificado por tenant via query ?tenant= ou header X-Tenant-Slug)
  // Para sandbox, aceita sem assinatura; em prod, verificar via WHATSAPP_WEBHOOK_SECRET
  app.post(
    '/api/whatsapp/webhook',
    { preHandler: [app.requireTenant] },
    async (request, reply) => {
      const parsed = webhookSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload WhatsApp inválido.', 400, { issues: parsed.error.issues });
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }

      const externalId = parsed.data.externalId || parsed.data.id || `wa_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      const fromNumber = parsed.data.from;
      const text = parsed.data.body;

      // Busca cardápio para IA mock (opcional)
      let menuProducts = [];
      try {
        const { query } = await import('../../infrastructure/db.js');
        const { rows } = await query(`SELECT id, name FROM products WHERE store_id = $1 AND is_active = TRUE LIMIT 50`, [request.storeId]);
        menuProducts = rows;
      } catch {}

      const parsedOrder = parseOrderFromText(text, menuProducts);

      // Se OPENAI_API_KEY configurado, tentaria IA real aqui (mock por enquanto)
      const provider = process.env.OPENAI_API_KEY ? 'openai' : 'mock';

      const msg = await saveMessage(request.storeId, {
        externalId,
        fromNumber,
        body: text,
        parsedPayload: { parsedOrder, provider },
        status: parsedOrder.items.length ? 'parsed' : 'received',
      });

      // Se parse encontrou itens e não é mock puro, tenta criar pedido delivery automaticamente (opcional)
      let order = null;
      if (parsedOrder.items.length && parsedOrder.items[0].productId) {
        try {
          const { createDeliveryOrder } = await import('../delivery/delivery.repository.js');
          // Usa primeira zona ativa da loja como fallback para WhatsApp
          const { query } = await import('../../infrastructure/db.js');
          const { rows: zones } = await query(`SELECT id FROM delivery_zones WHERE store_id = $1 AND is_active = TRUE ORDER BY sort_order LIMIT 1`, [request.storeId]);
          if (zones[0]) {
            const res = await createDeliveryOrder(request.storeId, {
              zoneId: zones[0].id,
              customerName: fromNumber,
              customerPhone: fromNumber,
              address: { street: 'WhatsApp', city: 'WhatsApp' },
              notes: `WhatsApp: ${text.slice(0, 200)}`,
              idempotencyKey: `wa_${externalId}`,
              items: parsedOrder.items.filter((i) => i.productId).map((i) => ({ productId: i.productId, quantity: i.quantity })),
            });
            order = res.order;
            await saveMessage(request.storeId, { externalId, fromNumber, body: text, parsedPayload: { parsedOrder, provider, orderId: order.id }, status: 'order_created' });
          }
        } catch {}
      }

      return { ok: true, message: msg, parsed: parsedOrder, order: order ? { id: order.id, status: order.status } : null };
    }
  );

  // Admin: listar mensagens
  app.get(
    '/api/whatsapp/messages',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request) => {
      const msgs = await listMessages(request.storeId, { limit: request.query?.limit });
      return { storeId: request.storeId, messages: msgs };
    }
  );
}

export default fp(whatsappRoutes, {
  name: 'whatsapp-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
