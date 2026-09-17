import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMercadoPagoWebhook,
  verifyMercadoPagoWebhook,
  isMercadoPagoConfigured,
} from '../../src/modules/payments/providers/mercadopago.js';

describe('mercadopago adapter (unit)', () => {
  it('normalizeMercadoPagoWebhook extrai ids', () => {
    const n = normalizeMercadoPagoWebhook({
      action: 'payment.updated',
      data: { id: '12345' },
      id: 99,
    });
    assert.equal(n.providerPaymentId, '12345');
    assert.ok(n.externalEventId);
    assert.equal(n.markPaid, true);
  });

  it('verify sem secret aceita (sandbox)', () => {
    const prev = process.env.MP_WEBHOOK_SECRET;
    delete process.env.MP_WEBHOOK_SECRET;
    const v = verifyMercadoPagoWebhook({}, {});
    assert.equal(v.ok, true);
    if (prev !== undefined) process.env.MP_WEBHOOK_SECRET = prev;
  });

  it('isMercadoPagoConfigured reflete env', () => {
    const prev = process.env.MP_ACCESS_TOKEN;
    delete process.env.MP_ACCESS_TOKEN;
    assert.equal(isMercadoPagoConfigured(), false);
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    assert.equal(isMercadoPagoConfigured(), true);
    if (prev === undefined) delete process.env.MP_ACCESS_TOKEN;
    else process.env.MP_ACCESS_TOKEN = prev;
  });
});
