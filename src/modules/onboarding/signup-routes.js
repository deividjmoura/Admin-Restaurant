import fp from 'fastify-plugin';
import { z } from 'zod';
import { withTransaction } from '../../infrastructure/db.js';
import * as storeRepo from '../tenancy/store.repository.js';
import { findUserByEmail, createUser, addStoreUser } from '../auth/user.repository.js';
import { hashPassword } from '../auth/password.js';
import { createCategory } from '../menu/menu.repository.js';
import { createTable } from '../tables/tables.repository.js';
import { writeAuditLog } from '../audit/index.js';
import { AppError, errorResponse } from '../../shared/errors.js';
import {
  createEmailVerification,
  findValidVerification,
  markVerificationUsed,
  markEmailVerified,
  invalidatePendingVerifications,
  isSlugReserved,
} from './onboarding.repository.js';

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const signupSchema = z.object({
  storeName: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(63)
    .regex(SLUG_PATTERN, 'Slug deve conter apenas letras minúsculas, números e hífen.'),
  ownerName: z.string().trim().min(2).max(120),
  ownerEmail: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});

const verifySchema = z.object({
  token: z.string().min(10).max(200),
});

const resendSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

/**
 * Envia o e-mail de verificação.
 * Não há provider de e-mail integrado ainda (ver issue #59/backlog de infra):
 * por ora, registramos via audit log. Em desenvolvimento, o token também
 * volta na resposta HTTP para permitir testar o fluxo sem inbox real.
 */
async function deliverVerificationEmail({ storeId, userId, email, rawToken, request }) {
  writeAuditLog({
    storeId,
    actorUserId: userId,
    action: 'onboarding.verification_email_queued',
    resource: 'user',
    resourceId: userId,
    metadata: { email },
    ip: request.ip,
    userAgent: request.headers['user-agent'] || null,
  }).catch((err) => {
    request.log?.warn({ err }, 'audit log failed on signup verification');
  });

  // TODO(#59-infra): substituir por provider real (ex.: Resend, SES) quando
  // o módulo de notificações transacionais existir.
  request.log?.info({ email }, '[onboarding] verification email queued (no provider configured)');

  return process.env.NODE_ENV === 'production' ? undefined : rawToken;
}

