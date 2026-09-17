import fp from 'fastify-plugin';
import { z } from 'zod';
import { AppError, errorResponse } from '../../shared/errors.js';
import { getOrCreateWallet, listWallets, transact, listTransactions, getWallet, WalletError } from './wallets.repository.js';

const transactSchema = z.object({
  userId: z.string().uuid(),
  type: z.enum(['credit', 'debit']),
  amount: z.number().positive(),
  description: z.string().max(200).optional().nullable(),
  idempotencyKey: z.string().min(8).max(128).optional().nullable(),
});

function mapWalletError(err) {
  if (!(err instanceof WalletError)) return null;
  const status = err.code === 'INSUFFICIENT_FUNDS' ? 409 : err.code === 'WALLET_NOT_FOUND' ? 404 : 400;
  return new AppError(err.code, err.message, status);
}

async function walletsRoutes(app) {
  // Admin: listar carteiras da loja
  app.get(
    '/api/wallets',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request) => {
      const wallets = await listWallets(request.storeId);
      return { storeId: request.storeId, wallets };
    }
  );

  // Admin ou dono: ver/criar carteira de um usuário
  app.get(
    '/api/wallets/:userId',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request) => {
      const wallet = await getOrCreateWallet(request.storeId, request.params.userId);
      return { wallet };
    }
  );

  // Transacionar (credit/debit) com idempotência
  app.post(
    '/api/wallets/transact',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request, reply) => {
      const parsed = transactSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400, { issues: parsed.error.issues });
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }
      const headerKey = request.headers['idempotency-key'];
      const idempotencyKey = (typeof headerKey === 'string' && headerKey.trim()) || parsed.data.idempotencyKey || null;
      try {
        const result = await transact(request.storeId, {
          userId: parsed.data.userId,
          type: parsed.data.type,
          amount: parsed.data.amount,
          description: parsed.data.description,
          idempotencyKey,
        });
        return reply.code(result.replayed ? 200 : 201).send(result);
      } catch (err) {
        const mapped = mapWalletError(err);
        if (mapped) {
          const { statusCode, body } = errorResponse(mapped);
          return reply.code(statusCode).send(body);
        }
        throw err;
      }
    }
  );

  // Listar transações
  app.get(
    '/api/wallets/:walletId/transactions',
    { preHandler: [app.requireTenant, app.requireStoreAccess] },
    async (request) => {
      const txs = await listTransactions(request.storeId, { walletId: request.params.walletId });
      return { transactions: txs };
    }
  );
}

export default fp(walletsRoutes, {
  name: 'wallets-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
