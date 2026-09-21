/**
 * Regressão: tenant por query nas rotas SSE (issue do SMOKE §8.1).
 *
 * `EventSource` não envia headers, então em deploy de host único (API servindo a
 * SPA) o painel da cozinha não conseguia resolver o tenant e caía em
 * `400 TENANT_REQUIRED`. As rotas `/api/kitchen/*` passaram a aceitar
 * `?tenant=<slug>` (opt-in via `config.allowTenantQuery`).
 *
 * O que este arquivo garante:
 *  1. membro da loja resolve o tenant pelo query e entra (200);
 *  2. usuário de OUTRA loja recebe 403 — o query não é uma porta de acesso;
 *  3. rotas sem opt-in continuam ignorando `?tenant=` (400 TENANT_REQUIRED);
 *  4. slug inexistente → 404 TENANT_NOT_FOUND (não vaza existência).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

describe('SSE tenant por query — isolamento (regressão)', () => {
  /** @type {import('fastify').FastifyInstance | null} */
  let app = null;
  let storeA = null;
  let storeB = null;
  let cookieA = null;

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

    const { create: createStore } = await import(
      '../../src/modules/tenancy/store.repository.js'
    );
    const { createUser, addStoreUser } = await import(
      '../../src/modules/auth/user.repository.js'
    );
    const { hashPassword } = await import('../../src/modules/auth/password.js');
    const { signSessionToken } = await import('../../src/modules/auth/session.js');

    const suffix = Date.now().toString(36);
    storeA = await createStore({ slug: `sse-a-${suffix}`, name: 'SSE Store A' });
    storeB = await createStore({ slug: `sse-b-${suffix}`, name: 'SSE Store B' });

    // Usuário membro SOMENTE da loja A
    const user = await createUser({
      email: `sse-${suffix}@example.test`,
      passwordHash: await hashPassword('senha-teste-123'),
      name: 'Cozinha A',
    });
    await addStoreUser({ storeId: storeA.id, userId: user.id, role: 'KITCHEN' });
    cookieA = `ar_session=${await signSessionToken(user, { type: 'store', storeId: storeA.id, role: 'KITCHEN' })}`;
  });

  after(async () => {
    if (app) await app.close();
    if (!hasDatabase() || !storeA) return;
    const { query } = await import('../../src/infrastructure/db.js');
    await query(`DELETE FROM stores WHERE id = ANY($1::uuid[])`, [[storeA.id, storeB.id]]);
  });

  it('membro da loja resolve tenant por ?tenant= (EventSource não manda header)', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await app.inject({
      method: 'GET',
      url: `/api/kitchen/events?station=KITCHEN&probe=1&tenant=${storeA.slug}`,
      headers: { host: 'transport.test', cookie: cookieA },
      // host default → nenhum tenant resolvido pelo host/header
    });

    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.storeId, storeA.id);
    assert.equal(body.station, 'KITCHEN');
    assert.equal(body.channel, `store:${storeA.id}:orders:KITCHEN`);
  });

  it('usuário de outra loja recebe 403 — ?tenant= não é porta de acesso', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await app.inject({
      method: 'GET',
      url: `/api/kitchen/events?station=KITCHEN&probe=1&tenant=${storeB.slug}`,
      headers: { host: 'transport.test', cookie: cookieA }, // membro só de A
    });

    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json().error?.code, 'CONTEXT_FORBIDDEN');
  });

  it('rota sem opt-in continua ignorando ?tenant=', async (t) => {
    if (skipWithoutDb(t)) return;

    // /api/menu não tem allowTenantQuery → o query não pode criar contexto de tenant
    const res = await app.inject({
      method: 'GET',
      url: `/api/menu?tenant=${storeA.slug}`,
    });

    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error?.code, 'TENANT_REQUIRED');
  });

  it('slug inexistente em ?tenant= devolve 404 TENANT_NOT_FOUND', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await app.inject({
      method: 'GET',
      url: '/api/kitchen/events?station=BAR&probe=1&tenant=loja-que-nao-existe',
      headers: { host: 'transport.test', cookie: cookieA },
    });

    assert.equal(res.statusCode, 404, res.body);
    assert.equal(res.json().error?.code, 'TENANT_NOT_FOUND');
  });

  it('sem tenant algum a rota segue exigindo tenant', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await app.inject({
      method: 'GET',
      url: '/api/kitchen/events?station=KITCHEN&probe=1',
      headers: { host: 'transport.test', cookie: cookieA },
    });

    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error?.code, 'TENANT_REQUIRED');
  });
});
