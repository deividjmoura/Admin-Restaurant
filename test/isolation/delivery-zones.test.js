/**
 * Isolamento delivery — Store A nunca vê/altera zona da Store B.
 * S1 estabilização (agente-ci).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

describe('delivery zones isolation (integration)', () => {
  let storeA = null;
  let storeB = null;
  let zoneA = null;

  before(async () => {
    if (!hasDatabase()) return;

    const { create: createStore } = await import(
      '../../src/modules/tenancy/store.repository.js'
    );
    const { createZone } = await import(
      '../../src/modules/delivery/delivery.repository.js'
    );

    const suffix = Date.now().toString(36);
    storeA = await createStore({ slug: `dz-a-${suffix}`, name: 'Delivery A' });
    storeB = await createStore({ slug: `dz-b-${suffix}`, name: 'Delivery B' });

    zoneA = await createZone(storeA.id, {
      name: 'Centro A',
      fee: 5,
      minOrderAmount: 20,
      etaMinutesMin: 30,
      etaMinutesMax: 50,
    });
  });

  after(async () => {
    if (!hasDatabase() || !storeA) return;
    const { query } = await import('../../src/infrastructure/db.js');
    await query(`DELETE FROM stores WHERE id = ANY($1::uuid[])`, [
      [storeA.id, storeB.id],
    ]);
  });

  it('listZones(storeB) não inclui zona de storeA', async (t) => {
    if (skipWithoutDb(t)) return;
    const { listZones } = await import(
      '../../src/modules/delivery/delivery.repository.js'
    );
    const zonesB = await listZones(storeB.id, { activeOnly: false });
    assert.ok(Array.isArray(zonesB));
    assert.equal(
      zonesB.some((z) => z.id === zoneA.id),
      false,
      'zona de A não deve aparecer em B'
    );
  });

  it('findZoneById(storeB, zoneA.id) retorna null', async (t) => {
    if (skipWithoutDb(t)) return;
    const { findZoneById } = await import(
      '../../src/modules/delivery/delivery.repository.js'
    );
    const found = await findZoneById(storeB.id, zoneA.id);
    assert.equal(found, null);
  });

  it('updateZone(storeB, zoneA.id) retorna null (não altera)', async (t) => {
    if (skipWithoutDb(t)) return;
    const { updateZone, findZoneById } = await import(
      '../../src/modules/delivery/delivery.repository.js'
    );
    const updated = await updateZone(storeB.id, zoneA.id, { name: 'Hacked' });
    assert.equal(updated, null);
    const still = await findZoneById(storeA.id, zoneA.id);
    assert.equal(still.name, 'Centro A');
  });

  it('quoteDelivery(storeB, zoneA) falha ZONE_NOT_FOUND', async (t) => {
    if (skipWithoutDb(t)) return;
    const { quoteDelivery, DeliveryError } = await import(
      '../../src/modules/delivery/delivery.repository.js'
    );
    await assert.rejects(
      () => quoteDelivery(storeB.id, { zoneId: zoneA.id, subtotal: 50 }),
      (err) => err instanceof DeliveryError && err.code === 'ZONE_NOT_FOUND'
    );
  });

  it('listZones(storeA) retorna zona criada', async (t) => {
    if (skipWithoutDb(t)) return;
    const { listZones } = await import(
      '../../src/modules/delivery/delivery.repository.js'
    );
    const zones = await listZones(storeA.id, { activeOnly: true });
    assert.ok(zones.some((z) => z.id === zoneA.id));
    for (const z of zones) {
      assert.equal(z.storeId, storeA.id);
    }
  });
});
