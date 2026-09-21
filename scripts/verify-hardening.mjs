#!/usr/bin/env node
/**
 * Verificador dos RISCOS RESIDUAIS do hardening (PR #151).
 *
 * Cada checagem é uma sonda real (banco + API em memória) que produz PASS/FAIL.
 * O objetivo é permitir que outro agente confirme, sem ler o código, que os
 * comportamentos declarados como "residual" são exatamente os observados.
 *
 * Uso:
 *   export DATABASE_URL=postgres://user:pass@host:5432/admin_restaurant
 *   NODE_ENV=test node scripts/verify-hardening.mjs
 *
 * Flags:
 *   --only=<id[,id]>   roda apenas algumas checagens (ver lista no final)
 *
 * ⚠ NUNCA rode contra produção: a checagem `auditoria-best-effort` cria um
 * trigger temporário em `audit_logs` (removido no `finally`) e as checagens
 * criam/apagam lojas de teste.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (process.env.NODE_ENV === 'production') {
  console.error('✘ NODE_ENV=production — este script cria/apaga dados de teste. Abortando.');
  process.exit(2);
}

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BASE_DOMAIN = process.env.BASE_DOMAIN || 'localhost';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'verify-jwt-secret-at-least-32-chars-long!!';
process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'verify-cookie-secret-change-me';

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '');
const ONLY = only ? new Set(only.split(',').map((s) => s.trim()).filter(Boolean)) : null;

const results = [];

async function check(id, title, fn) {
  if (ONLY && !ONLY.has(id)) return;
  try {
    const detail = await fn();
    results.push({ id, title, ok: true, detail: detail || 'comportamento esperado confirmado' });
    console.log(`✔ PASS  ${id} — ${title}\n        ${detail || ''}`);
  } catch (err) {
    results.push({ id, title, ok: false, detail: err?.message || String(err) });
    console.log(`✘ FAIL  ${id} — ${title}\n        ${err?.message || err}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const env = async () => {
  const db = await import('../src/infrastructure/db.js');
  const fixtures = await import('../test/helpers/fixtures.js');
  const orders = await import('../src/modules/orders/orders.repository.js');
  const payments = await import('../src/modules/payments/payments.repository.js');
  const webhookAuth = await import('../src/modules/payments/webhook-auth.js');
  const { buildApp } = await import('../src/app.js');
  return { ...db, ...fixtures, orders, payments, webhookAuth, buildApp };
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('✘ DATABASE_URL não definida.');
    process.exit(2);
  }

  const {
    query,
    pool,
    makeStoreWithProduct,
    makeTableSession,
    makeUserWithRole,
    dropStores,
    orders,
    payments,
    webhookAuth,
    buildApp,
  } = await env();

  process.env.WEBHOOK_SECRET_VERIFY = 'verify-webhook-secret';

  // ────────────────────────────────────────────────────────────── CHECK 0
  await check('migrations', 'migrações 0019–0021 e guarda de auditoria aplicadas', async () => {
    const { rows: indexes } = await query(
      `SELECT indexname FROM pg_indexes WHERE indexname IN
        ('uq_payments_provider_ref_global','uq_table_sessions_open_per_table')`
    );
    const names = indexes.map((r) => r.indexname);
    assert(
      names.includes('uq_payments_provider_ref_global'),
      'índice uq_payments_provider_ref_global ausente → rode npm run db:migrate (0019)'
    );
    assert(
      names.includes('uq_table_sessions_open_per_table'),
      'índice uq_table_sessions_open_per_table ausente → rode npm run db:migrate (0021)'
    );

    const { rows: cols } = await query(
      `SELECT table_name, column_name, data_type, numeric_precision, numeric_scale, is_nullable, column_default
       FROM information_schema.columns
       WHERE (table_name = 'order_items' AND column_name = 'addons_total')
          OR (table_name = 'table_sessions' AND column_name = 'expired_at')
          OR (table_name = 'payment_events' AND column_name = 'diagnostics')`
    );
    const addons = cols.find((c) => c.table_name === 'order_items');
    assert(addons, 'order_items.addons_total ausente → rode npm run db:migrate (0020)');
    assert(
      addons.data_type === 'numeric' && Number(addons.numeric_scale) === 2,
      `addons_total deveria ser NUMERIC(10,2), veio ${addons.data_type}(${addons.numeric_precision},${addons.numeric_scale})`
    );
    assert(addons.is_nullable === 'NO', 'addons_total deveria ser NOT NULL');
    assert(
      String(addons.column_default).includes('0'),
      `addons_total deveria ter default 0, veio ${addons.column_default}`
    );
    assert(
      cols.some((c) => c.column_name === 'expired_at'),
      'table_sessions.expired_at ausente → rode npm run db:migrate (0021)'
    );
    assert(
      cols.some((c) => c.column_name === 'diagnostics'),
      'payment_events.diagnostics ausente → rode npm run db:migrate (0019)'
    );

    const { rows: triggers } = await query(
      `SELECT tgname FROM pg_trigger WHERE tgname = 'audit_logs_immutable' AND NOT tgisinternal`
    );
    assert(triggers.length === 1, 'trigger audit_logs_immutable ausente (0018)');

    const checkTap = readFileSync(resolve(REPO_ROOT, 'scripts/check-tap.mjs'), 'utf8');
    const ci = readFileSync(resolve(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    assert(/MIN_TESTS ?? 281/.test(checkTap), 'check-tap.mjs deveria ter default MIN_TESTS=281');
    assert(/MIN_TESTS: '281'/.test(ci), "workflow deveria ter MIN_TESTS: '281'");

    return 'índices/colunas/trigger presentes e guarda de suíte elevada para 281';
  });

  // ────────────────────────────────────────────────────────────── CHECK 1
  let webhookStore = null;
  await check(
    'webhook-referencia-externa',
    'webhook só confirma pagamento com (provider, provider_payment_id) gravado',
    async () => {
      const app = await buildApp({ logger: false });
      await app.ready();
      try {
        const fx = await makeStoreWithProduct({ price: 42 });
        webhookStore = fx.store;
        const { session } = await makeTableSession(webhookStore.id, { number: 1 });
        const { order } = await orders.createOrder(webhookStore.id, {
          tableSessionId: session.id,
          channel: 'TABLE',
          items: [{ productId: fx.product.id, quantity: 1, addonIds: [] }],
        });

        // (a) pagamento com referência do provider → webhook assinado confirma
        const ref = `verify-ref-${Date.now()}`;
        const { payment } = await payments.createPayment(webhookStore.id, {
          amount: 42,
          method: 'OTHER',
          orderId: order.id,
          provider: 'verify',
          providerPaymentId: ref,
        });
        const raw = JSON.stringify({
          externalEventId: `verify-evt-${Date.now()}`,
          eventType: 'payment.paid',
          providerPaymentId: ref,
          amount: 42,
        });
        const res = await app.inject({
          method: 'POST',
          url: '/api/payments/webhooks/verify',
          headers: {
            'content-type': 'application/json',
            'x-signature': webhookAuth.signHmac(raw, process.env.WEBHOOK_SECRET_VERIFY),
          },
          payload: raw,
        });
        assert(res.statusCode === 200, `esperava 200, veio ${res.statusCode}: ${res.body}`);
        const body = res.json();
        assert(body.payment?.status === 'PAID', `pagamento não foi para PAID: ${res.body}`);

        const { rows: paidRows } = await query(`SELECT status FROM payments WHERE id = $1`, [
          payment.id,
        ]);
        assert(paidRows[0].status === 'PAID', 'banco não refletiu PAID');

        // (b) LACUNA CONHECIDA: referência desconhecida NÃO vira pagamento
        const rawUnknown = JSON.stringify({
          externalEventId: `verify-evt-unknown-${Date.now()}`,
          eventType: 'payment.paid',
          providerPaymentId: `nao-existe-${Date.now()}`,
          storeId: webhookStore.id, // dado não confiável: deve ser ignorado
        });
        const unknown = await app.inject({
          method: 'POST',
          url: '/api/payments/webhooks/verify',
          headers: {
            'content-type': 'application/json',
            'x-signature': webhookAuth.signHmac(rawUnknown, process.env.WEBHOOK_SECRET_VERIFY),
          },
          payload: rawUnknown,
        });
        assert(unknown.statusCode === 200, `esperava 200, veio ${unknown.statusCode}`);
        assert(
          unknown.json().payment === null,
          'referência desconhecida não pode resolver (nem criar) pagamento'
        );

        const { rows: evt } = await query(
          `SELECT store_id FROM payment_events WHERE provider = 'verify'
           ORDER BY created_at DESC LIMIT 1`
        );
        assert(
          evt[0].store_id === null,
          'evento sem pagamento resolvido não pode herdar storeId do body'
        );

        // (c) assinatura inválida nunca grava evento
        const { rows: before } = await query(
          `SELECT COUNT(*)::int AS n FROM payment_events WHERE provider = 'verify'`
        );
        const bad = await app.inject({
          method: 'POST',
          url: '/api/payments/webhooks/verify',
          headers: { 'content-type': 'application/json', 'x-signature': 'sha256=deadbeef' },
          payload: raw,
        });
        assert(bad.statusCode === 401, `assinatura inválida deveria dar 401, veio ${bad.statusCode}`);
        const { rows: after } = await query(
          `SELECT COUNT(*)::int AS n FROM payment_events WHERE provider = 'verify'`
        );
        assert(before[0].n === after[0].n, 'evento não autenticado foi gravado');

        return 'fluxo feliz OK; nenhum pagamento é criado a partir de referência desconhecida';
      } finally {
        await app.close();
      }
    }
  );

  // ────────────────────────────────────────────────────────────── CHECK 2
  await check(
    'referencia-global-unica',
    'mesma referência de provider não pode existir em duas lojas',
    async () => {
      const a = await makeStoreWithProduct({ price: 10 });
      const b = await makeStoreWithProduct({ price: 10 });
      const ref = `verify-global-${Date.now()}`;
      try {
        for (const fx of [a, b]) {
          const { session } = await makeTableSession(fx.store.id, { number: 3 });
          const { order } = await orders.createOrder(fx.store.id, {
            tableSessionId: session.id,
            channel: 'TABLE',
            items: [{ productId: fx.product.id, quantity: 1, addonIds: [] }],
          });
          await payments.createPayment(fx.store.id, {
            amount: 10,
            method: 'OTHER',
            orderId: order.id,
            provider: 'verify',
            providerPaymentId: ref,
          });
        }
        throw new Error('o banco aceitou a mesma referência em duas lojas (índice 0019 ausente?)');
      } catch (err) {
        const text = `${err?.code || ''} ${err?.message || ''}`;
        if (!/23505|duplicate key|uq_payments_provider_ref_global/i.test(text)) throw err;
        return `segunda inserção rejeitada pelo índice único global (${err.code || 'duplicate key'})`;
      } finally {
        await dropStores(a.store.id, b.store.id);
      }
    }
  );

  // ────────────────────────────────────────────────────────────── CHECK 3
  await check(
    'pix-chave-plataforma',
    'em produção a chave PIX da plataforma é fallback apenas com PIX_ALLOW_PLATFORM_KEY',
    async () => {
      const app = await buildApp({ logger: false });
      await app.ready();
      const prev = {
        nodeEnv: process.env.NODE_ENV,
        key: process.env.PIX_CHAVE,
        allow: process.env.PIX_ALLOW_PLATFORM_KEY,
      };
      const fx = await makeStoreWithProduct({ price: 25 }); // sem settings.pix
      try {
        const { table, session } = await makeTableSession(fx.store.id, { number: 4 });
        const { customerHeaders } = await import('../test/helpers/fixtures.js');
        const customerAuth = await customerHeaders(app, fx.store, table);
        const { order } = await orders.createOrder(fx.store.id, {
          tableSessionId: session.id,
          channel: 'TABLE',
          items: [{ productId: fx.product.id, quantity: 1, addonIds: [] }],
        });

        const post = () =>
          app.inject({
            method: 'POST',
            url: '/api/payments',
            headers: {
              'content-type': 'application/json',
              ...customerAuth,
            },
            payload: { amount: 25, method: 'PIX', orderId: order.id },
          });

        process.env.NODE_ENV = 'production';
        process.env.PIX_CHAVE = 'chave-da-plataforma@verify.local';
        delete process.env.PIX_ALLOW_PLATFORM_KEY;

        const blocked = await post();
        assert(
          blocked.statusCode === 503,
          `sem PIX_ALLOW_PLATFORM_KEY esperava 503 PIX_NOT_CONFIGURED, veio ${blocked.statusCode}: ${blocked.body}`
        );
        assert(
          blocked.json().error.code === 'PIX_NOT_CONFIGURED',
          `código inesperado: ${blocked.body}`
        );

        process.env.PIX_ALLOW_PLATFORM_KEY = 'true';
        const allowed = await post();
        assert(allowed.statusCode === 201, `com a flag esperava 201, veio ${allowed.statusCode}`);
        assert(
          allowed.json().payment.pixCopyPaste?.includes('chave-da-plataforma@verify.local'),
          'copia-e-cola não usou a chave da plataforma'
        );

        return 'gate confirmado: 503 por padrão em produção, 201 somente com a flag explícita';
      } finally {
        process.env.NODE_ENV = prev.nodeEnv;
        if (prev.key === undefined) delete process.env.PIX_CHAVE;
        else process.env.PIX_CHAVE = prev.key;
        if (prev.allow === undefined) delete process.env.PIX_ALLOW_PLATFORM_KEY;
        else process.env.PIX_ALLOW_PLATFORM_KEY = prev.allow;
        await app.close();
        await dropStores(fx.store.id);
      }
    }
  );

  // ────────────────────────────────────────────────────────────── CHECK 4
  await check(
    'auditoria-best-effort',
    'falha de auditoria não derruba a operação e não deixa rastro parcial',
    async () => {
      const app = await buildApp({ logger: false });
      await app.ready();
      const fx = await makeStoreWithProduct({ price: 5 });
      const owner = await makeUserWithRole(fx.store.id, { role: 'OWNER' });
      const { rows: auditBefore } = await query(
        `SELECT COUNT(*)::int AS n FROM audit_logs WHERE store_id = $1 AND action = 'table.created'`,
        [fx.store.id]
      );
      try {
        // trigger temporário: toda escrita de auditoria falha
        await query(`
          CREATE OR REPLACE FUNCTION verify_audit_fail() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit indisponível (verificação)'; END; $$;
        `);
        await query(`
          CREATE TRIGGER verify_audit_fail_trigger BEFORE INSERT ON audit_logs
          FOR EACH ROW EXECUTE FUNCTION verify_audit_fail();
        `);

        const res = await app.inject({
          method: 'POST',
          url: '/api/admin/tables',
          headers: {
            'content-type': 'application/json',
            host: `${fx.store.slug}.localhost`,
            cookie: owner.cookie,
          },
          payload: { number: 999 },
        });
        assert(
          res.statusCode === 201,
          `operação deveria continuar mesmo sem auditoria, veio ${res.statusCode}: ${res.body}`
        );

        const { rows: auditAfter } = await query(
          `SELECT COUNT(*)::int AS n FROM audit_logs WHERE store_id = $1 AND action = 'table.created'`,
          [fx.store.id]
        );
        assert(
          auditAfter[0].n === auditBefore[0].n,
          'não deveria existir linha de auditoria quando a escrita falha'
        );

        // a mesa FOI criada (a operação não foi desfeita)
        const { rows: tables } = await query(
          `SELECT number FROM tables WHERE store_id = $1 AND number = 999`,
          [fx.store.id]
        );
        assert(tables.length === 1, 'mesa deveria existir apesar da falha de auditoria');

        return 'operação 201 com auditoria indisponível; auditoria voltou a funcionar depois do trigger removido';
      } finally {
        await query(`DROP TRIGGER IF EXISTS verify_audit_fail_trigger ON audit_logs`);
        await query(`DROP FUNCTION IF EXISTS verify_audit_fail()`);
        await app.close();
        await dropStores(fx.store.id);
      }
    }
  );

  // ────────────────────────────────────────────────────────────── CHECK 5
  await check(
    'rate-limit-em-memoria',
    'contadores de limite são por instância (single node)',
    async () => {
      const prevMax = process.env.LOGIN_RATE_LIMIT_MAX;
      process.env.LOGIN_RATE_LIMIT_MAX = '5';
      const fx = await makeStoreWithProduct({ price: 3 });
      try {
        const appA = await buildApp({ logger: false });
        await appA.ready();
        const attempt = (app) =>
          app.inject({
            method: 'POST',
            url: '/api/auth/store/login',
            headers: { 'content-type': 'application/json', host: `${fx.store.slug}.localhost` },
            payload: { email: 'ninguem@verify.local', password: 'senha-errada-123' },
          });

        const statuses = [];
        for (let i = 0; i < 6; i++) statuses.push((await attempt(appA)).statusCode);
        assert(statuses.includes(429), `esperava 429 no limite, veio ${statuses.join(',')}`);
        await appA.close();

        // instância NOVA no mesmo processo: contador zerado → 401 (e não 429)
        const appB = await buildApp({ logger: false });
        await appB.ready();
        const fresh = await attempt(appB);
        await appB.close();
        assert(
          fresh.statusCode === 401,
          `instância nova deveria ter contador próprio (401), veio ${fresh.statusCode}`
        );

        return 'limite efetivo por processo/instância; multi-node exige store compartilhado';
      } finally {
        if (prevMax === undefined) delete process.env.LOGIN_RATE_LIMIT_MAX;
        else process.env.LOGIN_RATE_LIMIT_MAX = prevMax;
        await dropStores(fx.store.id);
      }
    }
  );

  // ────────────────────────────────────────────────────────────── CHECK 6
  await check(
    'paineis-403',
    'painel sem permissão recebe 403 (o hook do frontend expõe o erro, não engole)',
    async () => {
      const app = await buildApp({ logger: false });
      await app.ready();
      const a = await makeStoreWithProduct({ price: 4 });
      const b = await makeStoreWithProduct({ price: 4 });
      try {
        const staff = await makeUserWithRole(a.store.id, { role: 'STAFF' });
        // usuário de A pedindo a fila de B → sem acesso
        const cross = await app.inject({
          method: 'GET',
          url: '/api/kitchen/orders?station=KITCHEN',
          headers: { host: `${b.store.slug}.localhost`, cookie: staff.cookie },
        });
        assert(
          [401, 403].includes(cross.statusCode),
          `esperava 401/403, veio ${cross.statusCode}: ${cross.body}`
        );

        const own = await app.inject({
          method: 'GET',
          url: '/api/kitchen/orders?station=KITCHEN',
          headers: { host: `${a.store.slug}.localhost`, cookie: staff.cookie },
        });
        assert(own.statusCode === 200, `STAFF deveria ver a própria loja: ${own.body}`);

        const hook = readFileSync(
          resolve(REPO_ROOT, 'frontend/src/hooks/usePolling.js'),
          'utf8'
        );
        assert(/setError\(err\)/.test(hook), 'usePolling deveria expor erro (403 incluído)');
        assert(/isRateLimited/.test(hook), 'usePolling deveria tratar 429');
        assert(/document\.hidden/.test(hook), 'usePolling deveria pausar com aba oculta');

        return '403 do servidor confirmado; hook classifica 401/403/429/5xx — checagem visual é manual (docs/VERIFY-RESIDUAL-RISKS.md)';
      } finally {
        await app.close();
        await dropStores(a.store.id, b.store.id);
      }
    }
  );

  await pool.end();

  const failed = results.filter((r) => !r.ok);
  console.log('\n──────────── resumo ────────────');
  for (const r of results) {
    console.log(`${r.ok ? '✔' : '✘'} ${r.id}: ${r.detail}`);
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} checagens OK` +
      (failed.length ? ` — ${failed.length} FALHA(S)` : '')
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('✘ erro inesperado no verificador:', err);
  process.exit(2);
});
