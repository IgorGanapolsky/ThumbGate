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
    k6: { active: true, customerId: 'cus_usedup', plan: 'credit_pack', remainingCredits: 0 },
    k7: { active: true, customerId: 'cus_failing_pack', plan: 'credit_pack', remainingCredits: 0 },
  } };
  const result = paymentAccessCheck({ entitled: new Set(['cus_paid', 'cus_nokey', 'cus_failing', 'cus_usedup']), failing: [{ status: 'past_due', customer: 'cus_failing' }, { status: 'unpaid', customer: 'cus_failing_pack' }], store });
  assert.equal(result.paidWithoutAccess, 1, 'cus_nokey paid and has no key');
  assert.equal(result.accessWithoutStripePayment, 1, 'the marketplace key has no Stripe payment; the trial key is not counted');
  assert.equal(result.failedPaymentWithAccess, 1);
  assert.equal(result.activeTrialOrFreeKeys, 1);
  assert.equal(result.exhaustedCreditKeys, 2, 'a used-up credit pack was provisioned: not a missing key, and not working access');
  assert.equal(result.activeKeys, 4, 'keys billing.validateApiKey() would reject are not counted as access');
  assert.equal(result.status, 'needs_review');
  assert.doesNotMatch(JSON.stringify(result), /cus_/, 'counts only, no customer ids');
  const clean = paymentAccessCheck({ entitled: new Set(['cus_paid']), failing: [], store: { keys: { k1: store.keys.k1 } } });
  assert.equal(clean.status, 'ok');
  // Who is entitled comes from the caller: a service order or a canceled subscription is simply not in the set.
  const noKeyNeeded = paymentAccessCheck({ entitled: new Set(), failing: [], store: { keys: {} } });
  assert.equal(noKeyNeeded.paidWithoutAccess, 0);
  assert.equal(noKeyNeeded.status, 'ok');
});

test('time to first value: the hosted first_block ping counts once per install, alongside the older event name', async () => {
  const dir = tmp();
  const now = Date.UTC(2026, 10, 24, 12);
  const at = (d) => new Date(now - d * 86400000).toISOString();
  const cli = (d, eventType, installId, extra = {}) => JSON.stringify({ receivedAt: at(d), clientType: 'cli', eventType, installId, ...extra });
  fs.writeFileSync(path.join(dir, 'telemetry-pings.jsonl'), [
    cli(3, 'cli_init', 'f'), cli(2, 'first_block', 'f'),
    cli(3, 'cli_init', 'g'), cli(2, 'first_block', 'g'), cli(2, 'first_blocked_tool_call', 'g', { minutesSinceInstall: 15 }),
    cli(1, 'first_block', 'mine', { visitorType: 'owner' }),
  ].join('\n') + '\n');
  try {
    const { usage } = await readTrafficWindow({ feedbackDir: dir, days: 30, now });
    assert.equal(usage.firstValueInstalls, 2, 'an install that sent only first_block still reached first value; the owner is left out');
    assert.deepEqual(usage.timeToFirstValue, { installs: 1, medianMinutes: 15, p75Minutes: 15 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
    cli(2, 'cli_init', 'e'), cli(1, 'first_blocked_tool_call', 'e', { minutesSinceInstall: null }),
    cli(1, 'first_blocked_tool_call', 'mine', { minutesSinceInstall: 1, visitorType: 'owner' }),
  ].join('\n') + '\n');
  try {
    const { usage } = await readTrafficWindow({ feedbackDir: dir, days: 30, now });
    assert.equal(usage.firstValueInstalls, 4, 'the owner install is left out; an install with an unknown duration still counts');
    assert.deepEqual(usage.timeToFirstValue, { installs: 3, medianMinutes: 30, p75Minutes: 90 }, 'a null duration is not zero minutes');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
