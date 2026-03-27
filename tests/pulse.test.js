'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getPulseSnapshot } = require('../scripts/pulse');

describe('pulse', () => {
  it('returns health BLIND/COLD when no leads and no revenue', () => {
    const snapshot = getPulseSnapshot({});
    assert.ok(snapshot.health.includes('BLIND'));
    assert.strictEqual(snapshot.leadCount, 0);
    assert.strictEqual(snapshot.bookedRevenueCents, 0);
  });

  it('returns health PIPELINE ACTIVE when leads exist but no revenue', () => {
    const snapshot = getPulseSnapshot({ signups: { uniqueLeads: 5 } });
    assert.ok(snapshot.health.includes('PIPELINE ACTIVE'));
    assert.strictEqual(snapshot.leadCount, 5);
  });

  it('returns health BOOKED REVENUE ACTIVE when revenue exists', () => {
    const snapshot = getPulseSnapshot({ revenue: { bookedRevenueCents: 4900 } });
    assert.ok(snapshot.health.includes('BOOKED REVENUE'));
    assert.strictEqual(snapshot.bookedRevenueCents, 4900);
    assert.strictEqual(snapshot.eta, 'SUCCESS');
  });

  it('computes conversionRate correctly', () => {
    const snapshot = getPulseSnapshot({
      signups: { uniqueLeads: 100 },
      revenue: { paidOrders: 5 },
    });
    assert.strictEqual(snapshot.conversionRate, '5.00');
  });
});
