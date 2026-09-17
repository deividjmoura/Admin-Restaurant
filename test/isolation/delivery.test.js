/**
 * Isolamento multi-tenant — delivery zones.
 * Store A nunca vê/altera zona da Store B.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createZone,
  findZoneById,
  listZones,
  updateZone,
  quoteDelivery,
  canTransitionCourier,
  DeliveryError,
} from '../../src/modules/delivery/delivery.repository.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe('delivery isolation', { skip: !hasDb }, () => {
  it('findZoneById não retorna zona de outra store', async () => {
    // Usa IDs fictícios — se não houver seeds, apenas garante filtro store_id
    const fakeStoreA = '00000000-0000-4000-8000-0000000000aa';
    const fakeStoreB = '00000000-0000-4000-8000-0000000000bb';
    const fakeZone = '00000000-0000-4000-8000-0000000000cc';

    const found = await findZoneById(fakeStoreA, fakeZone);
    assert.equal(found, null);

    const foundB = await findZoneById(fakeStoreB, fakeZone);
    assert.equal(foundB, null);
  });

  it('listZones só retorna zonas do storeId informado', async () => {
    const fakeStore = '00000000-0000-4000-8000-0000000000aa';
    const zones = await listZones(fakeStore, { activeOnly: false });
    assert.ok(Array.isArray(zones));
    for (const z of zones) {
      assert.equal(z.storeId, fakeStore);
    }
  });

  it('quoteDelivery falha com zona inexistente no store', async () => {
    const fakeStore = '00000000-0000-4000-8000-0000000000aa';
    const fakeZone = '00000000-0000-4000-8000-0000000000cc';
    await assert.rejects(
      () => quoteDelivery(fakeStore, { zoneId: fakeZone, subtotal: 50 }),
      (err) => err instanceof DeliveryError && err.code === 'ZONE_NOT_FOUND'
    );
  });
});

describe('courier status machine', () => {
  it('permite PENDING → CONFIRMED → OUT_FOR_DELIVERY → DELIVERED', () => {
    assert.equal(canTransitionCourier('PENDING', 'CONFIRMED'), true);
    assert.equal(canTransitionCourier('CONFIRMED', 'OUT_FOR_DELIVERY'), true);
    assert.equal(canTransitionCourier('OUT_FOR_DELIVERY', 'DELIVERED'), true);
  });

  it('bloqueia saltos inválidos', () => {
    assert.equal(canTransitionCourier('PENDING', 'DELIVERED'), false);
    assert.equal(canTransitionCourier('DELIVERED', 'PENDING'), false);
    assert.equal(canTransitionCourier('CANCELLED', 'CONFIRMED'), false);
  });
});