async function signupRoutes(app) {
  /**
   * Cadastro público de uma nova loja + owner.
   * Cria store em status 'pending' — só ativa após verificação de e-mail.
   */
  app.post('/api/signup', async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const err = new AppError('VALIDATION_ERROR', 'Payload de cadastro inválido.', 400, {
        issues: parsed.error.issues,
      });
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    const { storeName, slug, ownerName, ownerEmail, password } = parsed.data;

    if (await isSlugReserved(slug)) {
      const err = new AppError('SLUG_RESERVED', 'Este identificador de loja não está disponível.', 409);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    const [existingStore, existingUser] = await Promise.all([
      storeRepo.findBySlug(slug),
      findUserByEmail(ownerEmail),
    ]);

    if (existingStore) {
      const err = new AppError('SLUG_TAKEN', 'Já existe uma loja com este identificador.', 409);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    if (existingUser) {
      const err = new AppError('EMAIL_TAKEN', 'Já existe uma conta com este e-mail.', 409);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    const passwordHash = await hashPassword(password);

    // Tudo isolado numa transação: store + owner + vínculo + seed mínimo
    // nascem juntos, ou nada nasce (evita tenant "fantasma" sem owner).
    const result = await withTransaction(async (client) => {
      const storeRes = await client.query(
        `INSERT INTO stores (slug, name, status, settings)
         VALUES ($1, $2, 'pending', $3::jsonb)
         RETURNING id, slug, name, status, created_at`,
        [
          slug,
          storeName,
          JSON.stringify({ timezone: process.env.APP_TIMEZONE || 'America/Sao_Paulo', currency: 'BRL' }),
        ]
      );
      const store = storeRes.rows[0];

      const userRes = await client.query(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, $2, $3)
         RETURNING id, email, name, is_super_admin, is_active, created_at`,
        [ownerEmail, passwordHash, ownerName]
      );
      const user = userRes.rows[0];

      await client.query(
        `INSERT INTO store_users (store_id, user_id, role)
         VALUES ($1, $2, 'OWNER')`,
        [store.id, user.id]
      );

      // Seed mínimo: uma categoria vazia e uma mesa de exemplo, para o
      // owner cair num painel já com algo pra editar (não vazio de todo).
      const categoryRes = await client.query(
        `INSERT INTO categories (store_id, name, sort_order)
         VALUES ($1, 'Cardápio', 1)
         RETURNING id`,
        [store.id]
      );

      await client.query(
        `INSERT INTO tables (store_id, number, label)
         VALUES ($1, 1, 'Mesa 1')`,
        [store.id]
      );

      return { store, user, seedCategoryId: categoryRes.rows[0].id };
    });

    const { rawToken, expiresAt } = await createEmailVerification({
      storeId: result.store.id,
      userId: result.user.id,
    });

    const devToken = await deliverVerificationEmail({
      storeId: result.store.id,
      userId: result.user.id,
      email: result.user.email,
      rawToken,
      request,
    });

    return reply.code(201).send({
      store: {
        id: result.store.id,
        slug: result.store.slug,
        name: result.store.name,
        status: result.store.status,
      },
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
      },
      verification: {
        required: true,
        expiresAt,
        // Só presente fora de produção — conveniência de teste local.
        ...(devToken ? { devToken } : {}),
      },
    });
  });

  /**
   * Confirma o e-mail do owner. Ativa a store se ainda estiver 'pending'.
   */
  app.post('/api/signup/verify', async (request, reply) => {
    const parsed = verifySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const err = new AppError('VALIDATION_ERROR', 'Token de verificação inválido.', 400);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    const verification = await findValidVerification(parsed.data.token);
    if (!verification) {
      const err = new AppError(
        'VERIFICATION_INVALID',
        'Token de verificação inválido, expirado ou já usado.',
        400
      );
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    await markVerificationUsed(verification.id);
    const user = await markEmailVerified(verification.user_id);

    let store = await storeRepo.findById(verification.store_id);
    if (store && store.status === 'pending') {
      store = await storeRepo.updateStatus(store.id, 'active');
    }

    writeAuditLog({
      storeId: verification.store_id,
      actorUserId: verification.user_id,
      action: 'onboarding.email_verified',
      resource: 'user',
      resourceId: verification.user_id,
      metadata: { storeActivated: store?.status === 'active' },
      ip: request.ip,
      userAgent: request.headers['user-agent'] || null,
    }).catch((err) => {
      request.log?.warn({ err }, 'audit log failed on signup verify');
    });

    return {
      verified: true,
      user: user ? { id: user.id, email: user.email } : null,
      store: store ? { id: store.id, slug: store.slug, status: store.status } : null,
    };
  });

  /**
   * Reenvia o e-mail de verificação. Resposta genérica sempre que possível
   * para não revelar se um e-mail existe na base (evita enumeração).
   */
  app.post('/api/signup/resend', async (request, reply) => {
    const parsed = resendSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const err = new AppError('VALIDATION_ERROR', 'E-mail inválido.', 400);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    const user = await findUserByEmail(parsed.data.email);
    const generic = { ok: true, message: 'Se o e-mail existir, um novo link foi enviado.' };

    if (!user || user.email_verified_at) {
      return generic;
    }

    const memberships = await import('../auth/user.repository.js').then((m) =>
      m.listStoreMemberships(user.id)
    );
    const ownerMembership = memberships.find((m) => m.role === 'OWNER');
    if (!ownerMembership) return generic;

    await invalidatePendingVerifications(user.id);
    const { rawToken, expiresAt } = await createEmailVerification({
      storeId: ownerMembership.store_id,
      userId: user.id,
    });

    const devToken = await deliverVerificationEmail({
      storeId: ownerMembership.store_id,
      userId: user.id,
      email: user.email,
      rawToken,
      request,
    });

    return {
      ...generic,
      ...(devToken ? { devToken, expiresAt } : {}),
    };
  });
}

export default fp(signupRoutes, {
  name: 'signup-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin'],
});
