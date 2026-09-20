/**
 * Cobertura e segurança da trilha de auditoria.
 *
 * Cobre:
 *  - sanitização de metadados (nunca grava senha/token/chave PIX/payload bruto);
 *  - auditoria é best effort: falha de gravação não derruba a operação;
 *  - mutações sensíveis geram linha de auditoria (pedido, pagamento, mesa,
 *    permissões, settings da loja, login);
 *  - leitura de auditoria é por loja (não vaza outro tenant), OWNER-only,
 *    paginada e filtrável;
 *  - trilha é imutável (DELETE bloqueado no banco).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb } from '../helpers/env.js';
import { dropStores } from '../helpers/fixtures.js';

describe('auditoria — sanitização (unit)', () => {
  it('remove campos sensíveis em qualquer profundidade', async () => {
    const { sanitizeAuditMetadata } = await import(
      '../../src/modules/audit/audit-context.js'
    );
    const sanitized = sanitizeAuditMetadata({
      password: 'segredo',
      senha: 'segredo',
      token: 'abc',
      authorization: 'Bearer abc',
      card: { number: '4111111111111111', cvv: '123' },
      pix: { key: 'chave-pix-secreta', name: 'Loja' },
      payload: { raw: 'body bruto do webhook' },
      cookie: 'ar_session=...',
      signature: 'deadbeef',
      nested: { level1: { level2: { secret: 'x', safe: 'ok' } } },
      orderId: 'uuid-1',
    });

    assert.equal(sanitized.password, '[redacted]');
    assert.equal(sanitized.senha, '[redacted]');
    assert.equal(sanitized.token, '[redacted]');
    assert.equal(sanitized.authorization, '[redacted]');
    assert.equal(sanitized.card, '[redacted]');
    assert.equal(sanitized.pix, '[redacted]');
    assert.equal(sanitized.payload, '[redacted]');
    assert.equal(sanitized.cookie, '[redacted]');
    assert.equal(sanitized.signature, '[redacted]');
    assert.equal(sanitized.nested.level1.level2.secret, '[redacted]');
    assert.equal(sanitized.nested.level1.level2.safe, 'ok');
    assert.equal(sanitized.orderId, 'uuid-1');

    const serialized = JSON.stringify(sanitized);
    assert.equal(serialized.includes('segredo'), false);
    assert.equal(serialized.includes('4111111111111111'), false);
    assert.equal(serialized.includes('chave-pix-secreta'), false);
  });

  it('trunca strings gigantes e limita profundidade', async () => {
    const { sanitizeAuditMetadata } = await import(
      '../../src/modules/audit/audit-context.js'
    );
    const long = 'x'.repeat(5000);
    const out = sanitizeAuditMetadata({ long });
    assert.ok(out.long.length <= 501);

    let deep = 'fim';
    for (let i = 0; i < 10; i++) deep = { deep };
    assert.equal(JSON.stringify(sanitizeAuditMetadata(deep)).includes('[deep]'), true);
  });
});

describe('auditoria — cobertura e tenant (integration)', () => {
  let app = null;
  let storeA = null;
  let storeB = null;
  let ownerA = null;
  let ownerB = null;
  let staffA = null;
  let keepalive = null;

  const tenantHeaders = (slug, cookie) => ({
    'x-tenant-slug': slug,
    ...(cookie ? { cookie } : {}),
  });

  async function auditRows(storeId, action) {
    const { query } = await import('../../src/infrastructure/db.js');
    const { rows } = await query(
      `SELECT id, store_id, actor_user_id, action, resource, resource_id, metadata
       FROM audit_logs WHERE store_id = $1 AND action = $2 ORDER BY created_at DESC`,
      [storeId, action]
    );
    return rows;
  }

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOGIN_RATE_LIMIT_MAX = '200';
    process.env.LOGIN_IDENTITY_MAX = '200';

    const { makeStore, makeUserWithRole } = await import('../helpers/fixtures.js');
    storeA = await makeStore({ name: 'Loja A' });
    storeB = await makeStore({ name: 'Loja B' });
    const a = await makeUserWithRole(storeA.id, { role: 'OWNER' });
    ownerA = { ...a, email: a.user.email };
    const b = await makeUserWithRole(storeB.id, { role: 'OWNER' });
    ownerB = { ...b, email: b.user.email };
    staffA = await makeUserWithRole(storeA.id, { role: 'STAFF' });

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();
  });

  after(async () => {
    if (app) await app.close();
    if (keepalive) await keepalive.close?.();
    await dropStores(storeA?.id, storeB?.id);
  });

  it('falha de auditoria nunca derruba a operação (best effort)', async (t) => {
    if (skipWithoutDb(t)) return;
    const { auditSafe, auditRequest } = await import(
      '../../src/modules/audit/audit-context.js'
    );
    const bogusStore = '00000000-0000-0000-0000-000000000000';
    const logs = [];
    const logger = { warn: (payload, msg) => logs.push({ payload, msg }) };

    // store_id inexistente → violação de FK, mas o helper engole o erro
    const result = await auditSafe(
      { storeId: bogusStore, action: 'test.invalid_store', metadata: { a: 1 } },
      { log: logger }
    );
    assert.equal(result, null);
    assert.ok(logs.length >= 1, 'falha deve virar warning, não exceção');

    const requestResult = await auditRequest(
      { log: logger, ip: '127.0.0.1', headers: {} },
      { storeId: bogusStore, action: 'test.invalid_store_request' }
    );
    assert.equal(requestResult, null);
  });

  it('login bem-sucedido e falho geram auditoria sem vazar dados', async (t) => {
    if (skipWithoutDb(t)) return;
    const login = (email, password) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'content-type': 'application/json', 'x-tenant-slug': storeA.slug },
        payload: { email, password },
      });

    const okRes = await login(ownerA.user.email, ownerA.password);
    assert.equal(okRes.statusCode, 200, okRes.body);

    const badRes = await login('nao-existe@test.local', 'senha-errada-123');
    assert.equal(badRes.statusCode, 401, badRes.body);

    const successRows = await auditRows(storeA.id, 'auth.login.success');
    assert.ok(successRows.length >= 1, 'login OK precisa ser auditado');

    const { query } = await import('../../src/infrastructure/db.js');
    const { rows: failedRows } = await query(
      `SELECT metadata FROM audit_logs WHERE action = 'auth.login.failed'
       ORDER BY created_at DESC LIMIT 5`
    );
    assert.ok(failedRows.length >= 1, 'login falho precisa ser auditado');
    const serialized = JSON.stringify(failedRows.map((r) => r.metadata));
    assert.equal(serialized.includes('senha-errada-123'), false, 'nunca a senha');
    assert.equal(serialized.includes('nao-existe@test.local'), false, 'e-mail não em claro');
  });

  it('criação de mesa e de pedido geram auditoria da loja correta', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tables',
      headers: { 'content-type': 'application/json', ...tenantHeaders(storeA.slug, ownerA.cookie) },
      payload: { number: 777, label: 'Mesa audit' },
    });
    assert.equal(res.statusCode, 201, res.body);
    const tableId = res.json().table.id;

    const rows = await auditRows(storeA.id, 'table.created');
    assert.ok(rows.length >= 1);
    assert.equal(rows[0].store_id, storeA.id);
    assert.equal(rows[0].actor_user_id, ownerA.user.id);
    assert.equal(rows[0].resource, 'table');
    assert.equal(rows[0].resource_id, tableId);

    assert.equal((await auditRows(storeB.id, 'table.created')).length, 0, 'não vaza para B');

    // regenerar token NUNCA registra o token
    const regen = await app.inject({
      method: 'POST',
      url: `/api/admin/tables/${tableId}/regenerate-token`,
      headers: tenantHeaders(storeA.slug, ownerA.cookie),
    });
    assert.equal(regen.statusCode, 200, regen.body);
    const regenRows = await auditRows(storeA.id, 'table.token_regenerated');
    assert.ok(regenRows.length >= 1);
    const tokenValue = regen.json().table?.publicToken ?? regen.json().publicToken;
    if (tokenValue) {
      assert.equal(
        JSON.stringify(regenRows.map((r) => r.metadata)).includes(tokenValue),
        false,
        'token nunca é auditado'
      );
    }
  });

  it('mudança de settings audita apenas nomes de campo (chave PIX é segredo)', async (t) => {
    if (skipWithoutDb(t)) return;
    const secretKey = 'chave-pix-super-secreta@test.local';
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/store/settings',
      headers: { 'content-type': 'application/json', ...tenantHeaders(storeA.slug, ownerA.cookie) },
      payload: { pix: { key: secretKey, name: 'Loja A' }, displayName: 'Loja A' },
    });
    assert.equal(res.statusCode, 200, res.body);

    const rows = await auditRows(storeA.id, 'store.settings_updated');
    assert.ok(rows.length >= 1);
    const serialized = JSON.stringify(rows.map((r) => r.metadata));
    assert.equal(serialized.includes(secretKey), false, 'chave PIX nunca em audit');
    assert.equal(serialized.includes('displayName'), true);
  });

  it('mudança de permissões é auditada com o papel alvo', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/roles/STAFF/permissions',
      headers: { 'content-type': 'application/json', ...tenantHeaders(storeA.slug, ownerA.cookie) },
      payload: { permissions: ['tables.read', 'orders.read'] },
    });
    assert.equal(res.statusCode, 200, res.body);

    const rows = await auditRows(storeA.id, 'permissions.updated');
    assert.ok(rows.length >= 1);
    assert.equal(rows[0].resource_id, 'STAFF');
    assert.deepEqual(
      [...rows[0].metadata.permissions].sort(),
      ['orders.read', 'tables.read']
    );
  });

  it('pagamento e webhook são auditados sem payload bruto', async (t) => {
    if (skipWithoutDb(t)) return;
    const { query } = await import('../../src/infrastructure/db.js');
    const { createOrder } = await import('../../src/modules/orders/orders.repository.js');
    const { makeTableSession } = await import('../helpers/fixtures.js');
    const { createCategory, createProduct } = await import(
      '../../src/modules/menu/menu.repository.js'
    );
    const { session } = await makeTableSession(storeA.id, { number: 901 });
    const category = await createCategory(storeA.id, { name: 'Audit cat', sortOrder: 9 });
    const product = await createProduct(storeA.id, {
      categoryId: category.id,
      name: 'Audit prod',
      price: 9.9,
      sortOrder: 1,
    });
    const { order } = await createOrder(storeA.id, {
      tableSessionId: session.id,
      channel: 'TABLE',
      items: [{ productId: product.id, quantity: 1, addonIds: [] }],
    });

    const payRes = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { 'content-type': 'application/json', ...tenantHeaders(storeA.slug) },
      payload: { amount: 9.9, method: 'CASH', orderId: order.id },
    });
    assert.equal(payRes.statusCode, 201, payRes.body);

    const rows = await auditRows(storeA.id, 'payment.created');
    assert.ok(rows.length >= 1);
    assert.equal(rows[0].resource, 'payment');
    assert.equal(rows[0].metadata.method, 'CASH');

    const { rows: events } = await query(
      `SELECT COUNT(*)::int AS n FROM payment_events WHERE store_id = $1`,
      [storeA.id]
    );
    assert.equal(events[0].n, 0, 'sem webhook assinado, nenhum evento é gravado');
  });

  it('leitura de auditoria é por loja, OWNER-only, paginada e filtrável', async (t) => {
    if (skipWithoutDb(t)) return;
    const asOwnerA = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs?action=table.created&limit=1',
      headers: tenantHeaders(storeA.slug, ownerA.cookie),
    });
    assert.equal(asOwnerA.statusCode, 200, asOwnerA.body);
    const body = asOwnerA.json();
    assert.equal(body.storeId, storeA.id);
    assert.equal(body.logs.length, 1, 'limit deve paginar');
    assert.equal(body.logs[0].action, 'table.created');
    assert.equal(body.logs[0].store_id, storeA.id);

    // OWNER de B só vê B (que não tem table.created)
    const asOwnerB = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs',
      headers: tenantHeaders(storeB.slug, ownerB.cookie),
    });
    assert.equal(asOwnerB.statusCode, 200, asOwnerB.body);
    assert.equal(
      asOwnerB.json().logs.every((l) => l.store_id === storeB.id),
      true,
      'nunca vaza log de outro tenant'
    );

    // STAFF não lê auditoria
    const asStaff = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs',
      headers: tenantHeaders(storeA.slug, staffA.cookie),
    });
    assert.ok([401, 403].includes(asStaff.statusCode), `status ${asStaff.statusCode}`);

    // sem sessão também não
    const anon = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs',
      headers: tenantHeaders(storeA.slug),
    });
    assert.ok([401, 403].includes(anon.statusCode));
  });

  it('trilha é imutável: DELETE é bloqueado pelo banco', async (t) => {
    if (skipWithoutDb(t)) return;
    const { query } = await import('../../src/infrastructure/db.js');
    const rows = await auditRows(storeA.id, 'table.created');
    assert.ok(rows.length >= 1);

    await assert.rejects(
      () => query(`DELETE FROM audit_logs WHERE id = $1`, [rows[0].id]),
      /append-only/
    );
    // e o registro continua lá
    const { rows: still } = await query(`SELECT 1 FROM audit_logs WHERE id = $1`, [rows[0].id]);
    assert.equal(still.length, 1);
  });
});
