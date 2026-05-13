'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TIERS,
  encodeForStripe,
  upsertTier,
} = require('../scripts/stripe-bootstrap-saas-catalog.js');

test('TIERS contains all 8 expected SaaS + one-off tiers in order', () => {
  const want = ['pro', 'team', 'free', 'first_failure_rule', 'quick_read', 'workflow_teardown', 'sprint_diagnostic', 'workflow_sprint'];
  assert.deepEqual(TIERS.map((t) => t.tier), want);
});

test('every tier has name, description, imageUrl, marketingFeatures, and prices array', () => {
  for (const t of TIERS) {
    assert.ok(t.name && typeof t.name === 'string', `${t.tier} missing name`);
    assert.ok(t.description && typeof t.description === 'string', `${t.tier} missing description`);
    assert.match(t.imageUrl, /^https:\/\/thumbgate-production\.up\.railway\.app\/assets\/brand\//, `${t.tier} image must point to prod brand assets`);
    assert.ok(Array.isArray(t.marketingFeatures), `${t.tier} marketingFeatures must be array`);
    assert.ok(Array.isArray(t.prices), `${t.tier} prices must be array`);
  }
});

test('Pro has both monthly and annual recurring prices', () => {
  const pro = TIERS.find((t) => t.tier === 'pro');
  const monthly = pro.prices.find((p) => p.lookupKey === 'thumbgate_pro_monthly');
  const annual = pro.prices.find((p) => p.lookupKey === 'thumbgate_pro_annual');
  assert.equal(monthly.unitAmount, 1900, 'Pro monthly is $19/mo (1900 cents)');
  assert.equal(monthly.interval, 'month');
  assert.equal(annual.unitAmount, 14900, 'Pro annual is $149/yr (14900 cents)');
  assert.equal(annual.interval, 'year');
});

test('Team is $49/seat/mo recurring', () => {
  const team = TIERS.find((t) => t.tier === 'team');
  assert.equal(team.prices.length, 1);
  assert.equal(team.prices[0].lookupKey, 'thumbgate_team_per_seat_monthly');
  assert.equal(team.prices[0].unitAmount, 4900);
  assert.equal(team.prices[0].interval, 'month');
});

test('Free has no prices (placeholder in catalog only)', () => {
  const free = TIERS.find((t) => t.tier === 'free');
  assert.deepEqual(free.prices, []);
});

test('each one-off tier has exactly one one-time price (interval=null)', () => {
  const oneOffs = ['first_failure_rule', 'quick_read', 'workflow_teardown', 'sprint_diagnostic', 'workflow_sprint'];
  const expected = {
    first_failure_rule: 100,
    quick_read: 1900,
    workflow_teardown: 9900,
    sprint_diagnostic: 49900,
    workflow_sprint: 150000,
  };
  for (const tier of oneOffs) {
    const t = TIERS.find((x) => x.tier === tier);
    assert.equal(t.prices.length, 1, `${tier} should have 1 price`);
    assert.equal(t.prices[0].interval, null, `${tier} should be one-time`);
    assert.equal(t.prices[0].unitAmount, expected[tier], `${tier} price drift check`);
  }
});

test('lookup_keys are unique across all tiers', () => {
  const keys = TIERS.flatMap((t) => t.prices.map((p) => p.lookupKey));
  const set = new Set(keys);
  assert.equal(keys.length, set.size, 'duplicate lookup_key would break Stripe idempotency');
});

test('encodeForStripe flattens scalars', () => {
  assert.equal(
    encodeForStripe({ unit_amount: 1900, currency: 'usd' }),
    'unit_amount=1900&currency=usd'
  );
});

test('encodeForStripe nests objects with bracket syntax (Stripe wire format)', () => {
  assert.equal(
    encodeForStripe({ recurring: { interval: 'month' } }),
    'recurring%5Binterval%5D=month'
  );
});

test('encodeForStripe handles arrays of scalars', () => {
  assert.equal(
    encodeForStripe({ images: ['https://example.com/a.png', 'https://example.com/b.png'] }),
    'images%5B0%5D=https%3A%2F%2Fexample.com%2Fa.png&images%5B1%5D=https%3A%2F%2Fexample.com%2Fb.png'
  );
});

test('encodeForStripe handles arrays of objects (line_items, marketing_features)', () => {
  const encoded = encodeForStripe({ line_items: [{ price: 'price_X', quantity: 1 }] });
  assert.match(encoded, /line_items%5B0%5D%5Bprice%5D=price_X/);
  assert.match(encoded, /line_items%5B0%5D%5Bquantity%5D=1/);
});

test('encodeForStripe skips null and undefined values (no empty=&)', () => {
  const encoded = encodeForStripe({ a: 1, b: null, c: undefined, d: 'ok' });
  assert.equal(encoded, 'a=1&d=ok');
});

test('encodeForStripe URL-encodes special characters', () => {
  const encoded = encodeForStripe({ name: 'ThumbGate Pro — Monthly' });
  assert.match(encoded, /name=ThumbGate%20Pro%20%E2%80%94%20Monthly/);
});

test('upsertTier is exported for downstream orchestration', () => {
  assert.equal(typeof upsertTier, 'function');
});
