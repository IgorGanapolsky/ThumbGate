'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ledger-empty-'));
process.env._TEST_API_KEYS_PATH = path.join(dir, 'api-keys.json');
process.env._TEST_REVENUE_LEDGER_PATH = path.join(dir, 'revenue-events.jsonl');
process.env._TEST_FUNNEL_LEDGER_PATH = path.join(dir, 'funnel-events.jsonl');
process.env._TEST_LEGACY_FEEDBACK_DIR = path.join(dir, 'legacy');

const billing = require('../scripts/billing');

function codes() {
  return billing.buildBillingSourceDiagnostics(dir).warnings.map((w) => w.code);
}

test('a missing revenue ledger with no paid keys reads as "nothing sold yet", not a broken source', () => {
  const found = codes();
  assert.ok(found.includes('revenue_ledger_empty'), found.join(','));
  assert.ok(!found.includes('revenue_ledger_missing'));
});

test('a paid funnel event without a key (service order) keeps the ledger flagged as missing', () => {
  fs.writeFileSync(process.env._TEST_FUNNEL_LEDGER_PATH, `${JSON.stringify({ stage: 'paid', event: 'checkout_paid_confirmed', evidence: 'cs_test' })}\n`);
  try {
    const found = codes();
    assert.ok(found.includes('revenue_ledger_missing'), found.join(','));
    assert.ok(!found.includes('revenue_ledger_empty'));
  } finally {
    fs.rmSync(process.env._TEST_FUNNEL_LEDGER_PATH, { force: true });
  }
});

test('an unreadable key store never reads as "nothing sold yet"', () => {
  try {
    for (const body of ['{not json', '{"keys":null}', '{"keys":[]}', 'null']) {
      fs.writeFileSync(process.env._TEST_API_KEYS_PATH, body);
      const found = codes();
      assert.ok(found.includes('revenue_ledger_missing'), `${body}: ${found.join(',')}`);
      assert.ok(!found.includes('revenue_ledger_empty'), body);
    }
  } finally {
    fs.rmSync(process.env._TEST_API_KEYS_PATH, { force: true });
  }
});

test('a missing revenue ledger with a Stripe-paid key is still flagged as missing', () => {
  fs.writeFileSync(process.env._TEST_API_KEYS_PATH, JSON.stringify({
    keys: { tg_test: { customerId: 'cus_123', source: 'stripe_webhook_checkout_completed', active: true } },
  }));
  const found = codes();
  assert.ok(found.includes('revenue_ledger_missing'), found.join(','));
  assert.ok(!found.includes('revenue_ledger_empty'));
});

test('keyStoreHasPaidKeys ignores trial and owner keys', () => {
  assert.equal(billing.keyStoreHasPaidKeys({ keys: { a: { customerId: 'local_trial', source: 'provision' } } }), false);
  assert.equal(billing.keyStoreHasPaidKeys({ keys: { a: { source: 'github_marketplace_purchased' } } }), true);
  assert.equal(billing.keyStoreHasPaidKeys({}), false);
});
