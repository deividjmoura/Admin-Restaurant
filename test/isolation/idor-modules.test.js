/**
 * B1 — Isolamento IDOR nos módulos sem suíte dedicada:
 * coupons · wallets · billing · reports · whatsapp
 *
 * Staff do tenant A NUNCA lê/escreve recurso do tenant B.
 * Esperado: 403 (sem membership) ou 404 (recurso filtrado por store_id).
 * NUNCA 200 com payload do outro tenant.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

describe('IDOR isolation — coupons/wallets/billing/reports/whatsapp', () => {
  /** @type {import('fastify').FastifyInstance | null} */
  let app = null;
  let storeA = null;
  let storeB = null;
  /** @type {{ user: object, cookie: string } | null} */
  let ownerA = null;
  /** @type {{ user: object, cookie: string } | null} */
  let ownerB = null;
  let couponAId = null;
  let couponACode = null;
  let walletAId = null;
  let userAId = null;

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
    const { signSessionToken, COOKIE_NAME } = await import(
      '../../src/modules/auth/session.js'
    );
    const { createCoupon } = await import(
      '../../src/modules/coupons/coupons.repository.js'
    );
    const { getOrCreateWallet } = await import(
      '../../src/modules/wallets/wallets.repository.js'
    );
    const { saveMessage } = await import(
      '../../src/modules/whatsapp/whatsapp.repository.js'
    );

    const suffix = Date.now().toString(36);
    storeA = await createStore({ slug: `idor-a-${suffix}`, name: 'IDOR Store A' });
    storeB = await createStore({ slug: `idor-b-${suffix}`, name: 'IDOR Store B' });

    const passwordHash = await hashPassword('test-password-123');

    async function makeOwner(store) {
      const email = `owner-${store.slug}-${suffix}@idor.test`;
      const user = await createUser({
        email,
        passwordHash,
        name: `Owner ${store.slug}`,
        isSuperAdmin: false,
      });
      await addStoreUser({ storeId: store.id, userId: user.id, role: 'OWNER' });
      const token = await signSessionToken(user);
      return { user, cookie: `${COOKIE_NAME}=${token}` };
    }

    ownerA = await makeOwner(storeA);
    ownerB = await makeOwner(storeB);
    userAId = ownerA.user.id;

    couponACode = `IDA${suffix.slice(-4)}`.toUpperCase();
    const coupon = await createCoupon(storeA.id, {
      code: couponACode,
      discountType: 'fixed',
      discountValue: 5,
      minOrderAmount: 0,
      isActive: true,
    });
    couponAId = coupon.id;

    const wallet = await getOrCreateWallet(storeA.id, userAId);
    walletAId = wallet.id;

    await saveMessage(storeA.id, {
      externalId: `wa-idor-${suffix}`,
      fromNumber: '+5511999990001',
      body: 'pedido idor isolation seed',
      parsedPayload: { seed: true },
      status: 'received',
    });
  });

  after(async () => {
    if (app) await app.close();
    if (!hasDatabase() || !storeA) return;
    const { query } = await import('../../src/infrastructure/db.js');
    await query(`DELETE FROM stores WHERE id = ANY($1::uuid[])`, [
      [storeA.id, storeB.id],
    ]);
  });

  function inject(method, url, { actor, slug, body } = {}) {
    const headers = {};
    if (slug) headers['x-tenant-slug'] = slug;
    if (actor?.cookie) headers.cookie = actor.cookie;
    return app.inject({
      method,
      url,
      headers,
      payload: body,
    });
  }

  function assertNoLeak(res, forbiddenStoreId) {
    assert.notEqual(
      res.statusCode,
      200,
      `must not return 200 when probing other tenant — got body: ${res.body?.slice?.(0, 200)}`
    );
    assert.ok(
      [401, 403, 404].includes(res.statusCode),
      `expected 401/403/404, got ${res.statusCode}: ${res.body}`
    );
    if (res.statusCode === 200) {
      assert.ok(!res.body.includes(forbiddenStoreId));
    }
  }

  // ——— Coupons ———

  it('GET /api/coupons/:id of A under tenant B → 403 or 404 (no payload A)', async (t) => {
    if (skipWithoutDb(t)) return;

    const ok = await inject('GET', `/api/coupons/${couponAId}`, {
      actor: ownerA,
      slug: storeA.slug,
    });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().coupon?.id, couponAId);

    const crossAuth = await inject('GET', `/api/coupons/${couponAId}`, {
      actor: ownerB,
      slug: storeA.slug,
    });
    assert.equal(crossAuth.statusCode, 403, crossAuth.body);

    const crossTenant = await inject('GET', `/api/coupons/${couponAId}`, {
      actor: ownerB,
      slug: storeB.slug,
    });
    assert.equal(crossTenant.statusCode, 404, crossTenant.body);
    assert.notEqual(crossTenant.json()?.coupon?.id, couponAId);
  });

  it('GET /api/coupons list under B does not include coupon of A', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await inject('GET', '/api/coupons', {
      actor: ownerB,
      slug: storeB.slug,
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.storeId, storeB.id);
    const ids = (body.coupons || []).map((c) => c.id);
    assert.equal(ids.includes(couponAId), false);
    const codes = (body.coupons || []).map((c) => c.code);
    assert.equal(codes.includes(couponACode), false);
  });

  it('POST /api/coupons/validate code of A under tenant B fails (not found)', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await inject('POST', '/api/coupons/validate', {
      slug: storeB.slug,
      body: { code: couponACode, orderAmount: 50 },
    });
    assert.ok(
      [404, 409].includes(res.statusCode),
      `expected coupon not found for other tenant, got ${res.statusCode}`
    );
    const payload = res.json();
    assert.notEqual(payload?.coupon?.storeId, storeA.id);
  });

  it('PATCH /api/coupons/:id of A as owner B on tenant B → 404', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await inject('PATCH', `/api/coupons/${couponAId}`, {
      actor: ownerB,
      slug: storeB.slug,
      body: { isActive: false },
    });
    assert.equal(res.statusCode, 404, res.body);
  });

  // ——— Wallets ———

  it('GET /api/wallets under B does not list wallet of A', async (t) => {
    if (skipWithoutDb(t)) return;

    const resA = await inject('GET', '/api/wallets', {
      actor: ownerA,
      slug: storeA.slug,
    });
    assert.equal(resA.statusCode, 200, resA.body);
    assert.ok(
      (resA.json().wallets || []).some((w) => w.id === walletAId),
      'owner A should see own wallet'
    );

    const resB = await inject('GET', '/api/wallets', {
      actor: ownerB,
      slug: storeB.slug,
    });
    assert.equal(resB.statusCode, 200, resB.body);
    assert.equal(resB.json().storeId, storeB.id);
    const ids = (resB.json().wallets || []).map((w) => w.id);
    assert.equal(ids.includes(walletAId), false);
  });

  it('GET /api/wallets/:walletId/transactions of A under B → empty or not A data', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await inject('GET', `/api/wallets/${walletAId}/transactions`, {
      actor: ownerB,
      slug: storeB.slug,
    });
    assert.equal(res.statusCode, 200, res.body);
    const txs = res.json().transactions || [];
    for (const tx of txs) {
      assert.notEqual(tx.storeId, storeA.id);
      assert.notEqual(tx.walletId, walletAId);
    }
  });

  it('OWNER_B cannot list wallets of store A (403)', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await inject('GET', '/api/wallets', {
      actor: ownerB,
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 403, res.body);
  });

  // ——— Billing ———

  it('GET /api/billing/subscription is scoped to resolved tenant storeId', async (t) => {
    if (skipWithoutDb(t)) return;

    const resA = await inject('GET', '/api/billing/subscription', {
      slug: storeA.slug,
    });
    assert.equal(resA.statusCode, 200, resA.body);
    assert.equal(resA.json().storeId, storeA.id);

    const resB = await inject('GET', '/api/billing/subscription', {
      slug: storeB.slug,
    });
    assert.equal(resB.statusCode, 200, resB.body);
    assert.equal(resB.json().storeId, storeB.id);
    assert.notEqual(resB.json().storeId, storeA.id);
  });

  it('POST subscription as OWNER_B on store A → 403', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await inject('POST', '/api/billing/subscription', {
      actor: ownerB,
      slug: storeA.slug,
      body: { planId: 'pro' },
    });
    assert.equal(res.statusCode, 403, res.body);
  });

  // ——— Reports ———

  it('OWNER_B cannot open reports of store A (403)', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await inject('GET', '/api/reports/dashboard', {
      actor: ownerB,
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 403, res.body);
  });

  it('reports dashboard under B returns storeId B only', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await inject('GET', '/api/reports/dashboard?preset=today', {
      actor: ownerB,
      slug: storeB.slug,
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.storeId, storeB.id);
    assert.notEqual(body.storeId, storeA.id);
  });

  // ——— WhatsApp ———

  it('GET /api/whatsapp/messages under B does not include messages of A', async (t) => {
    if (skipWithoutDb(t)) return;

    const resA = await inject('GET', '/api/whatsapp/messages', {
      actor: ownerA,
      slug: storeA.slug,
    });
    assert.equal(resA.statusCode, 200, resA.body);
    assert.equal(resA.json().storeId, storeA.id);
    assert.ok((resA.json().messages || []).length >= 1, 'seed message on A');

    const resB = await inject('GET', '/api/whatsapp/messages', {
      actor: ownerB,
      slug: storeB.slug,
    });
    assert.equal(resB.statusCode, 200, resB.body);
    assert.equal(resB.json().storeId, storeB.id);
    for (const m of resB.json().messages || []) {
      assert.notEqual(m.fromNumber, '+5511999990001');
      if (m.body) assert.equal(m.body.includes('idor isolation seed'), false);
    }
  });

  it('OWNER_B cannot list whatsapp messages of store A (403)', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await inject('GET', '/api/whatsapp/messages', {
      actor: ownerB,
      slug: storeA.slug,
    });
    assertNoLeak(res, storeA.id);
    assert.equal(res.statusCode, 403, res.body);
  });
});
