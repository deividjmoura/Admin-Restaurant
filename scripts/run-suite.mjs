#!/usr/bin/env node
/**
 * Roda a suíte completa e recusa "verde falso".
 *
 * Passos: exige DATABASE_URL → aplica migrations → descobre `test/**\/*.test.js` →
 * `node --test --test-reporter=tap` (saída gravada em .tap/suite.tap) → guarda de contagem.
 * É o comando único para o CI e para a checagem local antes de pedir revisão.
 *
 * Uso:
 *   export DATABASE_URL=postgres://user:pass@localhost:5432/admin_restaurant
 *   npm run test:suite                    # migrations + testes + guarda
 *   SKIP_MIGRATE=1 npm run test:suite     # quando o banco já está migrado
 *
 * Saída:
 *   exit 0  → fail 0 E skipped 0 E contagem ≥ MIN_TESTS
 *   exit 1  → testes falharam ou a guarda recusou o resultado
 *   exit 2  → DATABASE_URL ausente / não achei arquivo de teste
 */
import { spawnSync } from 'node:child_process';
import { globSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const tapDir = join(root, '.tap');
const tapFile = join(tapDir, 'suite.tap');

const run = (args, opts = {}) => {
  console.log(`\n$ node ${args.join(' ')}`);
  return spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', ...opts });
};

if (!process.env.DATABASE_URL) {
  console.error(
    '[test:suite] DATABASE_URL ausente.\n' +
      '  `node --test` NÃO lê .env — sem a variável no ambiente a suíte fica com skipped > 0\n' +
      '  e ainda assim sai com exit 0 (verde falso).\n' +
      '  Exemplo: export DATABASE_URL=postgres://user:pass@localhost:5432/admin_restaurant',
  );
  process.exit(2);
}

if (process.env.SKIP_MIGRATE !== '1') {
  if ((run(['scripts/migrate.js']).status ?? 1) !== 0) {
    console.error('[test:suite] migrations falharam — abortando antes dos testes.');
    process.exit(1);
  }
}

// Node não trata `test` (diretório) como alvo de teste: resolveria o builtin node:test.
// Descobrimos os arquivos aqui e passamos a lista explícita.
const files = globSync('test/**/*.test.js', { cwd: root }).sort();
if (files.length === 0) {
  console.error('[test:suite] nenhum arquivo test/**/*.test.js encontrado.');
  process.exit(2);
}
console.log(`\n[test:suite] ${files.length} arquivos de teste encontrados.`);

mkdirSync(tapDir, { recursive: true });
const test = run(['--test', '--test-reporter=tap', ...files], { stdio: ['inherit', 'pipe', 'inherit'] });
const tap = test.stdout?.toString('utf8') ?? '';
writeFileSync(tapFile, tap);
process.stdout.write(tap);
console.log(`[test:suite] relatório TAP gravado em ${tapFile}`);

const code = test.status ?? 1;
console.log(`\n[test:suite] node --test saiu com ${code} — validando contagem do relatório...`);

const guard = run([join(here, 'check-tap.mjs'), tapFile]);
process.exit(code !== 0 ? code : (guard.status ?? 1));
