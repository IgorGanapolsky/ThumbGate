'use strict';

// Owner console: the payment-to-access check and time to first value (the first real gate block after install).

process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { paymentAccessCheck } = require('../scripts/owner-admin');
const { readTrafficWindow } = require('../scripts/owner-telemetry');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tg-econ-'));

test('payment to access flags paid customers without a key and failed payments that still hold one', () => {
  const store = { keys: {
    k1: { active: true, customerId: 'cus_paid', plan: 'pro' },
    k2: { active: true, customerId: 'cus_failing', plan: 'pro' },
    k3: { active: true, customerId: 'cus_marketplace', plan: 'pro', source: 'github_marketplace' },
    k4: { active: true, customerId: 'cus_trial', plan: 'pro', source: 'trial' },
    k5: { active: false, customerId: 'cus_old', plan: 'pro' },
  } };
  const result = paymentAccessCheck({ paying: new Set(['cus_paid', 'cus_nokey', 'cus_failing']), failing: [{ status: 'past_due', customer: 'cus_failing' }], store });
  assert.equal(result.paidWithoutAccess, 1, 'cus_nokey paid and has no key');
  assert.equal(result.accessWithoutStripePayment, 1, 'the marketplace key has no Stripe payment; the trial key is not counted');
  assert.equal(result.failedPaymentWithAccess, 1);
  assert.equal(result.activeTrialOrFreeKeys, 1);
  assert.equal(result.status, 'needs_review');
  assert.doesNotMatch(JSON.stringify(result), /cus_/, 'counts only, no customer ids');
  const clean = paymentAccessCheck({ paying: new Set(['cus_paid']), failing: [], store: { keys: { k1: store.keys.k1 } } });
  assert.equal(clean.status, 'ok');
});

test('time to first value: the first real gate block per install, with median and 75th percentile minutes', async () => {
  const dir = tmp();
  const now = Date.UTC(2026, 10, 24, 12);
  const at = (d) => new Date(now - d * 86400000).toISOString();
  const cli = (d, eventType, installId, extra = {}) => JSON.stringify({ receivedAt: at(d), clientType: 'cli', eventType, installId, ...extra });
  fs.writeFileSync(path.join(dir, 'telemetry-pings.jsonl'), [
    cli(5, 'cli_init', 'a'), cli(5, 'first_blocked_tool_call', 'a', { minutesSinceInstall: 12 }),
    cli(4, 'cli_init', 'b'), cli(3, 'first_blocked_tool_call', 'b', { minutesSinceInstall: 90 }),
    cli(2, 'cli_init', 'c'), cli(2, 'first_blocked_tool_call', 'c', { minutesSinceInstall: 30 }),
    cli(2, 'cli_init', 'd'),
    cli(1, 'first_blocked_tool_call', 'mine', { minutesSinceInstall: 1, visitorType: 'owner' }),
  ].join('\n') + '\n');
  try {
    const { usage } = await readTrafficWindow({ feedbackDir: dir, days: 30, now });
    assert.equal(usage.firstValueInstalls, 3, 'the owner install is left out');
    assert.deepEqual(usage.timeToFirstValue, { installs: 3, medianMinutes: 30, p75Minutes: 90 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
