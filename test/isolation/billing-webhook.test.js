import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hasDatabase } from '../helpers/env.js';
import { makeStore, dropStores } from '../helpers/fixtures.js';
import { signHmac } from '../../src/modules/payments/webhook-auth.js';

const secret = 'isolated-billing-test-secret-long-enough';
const provider = 'mock_billing';

describe('billing webhook: authentication, isolation and replay', { skip: !hasDatabase() && 'DATABASE_URL não definida' }, () => {
  let app, storeA, storeB, refA, refB, query;
  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.BASE_DOMAIN = 'localhost';
    process.env.JWT_SECRET = 'test-jwt-abcdefghijklmnopqrstuvwxyz-123456789';
    process.env.COOKIE_SECRET = 'test-cookie-abcdefghijklmnopqrstuvwxyz-123456';
    process.env.BILLING_WEBHOOK_SECRET_MOCK_BILLING = secret;
    ({ query } = await import('../../src/infrastructure/db.js'));
    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();
    storeA = await makeStore();
    storeB = await makeStore();
    refA = `sub-${randomUUID()}`;
    refB = `sub-${randomUUID()}`;
    const { upsertSubscription } = await import('../../src/modules/billing/billing.repository.js');
    await upsertSubscription(storeA.id, { provider, providerSubscriptionId: refA, status: 'active' });
    await upsertSubscription(storeB.id, { provider, providerSubscriptionId: refB, status: 'active' });
  });
  after(async () => {
    if (query && (storeA || storeB)) {
      await query(`DELETE FROM billing_webhook_events WHERE subscription_id IN (SELECT id FROM subscriptions WHERE store_id = ANY($1::uuid[]))`, [[storeA?.id, storeB?.id].filter(Boolean)]);
    }
    await dropStores(storeA?.id, storeB?.id);
    if (app) await app.close();
    delete process.env.BILLING_WEBHOOK_SECRET_MOCK_BILLING;
    const { pool } = await import('../../src/infrastructure/db.js');
    await pool.end();
  });
  function post(payload, { target = provider, signature = 'valid', raw } = {}) {
    const body = raw ?? JSON.stringify(payload);
    const headers = { 'content-type': 'application/json', host: 'localhost' };
    if (signature === 'valid') headers['x-billing-signature'] = signHmac(body, secret);
    else if (signature) headers['x-billing-signature'] = signature;
    return app.inject({ method: 'POST', url: `/api/billing/webhooks/${target}`, headers, payload: body });
  }
  const event = (ref, type = 'subscription.suspended') => ({ id: randomUUID(), subscription_id: ref, type });
  async function status(store) {
    const r = await query('SELECT status FROM subscriptions WHERE store_id = $1', [store.id]);
    return r.rows[0].status;
  }
  async function activate(store) {
    await query("UPDATE subscriptions SET status = 'active' WHERE store_id = $1", [store.id]);
  }

  it('recusa providers desconhecidos mesmo se houver segredo no ambiente', async () => {
    process.env.BILLING_WEBHOOK_SECRET_UNKNOWN = secret;
    const response = await post(event(refB), { target: 'unknown' });
    delete process.env.BILLING_WEBHOOK_SECRET_UNKNOWN;
    assert.equal(response.statusCode, 404);
    assert.equal(await status(storeB), 'active');
  });
  it('recusa provider mock sem segredo configurado', async () => {
    delete process.env.BILLING_WEBHOOK_SECRET_MOCK_BILLING;
    try { assert.equal((await post(event(refB))).statusCode, 404); }
    finally { process.env.BILLING_WEBHOOK_SECRET_MOCK_BILLING = secret; }
    assert.equal(await status(storeB), 'active');
  });
  it('recusa assinatura ausente, inválida e antigo segredo em texto puro', async () => {
    for (const signature of [null, signHmac('{}', 'wrong'), secret]) {
      assert.equal((await post(event(refB), { signature })).statusCode, 401);
    }
    assert.equal(await status(storeB), 'active');
  });
  it('assina bytes exatos e rejeita corpo alterado', async () => {
    const raw = JSON.stringify(event(refB));
    assert.equal((await post(null, { raw: raw + ' ', signature: signHmac(raw, secret) })).statusCode, 401);
    assert.equal(await status(storeB), 'active');
  });
  it('exige IDs e tipo de evento conhecido', async () => {
    for (const payload of [{ storeId: storeB.id, type: 'suspended' }, { id: randomUUID(), subscription_id: refB, type: 'unknown', status: 'suspended' }, { id: {}, subscription_id: refB, type: 'suspended' }]) {
      assert.equal((await post(payload)).statusCode, 400);
    }
    assert.equal(await status(storeB), 'active');
  });
  it('não usa storeId do corpo para atacar outra loja', async () => {
    const payload = { ...event(refA), storeId: storeB.id };
    assert.equal((await post(payload)).statusCode, 409);
    assert.equal(await status(storeA), 'active');
    assert.equal(await status(storeB), 'active');
    const r = await query('SELECT 1 FROM billing_webhook_events WHERE provider=$1 AND external_event_id=$2', [provider, payload.id]);
    assert.equal(r.rowCount, 0);
  });
  it('recusa assinatura desconhecida sem gravar evento', async () => {
    const payload = event(`missing-${randomUUID()}`);
    assert.equal((await post(payload)).statusCode, 404);
    const r = await query('SELECT 1 FROM billing_webhook_events WHERE provider=$1 AND external_event_id=$2', [provider, payload.id]);
    assert.equal(r.rowCount, 0);
  });
  it('aplica evento à assinatura resolvida e replay não reaplica', async () => {
    const payload = event(refA);
    const first = await post(payload);
    assert.deepEqual(first.json(), { ok: true, applied: true, duplicate: false });
    assert.equal(await status(storeA), 'suspended');
    assert.equal(await status(storeB), 'active');
    await activate(storeA);
    const replay = await post(payload);
    assert.deepEqual(replay.json(), { ok: true, applied: false, duplicate: true });
    assert.equal(await status(storeA), 'active');
  });
  it('rejeita ID reaproveitado com conteúdo ou assinatura diferente', async () => {
    const payload = event(refA);
    assert.equal((await post(payload)).statusCode, 200);
    await activate(storeA);
    assert.equal((await post({ ...payload, subscription_id: refB })).statusCode, 409);
    assert.equal((await post({ ...payload, type: 'subscription.cancelled' })).statusCode, 409);
    assert.equal(await status(storeA), 'active');
    assert.equal(await status(storeB), 'active');
  });
  it('requisições concorrentes aplicam somente uma vez', async () => {
    const payload = event(refA);
    const responses = await Promise.all(Array.from({ length: 5 }, () => post(payload)));
    assert.ok(responses.every((r) => r.statusCode === 200), responses.map(r => r.body).join('\n'));
    assert.equal(responses.filter((r) => r.json().applied).length, 1);
    assert.equal(responses.filter((r) => r.json().duplicate).length, 4);
    await activate(storeA);
  });
  it('evento válido de B altera somente B', async () => {
    const response = await post({ ...event(refB), storeId: storeB.id });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().applied, true);
    assert.equal(await status(storeA), 'active');
    assert.equal(await status(storeB), 'suspended');
    await activate(storeB);
  });
  it('referências ambíguas de provider falham fechadas', async () => {
    await query('UPDATE subscriptions SET provider_subscription_id=$1 WHERE store_id=$2', [refA, storeB.id]);
    try {
      assert.equal((await post(event(refA))).statusCode, 404);
      assert.equal(await status(storeA), 'active');
      assert.equal(await status(storeB), 'active');
    } finally {
      await query('UPDATE subscriptions SET provider_subscription_id=$1 WHERE store_id=$2', [refB, storeB.id]);
    }
  });
});
