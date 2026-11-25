'use strict';

// AGENT-3667 item H: configured Stripe price ids are verified, an archived id is reported and kept out of
// session metadata, and a session never references a stored price (it sends inline price_data).
const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../scripts/checkout-price-guard');
const billing = require('../scripts/billing');

const ACTIVE = 'price_active_monthly';
const ARCHIVED = 'price_archived_old';

function fakeStripe(table) {
  return {
    prices: {
      async retrieve(id) {
        if (!(id in table)) { const e = new Error('No such price'); e.code = 'resource_missing'; throw e; }
        return table[id];
      },
    },
  };
}
const price = (active, amount, interval) => ({ active, unit_amount: amount, currency: 'usd', recurring: { interval }, product: 'prod_x' });

test.afterEach(() => guard.resetCheckoutPriceStatus());

test('an archived configured price is reported as not ok, with the reason', async () => {
  const result = await guard.verifyCheckoutPrices({
    stripe: fakeStripe({ [ACTIVE]: price(true, 1900, 'month'), [ARCHIVED]: price(false, 1900, 'month') }),
    configured: [{ name: 'pro_monthly', id: ACTIVE }, { name: 'pro_annual', id: ARCHIVED }],
  });
  assert.equal(result.ok, false);
  const byName = Object.fromEntries(result.prices.map((p) => [p.name, p]));
  assert.equal(byName.pro_monthly.ok, true);
  assert.equal(byName.pro_annual.ok, false);
  assert.equal(byName.pro_annual.reason, 'archived');
});

test('a missing price id and an unset id are reported, not thrown', async () => {
  const result = await guard.verifyCheckoutPrices({
    stripe: fakeStripe({}),
    configured: [{ name: 'a', id: 'price_gone' }, { name: 'b', id: undefined }],
  });
  assert.deepEqual(result.prices.map((p) => p.reason), ['not_found', 'unset']);
});

test('an id the last check found archived is kept out of metadata; an active or unchecked id passes', async () => {
  assert.equal(guard.activePriceIdOrNull(ARCHIVED), ARCHIVED, 'unchecked ids pass so a Stripe outage never blocks a buyer');
  await guard.verifyCheckoutPrices({
    stripe: fakeStripe({ [ACTIVE]: price(true, 1900, 'month'), [ARCHIVED]: price(false, 1900, 'month') }),
    configured: [{ name: 'x', id: ACTIVE }, { name: 'y', id: ARCHIVED }],
  });
  assert.equal(guard.activePriceIdOrNull(ACTIVE), ACTIVE);
  assert.equal(guard.activePriceIdOrNull(ARCHIVED), null);
});

test('the real session payload sends inline price_data and drops a known-archived id from metadata', async () => {
  const configuredId = billing.configuredCheckoutPrices()[0].id;
  const build = () => billing._buildCheckoutSessionPayload({
    successUrl: 'https://thumbgate.ai/success', cancelUrl: 'https://thumbgate.ai/cancel',
    checkoutMetadata: { planId: 'pro', billingCycle: 'monthly' }, appOrigin: 'https://thumbgate.ai',
  });
  let payload = build();
  assert.ok(payload.line_items[0].price_data, 'subscription checkout uses inline price_data');
  assert.equal('price' in payload.line_items[0], false, 'no stored price id is sent as the line item');
  assert.equal(payload.metadata.priceId, configuredId);
  await guard.verifyCheckoutPrices({ stripe: fakeStripe({ [configuredId]: price(false, 1900, 'month') }), configured: [{ name: 'pro_monthly', id: configuredId }] });
  payload = build();
  assert.ok(!payload.metadata.priceId, 'an archived configured id must not be written into the session');
});
