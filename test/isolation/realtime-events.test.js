import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  subscribeStoreOrders,
  publishStoreOrderEvent,
} from '../../src/modules/realtime/store-events.js';

describe('store events isolation', () => {
  it('never delivers store B events to store A listeners', () => {
    const storeA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const storeB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const received = [];

    const unsubscribe = subscribeStoreOrders(storeA, (payload) => received.push(payload));

    try {
      publishStoreOrderEvent(storeB, { type: 'order.created', order: { id: 'b-order' } });
      assert.equal(received.length, 0);

      publishStoreOrderEvent(storeA, { type: 'order.created', order: { id: 'a-order' } });
      assert.equal(received.length, 1);
      assert.equal(received[0].channel, `store:${storeA}:orders`);
      assert.equal(received[0].order.id, 'a-order');
    } finally {
      unsubscribe();
    }
  });
});
