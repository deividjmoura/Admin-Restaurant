/**
 * Guarda de suíte: impede o "verde falso" de `node --test`.
 *
 * `node --test` sai com exit 0 mesmo quando não há banco disponível — os testes de
 * integração ficam em `skipped` e o job parece verde. Este script lê o relatório TAP
 * (stdin ou arquivo) e falha se:
 *   - `# fail` > 0
 *   - `# skipped` > 0
 *   - `# tests` < MÍNIMO (a suíte sumiu/mudou de nome e ninguém percebeu)
 *
 * Uso:
 *   node scripts/check-tap.mjs .tap/suite.tap        # relatório gravado em arquivo
 *   npm test -- --test-reporter=tap | node scripts/check-tap.mjs   # ou via stdin
 *
 * Variáveis:
 *   MIN_TESTS   mínimo de testes esperados (default 204)
 *   ALLOW_SKIP  "1" relaxa a checagem de skipped (não usar em CI)
 */
import { readFileSync } from 'node:fs';

const MIN_TESTS = Number(process.env.MIN_TESTS ?? 204);
const ALLOW_SKIP = process.env.ALLOW_SKIP === '1';

const file = process.argv[2];
const raw = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');

const counter = (name) => {
  const m = raw.match(new RegExp(`^# ${name} (\\d+)$`, 'm'));
  return m ? Number(m[1]) : null;
};

const tests = counter('tests');
const pass = counter('pass');
const fail = counter('fail');
const skipped = counter('skipped');
const cancelled = counter('cancelled') ?? 0;

// `node --test` reporta falha de suíte/hook como `not ok` com `fail 0` e
// `cancelled N`. Contar só o `# fail` deixaria isso passar como verde.
const notOk = raw.split('\n').filter((l) => /^not ok /.test(l));

if (tests === null || fail === null || skipped === null) {
  console.error('[check-tap] não encontrei o resumo TAP ("# tests"/"# pass"/"# fail").');
  console.error('[check-tap] Rode com o reporter TAP: npm test -- --test-reporter=tap');
  process.exit(2);
}

console.log(
  `[check-tap] tests=${tests} pass=${pass} fail=${fail} skipped=${skipped} cancelled=${cancelled} ` +
    `not_ok=${notOk.length} (mínimo ${MIN_TESTS})`,
);

const problems = [];
if (fail > 0) problems.push(`${fail} teste(s) com falha`);
if (cancelled > 0) {
  problems.push(
    `${cancelled} teste(s) cancelados — normalmente um hook before()/after() quebrou a suíte`,
  );
}
if (notOk.length > 0) {
  const first = notOk[0].replace(/^not ok \d* ?-? ?/, '').slice(0, 90);
  problems.push(`${notOk.length} linha(s) "not ok" no relatório (primeira: ${first})`);
}
if (skipped > 0 && !ALLOW_SKIP) {
  problems.push(
    `${skipped} teste(s) ignorados — quase sempre DATABASE_URL ausente no shell. ` +
      '`node --test` não lê .env: exporte a variável antes de `npm test`.',
  );
}
if (tests < MIN_TESTS) {
  problems.push(`apenas ${tests} testes executados (esperado ≥ ${MIN_TESTS})`);
}

if (problems.length > 0) {
  console.error(`[check-tap] SUÍTE NÃO ACEITA:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

console.log(`[check-tap] OK — ${pass} testes executados, 0 falhas, 0 ignorados.`);
