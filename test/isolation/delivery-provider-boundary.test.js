/**
 * Prova estrutural: orders não importa delivery/providers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

describe('dependência unidirecional orders ↛ delivery/providers', () => {
  it('grep no módulo orders não encontra delivery/providers', () => {
    const files = walk(join(process.cwd(), 'src/modules/orders'));
    const hits = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (/delivery\/providers/.test(src) || /MockDeliveryProvider/.test(src)) {
        hits.push(f);
      }
    }
    assert.deepEqual(hits, []);
  });
});
