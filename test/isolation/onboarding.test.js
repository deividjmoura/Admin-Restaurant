/**
 * Onboarding self-service (integração — requer DATABASE_URL).
 * Issue #60 (epic #58):
 * - Signup cria store 'pending' + owner com e-mail não verificado
 * - Slug/e-mail duplicado ou reservado é rejeitado
 * - Verificação de e-mail ativa a store
 * - Token inválido/expirado/reusado é rejeitado
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

describe('onboarding self-service (integration)', () => {
  /** @type {import('fastify').FastifyInstance | null} */
  let app = null;

  before(async () => {
    if (!hasDatabase()) return;

    process.env.NODE_ENV = 'development';
    process.env.BASE_DOMAIN = process.env.BASE_DOMAIN || 'localhost';
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long!!';
    process.env.COOKIE_SECRET =
      process.env.COOKIE_SECRET || 'test-cookie-secret-change-me';

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();
  });

  after(async () => {
    if (app) await app.close();
  });

  function uniqueSlug() {
    return `signup-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
  }

  it('creates a pending store + unverified owner', async (t) => {
    if (skipWithoutDb(t)) return;

    const slug = uniqueSlug();
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: {
        storeName: 'Lanchonete Teste',
        slug,
        ownerName: 'Dono Teste',
        ownerEmail: `${slug}@example.com`,
        password: 'senha-forte-123',
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.store.slug, slug);
    assert.equal(body.store.status, 'pending');
    assert.equal(body.verification.required, true);
    assert.ok(body.verification.devToken, 'dev token expected outside production');
  });

  it('rejects duplicate slug', async (t) => {
    if (skipWithoutDb(t)) return;

    const slug = uniqueSlug();
    const payload = {
      storeName: 'Loja Duplicada',
      slug,
      ownerName: 'Owner',
      ownerEmail: `${slug}-a@example.com`,
      password: 'senha-forte-123',
    };

    const first = await app.inject({ method: 'POST', url: '/api/signup', payload });
    assert.equal(first.statusCode, 201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...payload, ownerEmail: `${slug}-b@example.com` },
    });
    assert.equal(second.statusCode, 409);
    assert.equal(second.json().error.code, 'SLUG_TAKEN');
  });

  it('rejects reserved slugs', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: {
        storeName: 'Admin Fake',
        slug: 'admin',
        ownerName: 'Owner',
        ownerEmail: `${uniqueSlug()}@example.com`,
        password: 'senha-forte-123',
      },
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'SLUG_RESERVED');
  });

  it('activates store on valid verification and rejects reuse', async (t) => {
    if (skipWithoutDb(t)) return;

    const slug = uniqueSlug();
    const signup = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: {
        storeName: 'Loja Verificação',
        slug,
        ownerName: 'Owner',
        ownerEmail: `${slug}@example.com`,
        password: 'senha-forte-123',
      },
    });
    const { verification } = signup.json();

    const verify = await app.inject({
      method: 'POST',
      url: '/api/signup/verify',
      payload: { token: verification.devToken },
    });
    assert.equal(verify.statusCode, 200);
    const verifyBody = verify.json();
    assert.equal(verifyBody.verified, true);
    assert.equal(verifyBody.store.status, 'active');

    // Reuso do mesmo token deve falhar
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/signup/verify',
      payload: { token: verification.devToken },
    });
    assert.equal(reuse.statusCode, 400);
    assert.equal(reuse.json().error.code, 'VERIFICATION_INVALID');
  });

  it('rejects an unknown/garbage token', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/signup/verify',
      payload: { token: 'a'.repeat(64) },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VERIFICATION_INVALID');
  });
});
