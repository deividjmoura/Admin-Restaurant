import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  createCustomer,
  findCustomerById,
  listCustomers,
  listCustomerOrders,
} from './customers.repository.js';
import { canContact, grantConsent, revokeConsent } from './consent.js';
import { AppError, errorResponse } from '../../shared/errors.js';

const customerBody = z.object({
  name: z.string().max(120).optional().nullable(),
  contact: z.string().max(80).optional().nullable(),
});

const consentBody = z.object({
  purpose: z.string().min(1).max(64),
  granted: z.boolean().optional().default(true),
});

async function crmRoutes(app) {
  app.get(
    '/api/customers',
    { preHandler: [app.requireTenant, app.requirePermission('customers.read')] },
    async (request) => {
      const customers = await listCustomers(request.storeId, {
        contact: request.query?.contact || null,
      });
      return { storeId: request.storeId, customers };
    }
  );

  app.post(
    '/api/customers',
    { preHandler: [app.requireTenant, app.requirePermission('customers.write')] },
    async (request, reply) => {
      const parsed = customerBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      const customer = await createCustomer(request.storeId, parsed.data);
      return reply.code(201).send({ customer });
    }
  );

  app.get(
    '/api/customers/:id',
    { preHandler: [app.requireTenant, app.requirePermission('customers.read')] },
    async (request, reply) => {
      const customer = await findCustomerById(request.storeId, request.params.id);
      if (!customer) {
        const err = new AppError('CUSTOMER_NOT_FOUND', 'Cliente não encontrado.', 404);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      const orders = await listCustomerOrders(request.storeId, customer.id);
      return { customer, orders };
    }
  );

  app.post(
    '/api/customers/:id/consents',
    { preHandler: [app.requireTenant, app.requirePermission('customers.write')] },
    async (request, reply) => {
      const parsed = consentBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      const row = await grantConsent(
        request.storeId,
        request.params.id,
        parsed.data.purpose,
        parsed.data.granted
      );
      if (!row) {
        const err = new AppError('CUSTOMER_NOT_FOUND', 'Cliente não encontrado.', 404);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      return reply.code(201).send({ consent: row });
    }
  );

  app.delete(
    '/api/customers/:id/consents/:purpose',
    { preHandler: [app.requireTenant, app.requirePermission('customers.write')] },
    async (request, reply) => {
      const n = await revokeConsent(
        request.storeId,
        request.params.id,
        request.params.purpose
      );
      return reply.code(200).send({ revoked: n });
    }
  );

  app.get(
    '/api/customers/:id/can-contact',
    { preHandler: [app.requireTenant, app.requirePermission('customers.read')] },
    async (request, reply) => {
      const purpose = String(request.query?.purpose || '');
      if (!purpose) {
        const err = new AppError('VALIDATION_ERROR', 'purpose é obrigatório.', 400);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      const allowed = await canContact(request.storeId, request.params.id, purpose);
      return { allowed, purpose };
    }
  );
}

export default fp(crmRoutes, {
  name: 'crm-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
