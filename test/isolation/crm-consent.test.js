import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

describe('CRM clientes e consentimento', () => {
  let storeA = null;
  let storeB = null;
  let customerA = null;
  let customerB = null;

  before(async () => {
    if (!hasDatabase()) return;
    const { create: createStore } = await import(
      '../../src/modules/tenancy/store.repository.js'
    );
    const { createCustomer } = await import(
      '../../src/modules/crm/customers.repository.js'
    );
    const suffix = Date.now().toString(36);
    storeA = await createStore({ slug: `crm-a-${suffix}`, name: 'CRM A' });
    storeB = await createStore({ slug: `crm-b-${suffix}`, name: 'CRM B' });
    customerA = await createCustomer(storeA.id, { name: 'Ana', contact: '+5511999990001' });
    customerB = await createCustomer(storeB.id, { name: 'Ana', contact: '+5511999990001' });
  });

  after(async () => {
    if (!hasDatabase() || !storeA) return;
    const { query } = await import('../../src/infrastructure/db.js');
    await query(`DELETE FROM stores WHERE id = ANY($1::uuid[])`, [[storeA.id, storeB.id]]);
  });

  it('sem consentimento de marketing → canContact false mesmo com loyalty', async (t) => {
    if (skipWithoutDb(t)) return;
    const { grantConsent, canContact } = await import('../../src/modules/crm/consent.js');
    await grantConsent(storeA.id, customerA.id, 'loyalty_program', true);
    assert.equal(await canContact(storeA.id, customerA.id, 'marketing'), false);
    assert.equal(await canContact(storeA.id, customerA.id, 'loyalty_program'), true);
  });

  it('revogar consentimento bloqueia contato posterior', async (t) => {
    if (skipWithoutDb(t)) return;
    const { grantConsent, revokeConsent, canContact } = await import(
      '../../src/modules/crm/consent.js'
    );
    await grantConsent(storeA.id, customerA.id, 'marketing', true);
    assert.equal(await canContact(storeA.id, customerA.id, 'marketing'), true);
    await revokeConsent(storeA.id, customerA.id, 'marketing');
    assert.equal(await canContact(storeA.id, customerA.id, 'marketing'), false);
  });

  it('histórico da loja A não aparece na loja B com o mesmo telefone', async (t) => {
    if (skipWithoutDb(t)) return;
    const { listCustomers, findCustomerById } = await import(
      '../../src/modules/crm/customers.repository.js'
    );
    const fromB = await listCustomers(storeB.id, { contact: '+5511999990001' });
    assert.equal(fromB.length, 1);
    assert.equal(fromB[0].id, customerB.id);
    const leak = await findCustomerById(storeB.id, customerA.id);
    assert.equal(leak, null);
  });
});
