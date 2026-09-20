/**
 * Hardening HTTP: CORS fail-closed, cookies, rate limit de login,
 * mapeamento de erros (4xx preservados, 500 genérico) e gate do seed.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { skipWithoutDb } from '../helpers/env.js';
import { dropStores } from '../helpers/fixtures.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('CORS e cookies (integration)', () => {
  let app = null;
  let store = null;
  let owner = null;
  const previous = {};

  before(async () => {
    previous.NODE_ENV = process.env.NODE_ENV;
    previous.CORS_ORIGIN = process.env.CORS_ORIGIN;
    previous.COOKIE_SAMESITE = process.env.COOKIE_SAMESITE;
    previous.ALLOW_INSECURE = process.env.COOKIE_ALLOW_INSECURE_NONE;

    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://app.example.com,https://admin.example.com';
    process.env.COOKIE_SECRET = 'c'.repeat(40);
    process.env.JWT_SECRET = 'j'.repeat(40);
    delete process.env.COOKIE_ALLOW_INSECURE_NONE;

    const { makeStore, makeUserWithRole } = await import('../helpers/fixtures.js');
    store = await makeStore({ name: 'Loja CORS' });
    owner = await makeUserWithRole(store.id, { role: 'OWNER' });

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();
  });

  after(async () => {
    if (app) await app.close();
    await dropStores(store?.id);
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.CORS_ORIGIN === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = previous.CORS_ORIGIN;
    if (previous.COOKIE_SAMESITE === undefined) delete process.env.COOKIE_SAMESITE;
    else process.env.COOKIE_SAMESITE = previous.COOKIE_SAMESITE;
    if (previous.ALLOW_INSECURE === undefined) delete process.env.COOKIE_ALLOW_INSECURE_NONE;
    else process.env.COOKIE_ALLOW_INSECURE_NONE = previous.ALLOW_INSECURE;
  });

  it('reflete apenas origens explicitamente configuradas', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://app.example.com' },
    });
    assert.equal(allowed.headers['access-control-allow-origin'], 'https://app.example.com');
    assert.equal(allowed.headers['access-control-allow-credentials'], 'true');

    const second = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://admin.example.com' },
    });
    assert.equal(second.headers['access-control-allow-origin'], 'https://admin.example.com');

    const denied = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example.com' },
    });
    assert.equal(
      denied.headers['access-control-allow-origin'],
      undefined,
      'origem desconhecida não pode ser refletida'
    );
  });

  it('preflight permite os headers usados pela API', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/payments',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-tenant-slug,idempotency-key,x-signature',
      },
    });
    assert.equal(res.statusCode, 204);
    const allowed = String(res.headers['access-control-allow-headers']).toLowerCase();
    for (const header of ['content-type', 'x-tenant-slug', 'idempotency-key', 'x-signature']) {
      assert.ok(allowed.includes(header), `${header} deveria estar liberado`);
    }
    const methods = String(res.headers['access-control-allow-methods']).toUpperCase();
    for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']) {
      assert.ok(methods.includes(method), `${method} deveria estar liberado`);
    }
  });

  it('cookie de sessão é HttpOnly, SameSite=Lax e Secure em produção', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json', 'x-tenant-slug': store.slug },
      payload: { email: owner.user.email, password: owner.password },
    });
    assert.equal(res.statusCode, 200, res.body);

    const cookie = res.headers['set-cookie'];
    const value = Array.isArray(cookie) ? cookie.join(';') : String(cookie);
    assert.ok(value.includes('ar_session='));
    assert.ok(/httponly/i.test(value), 'cookie precisa ser HttpOnly');
    assert.ok(/samesite=lax/i.test(value), 'default precisa ser SameSite=Lax');
    assert.ok(/secure/i.test(value), 'em produção o cookie precisa ser Secure');
  });
});

describe('fail-closed de configuração (unit)', () => {
  it('produção sem CORS_ORIGIN/FRONTEND_ORIGIN não sobe', async () => {
    const prev = {
      nodeEnv: process.env.NODE_ENV,
      cors: process.env.CORS_ORIGIN,
      frontend: process.env.FRONTEND_ORIGIN,
    };
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGIN;
    delete process.env.FRONTEND_ORIGIN;
    try {
      const { buildApp } = await import('../../src/app.js');
      await assert.rejects(() => buildApp({ logger: false }), /CORS_ORIGIN/);
    } finally {
      process.env.NODE_ENV = prev.nodeEnv;
      if (prev.cors !== undefined) process.env.CORS_ORIGIN = prev.cors;
      if (prev.frontend !== undefined) process.env.FRONTEND_ORIGIN = prev.frontend;
    }
  });

  it('produção sem COOKIE_SECRET não sobe', async () => {
    const prev = {
      nodeEnv: process.env.NODE_ENV,
      cookie: process.env.COOKIE_SECRET,
      cors: process.env.CORS_ORIGIN,
    };
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://app.example.com';
    delete process.env.COOKIE_SECRET;
    try {
      const { buildApp } = await import('../../src/app.js');
      await assert.rejects(() => buildApp({ logger: false }), /COOKIE_SECRET/);
    } finally {
      process.env.NODE_ENV = prev.nodeEnv;
      if (prev.cookie !== undefined) process.env.COOKIE_SECRET = prev.cookie;
      process.env.CORS_ORIGIN = prev.cors ?? 'https://app.example.com';
    }
  });
});

describe('rate limit e mapeamento de erros (integration)', () => {
  let app = null;
  let store = null;
  let owner = null;
  const previous = {};

  before(async () => {
    previous.loginMax = process.env.LOGIN_RATE_LIMIT_MAX;
    previous.identityMax = process.env.LOGIN_IDENTITY_MAX;
    process.env.NODE_ENV = 'test';
    process.env.LOGIN_RATE_LIMIT_MAX = '5';
    process.env.LOGIN_IDENTITY_MAX = '50';

    const { makeStore, makeUserWithRole } = await import('../helpers/fixtures.js');
    store = await makeStore({ name: 'Loja erros' });
    owner = await makeUserWithRole(store.id, { role: 'OWNER' });

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();
  });

  after(async () => {
    if (app) await app.close();
    await dropStores(store?.id);
    if (previous.loginMax === undefined) delete process.env.LOGIN_RATE_LIMIT_MAX;
    else process.env.LOGIN_RATE_LIMIT_MAX = previous.loginMax;
    if (previous.identityMax === undefined) delete process.env.LOGIN_IDENTITY_MAX;
    else process.env.LOGIN_IDENTITY_MAX = previous.identityMax;
  });

  it('login tem limite por IP e responde 429 RATE_LIMITED', async (t) => {
    if (skipWithoutDb(t)) return;
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'content-type': 'application/json', 'x-tenant-slug': store.slug },
        payload: { email: 'ninguem@test.local', password: 'senha-errada-123' },
      });

    const statuses = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await attempt()).statusCode);
    }
    assert.equal(statuses.includes(401), true, `esperava 401: ${statuses}`);
    assert.equal(statuses.includes(429), true, `esperava 429: ${statuses}`);
    assert.equal(
      statuses.slice(5).every((s) => s === 429),
      true,
      `após o limite todas devem ser 429: ${statuses}`
    );
  });

  it('erros de cliente preservam o status e não viram 500', async (t) => {
    if (skipWithoutDb(t)) return;
    const cookie = owner.cookie;

    // UUID malformado em path param → 400 INVALID_ID (não 500)
    const badId = await app.inject({
      method: 'GET',
      url: '/api/admin/tables',
      headers: { 'x-tenant-slug': store.slug, cookie },
    });
    assert.equal(badId.statusCode, 200, badId.body);

    const badUuid = await app.inject({
      method: 'PATCH',
      url: '/api/admin/tables/nao-e-uuid',
      headers: {
        'content-type': 'application/json',
        'x-tenant-slug': store.slug,
        cookie,
      },
      payload: { number: 5 },
    });
    assert.equal(badUuid.statusCode, 400, badUuid.body);
    assert.equal(badUuid.json().error.code, 'INVALID_ID');

    // JSON malformado → 400, nunca 500
    const badJson = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { 'content-type': 'application/json', 'x-tenant-slug': store.slug },
      payload: '{ isso não é json',
    });
    assert.equal(badJson.statusCode, 400, badJson.body);
    assert.equal(badJson.json().error.code, 'BAD_REQUEST');
    assert.equal(
      badJson.body.includes('FST_ERR'),
      false,
      'não pode vazar código interno do runtime'
    );

    // content-type não suportado → 415
    const badType = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { 'content-type': 'text/xml', 'x-tenant-slug': store.slug },
      payload: '<xml/>',
    });
    assert.equal(badType.statusCode, 415, badType.body);
    assert.equal(badType.json().error.code, 'UNSUPPORTED_CONTENT_TYPE');
    assert.equal(badType.json().error.message, 'Content-Type não suportado.');

    // rota inexistente → 404 limpo
    const notFound = await app.inject({ method: 'GET', url: '/api/nao-existe' });
    assert.equal(notFound.statusCode, 404, notFound.body);
    assert.equal(notFound.json().error.code, 'NOT_FOUND');
  });

  it('erro inesperado responde 500 genérico sem stack trace', async (t) => {
    if (skipWithoutDb(t)) return;
    const { buildApp } = await import('../../src/app.js');
    const boomApp = await buildApp({ logger: false });
    boomApp.get('/__boom', async () => {
      throw new Error('stack-secreta-nao-pode-vazar');
    });
    await boomApp.ready();
    try {
      const res = await boomApp.inject({ method: 'GET', url: '/__boom' });
      assert.equal(res.statusCode, 500, res.body);
      const body = res.json();
      assert.equal(body.error.code, 'INTERNAL_ERROR');
      assert.equal(res.body.includes('stack-secreta-nao-pode-vazar'), false);
      assert.equal(res.body.includes('at '), false, 'sem stack no corpo');
      assert.equal('stack' in body.error, false);
      assert.equal('stack' in body, false);
    } finally {
      await boomApp.close();
    }
  });
});

describe('gate de credenciais do seed (unit)', () => {
  function runSeed(env) {
    return spawnSync(process.execPath, ['scripts/seed.js'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: 'postgres://postgres@127.0.0.1:1/nao-existe',
        // eslint-disable-next-line no-undefined
        STAFF_SEED_PASSWORD: undefined,
        ...env,
      },
      encoding: 'utf8',
      timeout: 30000,
    });
  }

  it('produção sem STAFF_SEED_PASSWORD aborta', () => {
    const res = runSeed({ NODE_ENV: 'production' });
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stderr, /STAFF_SEED_PASSWORD/);
  });

  it('produção rejeita senha de exemplo/curta', () => {
    const weak = runSeed({ NODE_ENV: 'production', STAFF_SEED_PASSWORD: 'troque-esta-senha' });
    assert.equal(weak.status, 1);
    assert.match(weak.stderr, /STAFF_SEED_PASSWORD/);

    const short = runSeed({ NODE_ENV: 'production', STAFF_SEED_PASSWORD: 'curta' });
    assert.equal(short.status, 1);
  });

  it('nunca imprime a senha do seed', () => {
    const secret = 'senha-super-secreta-do-seed-123';
    const res = runSeed({ NODE_ENV: 'test', STAFF_SEED_PASSWORD: secret });
    assert.equal(`${res.stdout}${res.stderr}`.includes(secret), false);
    assert.equal(`${res.stdout}${res.stderr}`.includes('troque-esta-senha'), false);
  });
});
