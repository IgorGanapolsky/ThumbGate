'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Redirect the receipt ledger into a temp dir so tests never touch ~/.thumbgate.
const TMP_STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-recovery-test-'));
process.env.THUMBGATE_HOME_DIR = TMP_STATE;

const {
  recoverCheckout,
  economicsGate,
  recoveryDraft,
  ECONOMICS,
  MAST,
  contributionPerSale,
  cacPerAttempt,
  GATE_PASSES,
  LTV_PER_CAC,
} = require('../scripts/checkout-recovery');

const SESSION = {
  id: 'cs_test_1234567890',
  amount_total: 10000,
  customer_email: 'buyer@example.com',
  customer_details: { email: 'buyer@example.com' },
};

test('Checkout Recovery: economics gate passes against public-facts model', () => {
  const gate = economicsGate(SESSION);
  assert.equal(gate.passes, true);
  assert.equal(gate.verdict, 'VERIFIED');
  // contribution = 100 - 3.20 - 0.05 = 96.75
  assert.equal(gate.contribution_per_sale, 96.75);
  // CAC = 0.05
  assert.equal(gate.cac_per_attempt, 0.05);
  // Gate is the freebutter walk-away rule: CAC < contribution.
  assert.equal(gate.passes, cacPerAttempt < contributionPerSale);
});

test('Checkout Recovery: MAST constants match the Oct-2026 taxonomy', () => {
  assert.equal(MAST.accuracy_floor_pct, 45);
  assert.equal(MAST.error_amplification_factor, 17.2);
  assert.equal(MAST.design_failure_share_pct, 76.5);
  assert.equal(MAST.inter_agent_misalignment_share_pct, 32.35);
  assert.equal(MAST.max_verifier_latency_ms, 50.0);
});

test('Checkout Recovery: gate is faster than the 50ms single-agent budget', () => {
  const gate = economicsGate(SESSION);
  assert.ok(gate.latency_ms < MAST.max_verifier_latency_ms,
    `gate latency ${gate.latency_ms}ms exceeds ${MAST.max_verifier_latency_ms}ms budget`);
});

test('Checkout Recovery: rejects a session with no positive amount (no handoff tax)', () => {
  const bad = { id: 'cs_bad', amount_total: 0, customer_email: '' };
  const gate = economicsGate(bad);
  assert.equal(gate.passes, false);
  assert.equal(gate.verdict, 'REJECTED_below_accuracy_floor_unverified_state_mutation');
});

test('Checkout Recovery: recoverCheckout emits a signed receipt (no send by default)', () => {
  const out = recoverCheckout(SESSION);
  assert.equal(out.ok, true);
  assert.equal(out.verdict, 'VERIFIED');
  assert.equal(out.dry_run, true); // dry-run: approval sends nothing
  assert.ok(out.draft);
  assert.equal(out.draft.channel, 'email');
  assert.equal(out.draft.to, 'buyer@example.com');

  // The signed receipt must exist in the temp ledger.
  const ledger = path.join(TMP_STATE, 'checkout-recovery-ledger.jsonl');
  assert.ok(fs.existsSync(ledger), 'receipt ledger should exist');
  const lines = fs.readFileSync(ledger, 'utf8').trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.signed.signer, 'thumbgate/checkout-recovery');
  assert.ok(last.signature, 'receipt must carry an HMAC signature');
  assert.equal(last.channel, 'checkout');
  assert.equal(last.status, 'RECOVERY_QUEUED');
  assert.equal(last.source_session, 'cs_test_1234567890');
  assert.equal(last.separate_context, true);

  // Verify the HMAC is tamper-evident: flip a byte and it breaks.
  const tampered = { ...last, gate: { ...last.gate, passes: false } };
  const sig = require('node:crypto')
    .createHmac('sha256', 'thumbgate-checkout-recovery')
    .update(JSON.stringify({ ...tampered, signed: tampered.signed }))
    .digest('hex');
  assert.notEqual(sig, last.signature);
});

test('Checkout Recovery: recovery draft carries the freebutter "offer specific to firm" line', () => {
  const draft = recoveryDraft(SESSION);
  assert.equal(draft.offer_specific_to_firm, true);
  assert.equal(draft.channel, 'email');
  assert.match(draft.subject, /ThumbGate checkout/i);
  assert.ok(draft.body.includes('<0.5ms PreToolUse firewall'));
});

test('Checkout Recovery: LTV per CAC clears the freebutter 3x bar', () => {
  // freebutter: only scale a channel once LTV:CAC >= 3x.
  assert.ok(LTV_PER_CAC > 3, `LTV/CAC ${LTV_PER_CAC}x must clear the 3x bar`);
  assert.equal(LTV_PER_CAC, contributionPerSale / cacPerAttempt);
});

test('Checkout Recovery: recoveryConvRate + abandonRate match public benchmarks', () => {
  assert.equal(ECONOMICS.abandon_rate, 0.69);      // Baymard
  assert.equal(ECONOMICS.recovery_conv_rate, 0.18); // top-quartile
  assert.equal(ECONOMICS.tier_price_cents, 10000);  // $100 tier
  assert.equal(ECONOMICS.stripe_fee_cents, 320);   // 2.9% + $0.30
});
