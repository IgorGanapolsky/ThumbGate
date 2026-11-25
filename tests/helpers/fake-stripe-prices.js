'use strict';

// Fake `stripe.prices` for tests that open a checkout session through a mocked
// Stripe client. createCheckoutSession now verifies the configured price is
// active and matches the page before it opens a session, so every fake client
// that reaches it needs a prices.retrieve that returns the matching price.
const offer = require('../../scripts/commercial-offer');

function activePrices() {
  // Resolve CONFIG lazily so this works before the test has loaded billing.
  const table = () => { const config = require('../../scripts/billing').CONFIG; return new Map([
    [config.STRIPE_PRICE_ID_PRO_MONTHLY || config.STRIPE_PRICE_ID, [offer.PRO_MONTHLY_PRICE_DOLLARS, 'month']],
    [config.STRIPE_PRICE_ID_PRO_ANNUAL, [offer.PRO_ANNUAL_PRICE_DOLLARS, 'year']],
    [config.STRIPE_PRICE_ID_TEAM_MONTHLY, [offer.TEAM_MONTHLY_PRICE_DOLLARS, 'month']],
  ]); };
  return {
    retrieve: async (id) => {
      const row = table().get(id);
      if (!row) throw new Error(`fake stripe: no price ${id}`);
      return { id, active: true, currency: 'usd', unit_amount: row[0] * 100, recurring: { interval: row[1], interval_count: 1 } };
    },
  };
}

module.exports = { activePrices };
