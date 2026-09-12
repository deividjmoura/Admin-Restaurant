import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePixKey,
  buildStaticPixPayload,
  resolvePixConfig,
} from '../../src/modules/payments/pix-static.js';

describe('PIX static EMV', () => {
  it('normalizes CPF mask', () => {
    assert.equal(normalizePixKey('123.456.789-01'), '12345678901');
  });

  it('keeps email lowercase', () => {
    assert.equal(normalizePixKey('User@Mail.COM'), 'user@mail.com');
  });

  it('builds payload with CRC and amount', () => {
    const emv = buildStaticPixPayload({
      key: '12345678901',
      name: 'Demo',
      city: 'São Paulo',
      amount: 25.5,
      txid: 'TEST1',
    });
    assert.ok(emv.startsWith('000201'));
    assert.ok(emv.includes('540525.50')); // amount field
    assert.equal(emv.slice(-4).length, 4);
    assert.match(emv.slice(-4), /^[0-9A-F]{4}$/);
  });

  it('resolvePixConfig reads env fallback', () => {
    const cfg = resolvePixConfig({}, {
      PIX_CHAVE: 'teste@pix.com',
      PIX_NOME: 'LOJA',
      PIX_CIDADE: 'CURITIBA',
    });
    assert.equal(cfg.configured, true);
    assert.equal(cfg.key, 'teste@pix.com');
    assert.equal(cfg.city, 'CURITIBA');
  });
});
