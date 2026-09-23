/**
 * Issues #107 (sessão de caixa) e #108 (ledger de movimentações).
 *
 * O que precisa valer em produção:
 *  1. uma gaveta aberta por operador/loja (duplo clique → 409, não duas gavetas);
 *  2. ledger append-only: suprimento/sangria/ajuste com motivo, idempotente;
 *  3. esperado = entradas − saídas, sempre derivado do ledger (nunca informado);
 *  4. fechamento reconcilia esperado x contado, é idempotente e bloqueia
 *     movimentação posterior;
 *  5. isolamento: sessão/movimento de outra loja → **404**; papel sem permissão
 *     → 403; gaveta de outro operador → 403 (STAFF), liberada para gerente.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

describe('Caixa — sessão e ledger (issues #107/#108)', () => {
  /** @type {import('fastify').FastifyInstance | null} */
  let app = null;
  let storeA = null;
  let storeB = null;
  let ownerA = null;
  let cashierA = null;
  let kitchenA = null;
  let ownerB = null;

  // Host subdomain is the canonical tenant source; apex+header is blocked (SEC-01).
  const slugA = () => ({ host: `${storeA.slug}.localhost` });
  const slugB = () => ({ host: `${storeB.slug}.localhost` });

  before(async () => {
    if (!hasDatabase()) return;

    process.env.NODE_ENV = 'development';
    process.env.BASE_DOMAIN = process.env.BASE_DOMAIN || 'localhost';
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long!!';
    process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'test-cookie-secret-change-me';

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();

    const { makeStore, makeUserWithRole } = await import('../helpers/fixtures.js');
    storeA = await makeStore({ name: 'Caixa A' });
    storeB = await makeStore({ name: 'Caixa B' });

    ownerA = await makeUserWithRole(storeA.id, { role: 'OWNER' });
    cashierA = await makeUserWithRole(storeA.id, { role: 'STAFF' });
    kitchenA = await makeUserWithRole(storeA.id, { role: 'KITCHEN' });
    ownerB = await makeUserWithRole(storeB.id, { role: 'OWNER' });
  });

  after(async () => {
    if (app) await app.close();
    if (!hasDatabase() || !storeA) return;
    const { dropStores } = await import('../helpers/fixtures.js');
    await dropStores(storeA.id, storeB.id);
  });

  /**
   * Gaveta aberta do usuário: usa a existente ou abre uma nova. Mantém os testes
   * independentes da ordem/estado (o que importa é o delta, não o absoluto).
   */
  async function ensureSession(cookie, { opening = 0, headers = slugA() } = {}) {
    const active = await app.inject({
      method: 'GET',
      url: '/api/cash/sessions/active',
      headers: { cookie, ...headers },
    });
    assert.equal(active.statusCode, 200, active.body);
    if (active.json().session) return active.json().session;

    const open = await openCash({ cookie, headers, body: { openingAmount: opening } });
    if (open.statusCode === 201) return open.json().session;
    assert.equal(open.statusCode, 409, open.body);

    const retry = await app.inject({
      method: 'GET',
      url: '/api/cash/sessions/active',
      headers: { cookie, ...headers },
    });
    assert.ok(retry.json().session, 'sessão aberta deveria existir após 409');
    return retry.json().session;
  }

  async function openCash({ cookie, headers = slugA(), body = {}, key = null }) {
    return app.inject({
      method: 'POST',
      url: '/api/cash/sessions',
      headers: {
        cookie,
        'content-type': 'application/json',
        ...(key ? { 'idempotency-key': key } : {}),
        ...headers,
      },
      payload: body,
    });
  }

  it('abre sessão com fundo de troco e lança OPENING no ledger', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await openCash({
      cookie: ownerA.cookie,
      body: { openingAmount: 150, notes: 'Turno da noite' },
    });
    assert.equal(res.statusCode, 201, res.body);

    const body = res.json();
    assert.equal(body.replayed, false);
    assert.equal(body.session.status, 'open');
    assert.equal(body.session.storeId, storeA.id);
    assert.equal(body.session.operatorId, ownerA.user.id);
    assert.equal(body.session.openingAmount, 150);
    assert.equal(body.session.totals.expected, 150);
    assert.equal(body.openingMovement.type, 'OPENING');
    assert.equal(body.openingMovement.direction, 'IN');
    assert.equal(body.openingMovement.amount, 150);

    // fundo de troco zero não gera movimento
    const zero = await openCash({ cookie: cashierA.cookie, body: { openingAmount: 0 } });
    assert.equal(zero.statusCode, 201, zero.body);
    assert.equal(zero.json().openingMovement, null);
    assert.equal(zero.json().session.totals.expected, 0);

    // limpeza: fecha a gaveta do operador STAFF criada aqui
    const closed = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${zero.json().session.id}/close`,
      headers: { cookie: ownerA.cookie, 'content-type': 'application/json', ...slugA() },
      payload: { countedAmount: 0 },
    });
    assert.equal(closed.statusCode, 200, closed.body);
  });

  it('retry com a mesma Idempotency-Key devolve a mesma sessão (replayed)', async (t) => {
    if (skipWithoutDb(t)) return;

    const key = 'cash-open-idem-0001';
    const first = await openCash({
      cookie: cashierA.cookie,
      key,
      body: { openingAmount: 80 },
    });
    assert.equal(first.statusCode, 201, first.body);

    const second = await openCash({
      cookie: cashierA.cookie,
      key,
      body: { openingAmount: 80 },
    });
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().replayed, true);
    assert.equal(second.json().session.id, first.json().session.id);

    const list = await app.inject({
      method: 'GET',
      url: '/api/cash/sessions?status=open',
      headers: { cookie: ownerA.cookie, ...slugA() },
    });
    const forCashier = list
      .json()
      .sessions.filter((s) => s.operatorId === cashierA.user.id);
    assert.equal(forCashier.length, 1, 'idempotência não pode criar duas gavetas');
  });

  it('duas gavetas abertas para o mesmo operador → 409 com a sessão existente', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await openCash({ cookie: cashierA.cookie, body: { openingAmount: 10 } });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'CASH_SESSION_ALREADY_OPEN');
    assert.ok(res.json().error.details.sessionId, 'deveria apontar a gaveta aberta');
  });

  it('papel sem permissão não abre caixa (KITCHEN → 403)', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await openCash({ cookie: kitchenA.cookie, body: { openingAmount: 10 } });
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json().error.code, 'FORBIDDEN');
  });

  it('STAFF não abre gaveta para outro operador; OWNER abre', async (t) => {
    if (skipWithoutDb(t)) return;

    const forbidden = await openCash({
      cookie: cashierA.cookie,
      body: { operatorId: ownerA.user.id, openingAmount: 5 },
    });
    // OWNER já tem gaveta aberta neste ponto → o que importa é NÃO ser 201
    assert.ok([403, 409].includes(forbidden.statusCode), forbidden.body);

    const second = await makeOperator();
    const byOwner = await openCash({
      cookie: ownerA.cookie,
      body: { operatorId: second.user.id, openingAmount: 25 },
    });
    assert.equal(byOwner.statusCode, 201, byOwner.body);
    assert.equal(byOwner.json().session.operatorId, second.user.id);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/cash/sessions?status=open',
      headers: { cookie: ownerA.cookie, ...slugA() },
    });
    assert.ok(
      listed.json().sessions.some((s) => s.operatorId === second.user.id),
      'gerente precisa ver a gaveta que abriu para o operador'
    );

    // STAFF não vê gaveta de outro operador na lista
    const staffList = await app.inject({
      method: 'GET',
      url: '/api/cash/sessions?status=open',
      headers: { cookie: second.cookie, ...slugA() },
    });
    assert.equal(staffList.statusCode, 200);
    assert.ok(
      staffList.json().sessions.every((s) => s.operatorId === second.user.id),
      'STAFF só pode listar a própria gaveta'
    );
  });

  async function makeOperator() {
    const { makeUserWithRole } = await import('../helpers/fixtures.js');
    return makeUserWithRole(storeA.id, { role: 'STAFF' });
  }

  it('movimentações compõem o esperado: suprimento, sangria e ajuste', async (t) => {
    if (skipWithoutDb(t)) return;

    const session = await ensureSession(ownerA.cookie, { opening: 150 });
    const sessionId = session.id;
    const base = session.totals.expected;

    const move = (payload, key = null) =>
      app.inject({
        method: 'POST',
        url: `/api/cash/sessions/${sessionId}/movements`,
        headers: {
          cookie: ownerA.cookie,
          'content-type': 'application/json',
          ...(key ? { 'idempotency-key': key } : {}),
          ...slugA(),
        },
        payload,
      });

    const supply = await move({ type: 'SUPPLY', amount: 50, reason: 'Reforço de troco' });
    assert.equal(supply.statusCode, 201, supply.body);
    assert.equal(supply.json().movement.direction, 'IN');
    assert.equal(supply.json().session.totals.expected, base + 50);

    const withdrawal = await move({
      type: 'WITHDRAWAL',
      amount: 30,
      reason: 'Depósito no banco',
    });
    assert.equal(withdrawal.statusCode, 201, withdrawal.body);
    assert.equal(withdrawal.json().movement.direction, 'OUT');
    assert.equal(withdrawal.json().session.totals.expected, base + 20);

    const adjustOut = await move({
      type: 'ADJUSTMENT',
      amount: 5,
      direction: 'OUT',
      reason: 'Nota de R$5 rasgada',
    });
    assert.equal(adjustOut.statusCode, 201, adjustOut.body);
    assert.equal(adjustOut.json().session.totals.expected, base + 15);

    const adjustIn = await move({
      type: 'ADJUSTMENT',
      amount: 2.5,
      direction: 'IN',
      reason: 'Troco encontrado',
    });
    assert.equal(adjustIn.statusCode, 201, adjustIn.body);
    assert.equal(adjustIn.json().session.totals.expected, base + 17.5);

    // byType agrupa por (tipo, direção): ajuste de entrada e de saída são linhas
    // distintas — o relatório soma com sinal.
    const rows = adjustIn.json().session.totals.byType;
    const totalOf = (type, direction = null) =>
      rows
        .filter((row) => row.type === type && (!direction || row.direction === direction))
        .reduce((acc, row) => acc + row.total, 0);
    assert.equal(totalOf('OPENING'), 150);
    assert.equal(totalOf('SUPPLY'), 50);
    assert.equal(totalOf('WITHDRAWAL'), 30);
    assert.equal(totalOf('ADJUSTMENT', 'IN'), 2.5);
    assert.equal(totalOf('ADJUSTMENT', 'OUT'), 5);
  });

  it('movimentação exige motivo e rejeita tipo inválido/valor inválido', async (t) => {
    if (skipWithoutDb(t)) return;

    const sessionId = (await ensureSession(ownerA.cookie, { opening: 150 })).id;

    const move = (payload) =>
      app.inject({
        method: 'POST',
        url: `/api/cash/sessions/${sessionId}/movements`,
        headers: { cookie: ownerA.cookie, 'content-type': 'application/json', ...slugA() },
        payload,
      });

    const noReason = await move({ type: 'WITHDRAWAL', amount: 10 });
    assert.equal(noReason.statusCode, 400, noReason.body);

    const saleManual = await move({ type: 'SALE', amount: 10, reason: 'venda manual' });
    assert.equal(saleManual.statusCode, 400, saleManual.body);
    assert.equal(saleManual.json().error.code, 'VALIDATION_ERROR');

    const negative = await move({ type: 'SUPPLY', amount: -5, reason: 'negativo' });
    assert.equal(negative.statusCode, 400, negative.body);

    const cents = await move({ type: 'SUPPLY', amount: 10.005, reason: 'mais de 2 casas' });
    assert.equal(cents.statusCode, 400, cents.body);

    const extraField = await move({
      type: 'SUPPLY',
      amount: 10,
      reason: 'com campo extra',
      expectedAmount: 999,
    });
    assert.equal(extraField.statusCode, 400, 'cliente não pode ditar o esperado');
  });

  it('movimentação é idempotente por Idempotency-Key', async (t) => {
    if (skipWithoutDb(t)) return;

    const sessionId = (await ensureSession(ownerA.cookie, { opening: 150 })).id;
    const key = 'cash-move-idem-0001';

    const first = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionId}/movements`,
      headers: {
        cookie: ownerA.cookie,
        'content-type': 'application/json',
        'idempotency-key': key,
        ...slugA(),
      },
      payload: { type: 'SUPPLY', amount: 20, reason: 'Reforço' },
    });
    assert.equal(first.statusCode, 201, first.body);
    const expectedAfterFirst = first.json().session.totals.expected;

    const second = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionId}/movements`,
      headers: {
        cookie: ownerA.cookie,
        'content-type': 'application/json',
        'idempotency-key': key,
        ...slugA(),
      },
      payload: { type: 'SUPPLY', amount: 20, reason: 'Reforço' },
    });
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().replayed, true);
    assert.equal(second.json().movement.id, first.json().movement.id);
    assert.equal(second.json().session.totals.expected, expectedAfterFirst);

    const ledger = await app.inject({
      method: 'GET',
      url: `/api/cash/sessions/${sessionId}/movements`,
      headers: { cookie: ownerA.cookie, ...slugA() },
    });
    assert.equal(ledger.statusCode, 200);
    const supplies = ledger.json().movements.filter(
      (m) => m.type === 'SUPPLY' && m.idempotencyKey === key
    );
    assert.equal(supplies.length, 1, 'retry não pode duplicar movimento');
  });

  it('fechamento reconcilia esperado x contado e é idempotente', async (t) => {
    if (skipWithoutDb(t)) return;

    const session = await ensureSession(ownerA.cookie, { opening: 150 });
    const sessionId = session.id;
    const expected = session.totals.expected;

    const withoutCount = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionId}/close`,
      headers: { cookie: ownerA.cookie, 'content-type': 'application/json', ...slugA() },
      payload: {},
    });
    assert.equal(withoutCount.statusCode, 400, withoutCount.body);
    assert.equal(withoutCount.json().error.code, 'CASH_COUNT_REQUIRED');

    const counted = expected - 12.5; // falta dinheiro na gaveta
    const close = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionId}/close`,
      headers: { cookie: ownerA.cookie, 'content-type': 'application/json', ...slugA() },
      payload: { countedAmount: counted, notes: 'Fechamento do turno' },
    });
    assert.equal(close.statusCode, 200, close.body);

    const body = close.json();
    assert.equal(body.alreadyClosed, false);
    assert.equal(body.session.status, 'closed');
    assert.equal(body.session.expectedAmount, expected);
    assert.equal(body.session.countedAmount, counted);
    assert.equal(body.session.differenceAmount, -12.5);
    assert.ok(body.warnings.some((w) => w.code === 'CASH_SHORT'), JSON.stringify(body.warnings));

    // idempotente: segundo close devolve o MESMO resultado (não refaz contas)
    const again = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionId}/close`,
      headers: { cookie: ownerA.cookie, 'content-type': 'application/json', ...slugA() },
      payload: { countedAmount: 9999 },
    });
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().alreadyClosed, true);
    assert.equal(again.json().session.countedAmount, counted);
    assert.equal(again.json().session.differenceAmount, -12.5);

    // gaveta fechada não aceita movimentação
    const afterClose = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionId}/movements`,
      headers: { cookie: ownerA.cookie, 'content-type': 'application/json', ...slugA() },
      payload: { type: 'SUPPLY', amount: 10, reason: 'depois de fechar' },
    });
    assert.equal(afterClose.statusCode, 409, afterClose.body);
    assert.equal(afterClose.json().error.code, 'CASH_SESSION_CLOSED');
  });

  it('fechamento com valor exato reconcilia (difference 0)', async (t) => {
    if (skipWithoutDb(t)) return;

    const open = await openCash({ cookie: cashierA.cookie, body: { openingAmount: 40 } });
    // cashierA já tinha gaveta aberta do teste de idempotência → usa a existente
    const active = await app.inject({
      method: 'GET',
      url: '/api/cash/sessions/active',
      headers: { cookie: cashierA.cookie, ...slugA() },
    });
    const sessionId = active.json().session.id;
    const expected = active.json().session.totals.expected;
    assert.ok([201, 409].includes(open.statusCode), open.body);

    const close = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionId}/close`,
      headers: { cookie: cashierA.cookie, 'content-type': 'application/json', ...slugA() },
      payload: { countedAmount: expected },
    });
    // STAFF não tem cashier.cash.close → quem fecha é o gerente
    if (close.statusCode === 403) {
      const byOwner = await app.inject({
        method: 'POST',
        url: `/api/cash/sessions/${sessionId}/close`,
        headers: { cookie: ownerA.cookie, 'content-type': 'application/json', ...slugA() },
        payload: { countedAmount: expected },
      });
      assert.equal(byOwner.statusCode, 200, byOwner.body);
      assert.equal(byOwner.json().session.differenceAmount, 0);
      assert.equal(byOwner.json().warnings.length, 0);
    } else {
      assert.equal(close.statusCode, 200, close.body);
      assert.equal(close.json().session.differenceAmount, 0);
    }
  });

  it('STAFF não fecha gaveta (permissão cashier.cash.close é de gerente)', async (t) => {
    if (skipWithoutDb(t)) return;

    const open = await openCash({ cookie: cashierA.cookie, body: { openingAmount: 15 } });
    assert.equal(open.statusCode, 201, open.body);
    const sessionId = open.json().session.id;

    const staffClose = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionId}/close`,
      headers: { cookie: cashierA.cookie, 'content-type': 'application/json', ...slugA() },
      payload: { countedAmount: 15 },
    });
    assert.equal(staffClose.statusCode, 403, staffClose.body);

    const managerClose = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionId}/close`,
      headers: { cookie: ownerA.cookie, 'content-type': 'application/json', ...slugA() },
      payload: { countedAmount: 15 },
    });
    assert.equal(managerClose.statusCode, 200, managerClose.body);
  });

  it('STAFF não movimenta gaveta de outro operador (403)', async (t) => {
    if (skipWithoutDb(t)) return;

    const open = await openCash({ cookie: ownerA.cookie, body: { openingAmount: 10 } });
    assert.equal(open.statusCode, 201, open.body);
    const sessionId = open.json().session.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionId}/movements`,
      headers: { cookie: cashierA.cookie, 'content-type': 'application/json', ...slugA() },
      payload: { type: 'WITHDRAWAL', amount: 5, reason: 'sangria indevida' },
    });
    assert.equal(res.statusCode, 403, res.body);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/cash/sessions/${sessionId}`,
      headers: { cookie: cashierA.cookie, ...slugA() },
    });
    assert.equal(detail.statusCode, 403, detail.body);

    const byOwner = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionId}/movements`,
      headers: { cookie: ownerA.cookie, 'content-type': 'application/json', ...slugA() },
      payload: { type: 'WITHDRAWAL', amount: 5, reason: 'sangria autorizada' },
    });
    assert.equal(byOwner.statusCode, 201, byOwner.body);

    const closeIt = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionId}/close`,
      headers: { cookie: ownerA.cookie, 'content-type': 'application/json', ...slugA() },
      payload: { countedAmount: 5 },
    });
    assert.equal(closeIt.statusCode, 200, closeIt.body);
    assert.equal(closeIt.json().session.differenceAmount, 0);
  });

  it('isolamento: sessão/movimento de outra loja → 404 (nunca 403)', async (t) => {
    if (skipWithoutDb(t)) return;

    const open = await openCash({ cookie: ownerA.cookie, body: { openingAmount: 60 } });
    assert.equal(open.statusCode, 201, open.body);
    const sessionId = open.json().session.id;

    const detail = await app.inject({
      method: 'GET',
      url: `/api/cash/sessions/${sessionId}`,
      headers: { cookie: ownerB.cookie, ...slugB() },
    });
    assert.equal(detail.statusCode, 404, detail.body);
    assert.equal(detail.json().error.code, 'CASH_SESSION_NOT_FOUND');

    const movements = await app.inject({
      method: 'GET',
      url: `/api/cash/sessions/${sessionId}/movements`,
      headers: { cookie: ownerB.cookie, ...slugB() },
    });
    assert.equal(movements.statusCode, 404, movements.body);

    const move = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionId}/movements`,
      headers: { cookie: ownerB.cookie, 'content-type': 'application/json', ...slugB() },
      payload: { type: 'WITHDRAWAL', amount: 60, reason: 'sangria cross-tenant' },
    });
    assert.equal(move.statusCode, 404, move.body);

    const close = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionId}/close`,
      headers: { cookie: ownerB.cookie, 'content-type': 'application/json', ...slugB() },
      payload: { countedAmount: 0 },
    });
    assert.equal(close.statusCode, 404, close.body);

    const report = await app.inject({
      method: 'GET',
      url: `/api/cash/sessions/${sessionId}/report`,
      headers: { cookie: ownerB.cookie, ...slugB() },
    });
    assert.equal(report.statusCode, 404, report.body);

    // A gaveta de A continua intacta
    const stillOpen = await app.inject({
      method: 'GET',
      url: `/api/cash/sessions/${sessionId}`,
      headers: { cookie: ownerA.cookie, ...slugA() },
    });
    assert.equal(stillOpen.statusCode, 200);
    assert.equal(stillOpen.json().session.status, 'open');
    assert.equal(stillOpen.json().session.totals.expected, 60);

    await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionId}/close`,
      headers: { cookie: ownerA.cookie, 'content-type': 'application/json', ...slugA() },
      payload: { countedAmount: 60 },
    });
  });

  it('lista de sessões nunca mistura lojas', async (t) => {
    if (skipWithoutDb(t)) return;

    const openB = await openCash({
      cookie: ownerB.cookie,
      headers: slugB(),
      body: { openingAmount: 33 },
    });
    assert.equal(openB.statusCode, 201, openB.body);

    const [listA, listB] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/api/cash/sessions',
        headers: { cookie: ownerA.cookie, ...slugA() },
      }),
      app.inject({
        method: 'GET',
        url: '/api/cash/sessions',
        headers: { cookie: ownerB.cookie, ...slugB() },
      }),
    ]);

    assert.equal(listA.statusCode, 200);
    assert.equal(listB.statusCode, 200);
    assert.ok(listA.json().sessions.every((s) => s.storeId === storeA.id));
    assert.ok(listB.json().sessions.every((s) => s.storeId === storeB.id));
    assert.equal(listB.json().sessions.length, 1);

    const reportB = await app.inject({
      method: 'GET',
      url: '/api/cash/report',
      headers: { cookie: ownerB.cookie, ...slugB() },
    });
    assert.equal(reportB.statusCode, 200, reportB.body);
    assert.equal(reportB.json().storeId, storeB.id);
    assert.equal(reportB.json().sessions.total, 1);

    await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${openB.json().session.id}/close`,
      headers: { cookie: ownerB.cookie, 'content-type': 'application/json', ...slugB() },
      payload: { countedAmount: 33 },
    });
  });

  it('sem tenant a rota de caixa exige tenant (400)', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/cash/sessions',
      headers: { cookie: ownerA.cookie, 'content-type': 'application/json' },
      payload: { openingAmount: 1 },
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.code, 'TENANT_REQUIRED');
  });

  it('ledger é append-only no banco (UPDATE rejeitado por trigger)', async (t) => {
    if (skipWithoutDb(t)) return;

    const { query } = await import('../../src/infrastructure/db.js');
    await assert.rejects(
      () => query(`UPDATE cash_movements SET amount = amount + 1 WHERE store_id = $1`, [storeA.id]),
      /append-only/i,
      'ledger de caixa não pode ser editado nem por SQL privilegiado'
    );

    // DELETE continua liberado apenas para a cascata de remoção da loja
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM cash_movements WHERE store_id = $1`,
      [storeA.id]
    );
    assert.ok(rows[0].n > 0, 'ledger deveria ter movimentos da loja A');
  });

  it('auditoria registra abertura, movimentação e fechamento', async (t) => {
    if (skipWithoutDb(t)) return;

    const { query } = await import('../../src/infrastructure/db.js');
    const { rows } = await query(
      `SELECT action, COUNT(*)::int AS n
       FROM audit_logs
       WHERE store_id = $1 AND action LIKE 'cash.%'
       GROUP BY action ORDER BY action`,
      [storeA.id]
    );
    const actions = Object.fromEntries(rows.map((r) => [r.action, r.n]));
    assert.ok(actions['cash.session_opened'] >= 1, JSON.stringify(actions));
    assert.ok(actions['cash.movement_recorded'] >= 1, JSON.stringify(actions));
    assert.ok(actions['cash.session_closed'] >= 1, JSON.stringify(actions));
  });
});
