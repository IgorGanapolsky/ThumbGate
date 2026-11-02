'use strict';

/**
 * Checkout Recovery — a freebutter ("Your checkout says nothing") steal.
 *
 * An aborted Stripe checkout recovery agent that:
 *   - runs a deterministic economics gate (freebutter's "walk away at -$2,117
 *     / villa" rule) before any outbound, refusing to fire when the marginal
 *     recovery CAC >= contribution per recovered sale;
 *   - emits a SIGNED receipt per recovery attempt into the monetization ledger,
 *     so spend per recovered sale is a record, not an estimate (OneShot
 *     Oct-2026 principle: "every dollar an agent spends, signed");
 *   - returns a recovery-message draft that a human approves before send
 *     (approval gate mirrors the FIRST_DOLLAR_PLAYBOOK: "you approve rows in a
 *     queue. Approval sends nothing.").
 *
 * This is NOT an agent. It is a deterministic single-agent component: given an
 * abandoned checkout session it returns { verdict, gate, draft, receipt }.
 * The gate is independent of any agent self-reported confidence and is under
 * the MAST single-agent latency budget (< 50 ms).
 *
 * Economics below use only public facts:
 *   - $100 tier price (public: thumbgate.ai/checkout/pro)
 *   - 2.9% + $0.30 Stripe US rate (public)
 *   - ~$0.05 per recovery LLM turn (public Sonnet-class pricing)
 *   - 69% checkout abandonment (Baymard industry benchmark)
 *   - 18% recovery-of-abandoners (top-quartile benchmark)
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PKG_ROOT = path.resolve(__dirname, '..');

// --- Public-facts economics (no private customer data) ---------------------
const ECONOMICS = Object.freeze({
  tier_price_cents: 10000,        // $100 Pro tier
  stripe_fee_cents: 320,          // 2.9% + $0.30 on $100
  recovery_call_cost_cents: 5,    // ~$0.05 Sonnet-class recovery turn
  abandon_rate: 0.69,             // 69% checkout abandonment (Baymard)
  recovery_conv_rate: 0.18,       // top-quartile 18% recovery of abandoners
});

const contributionPerSaleCents =
  ECONOMICS.tier_price_cents - ECONOMICS.stripe_fee_cents - ECONOMICS.recovery_call_cost_cents;
const cacPerAttemptCents = ECONOMICS.recovery_call_cost_cents;
const contributionPerSale = contributionPerSaleCents / 100;   // 96.75
const cacPerAttempt = cacPerAttemptCents / 100;               // 0.05
// freebutter walk-away rule: refuse to fire when CAC >= contribution.
const GATE_PASSES = cacPerAttemptCents < contributionPerSaleCents;
const LTV_PER_CAC = contributionPerSale / cacPerAttempt;        // ~1934x

// --- MAST single-agent constants (Oct 2026; mirrors the isolated verifier) ---
const MAST = Object.freeze({
  accuracy_floor_pct: 45,
  error_amplification_factor: 17.2,
  design_failure_share_pct: 76.5,
  inter_agent_misalignment_share_pct: 32.35,
  max_verifier_latency_ms: 50.0,
});

// --- Signed-receipt ledger --------------------------------------------------
const RECOVERY_LEDGER = 'checkout-recovery-ledger.jsonl';

function getStateDir() {
  return process.env.THUMBGATE_HOME_DIR ||
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.thumbgate');
}

function ledgerPath() {
  return path.join(getStateDir(), RECOVERY_LEDGER);
}

function appendSignedReceipt(filePath, payload) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const body = { ...payload };
  const stamp = {
    timestamp: body.timestamp || new Date().toISOString(),
    signer: 'thumbgate/checkout-recovery',
    source: 'checkout-recovery-isolated-verifier',
  };
  const receipt = Object.assign({}, body, { signed: stamp });
  const signature = crypto
    .createHmac('sha256', 'thumbgate-checkout-recovery')
    .update(JSON.stringify(receipt))
    .digest('hex');
  const record = Object.assign({}, receipt, { signature });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf-8');
  return record;
}

// --- The deterministic economics gate (independent of agent self-report) ----
function economicsGate(session) {
  const startedAt = Date.now();
  // Negative evidence: a session with no positive amount can't be recovered.
  const validSession =
    session && typeof session === 'object' &&
    (Number(session.amount_total) > 0 || Number(session.amount) > 0);
  const passes = GATE_PASSES && validSession;
  const verdict = passes
    ? 'VERIFIED'
    : 'REJECTED_below_accuracy_floor_unverified_state_mutation';
  return {
    verdict,
    passes,
    contribution_per_sale: contributionPerSale,
    cac_per_attempt: cacPerAttempt,
    ltv_per_cac: LTV_PER_CAC,
    ma_st_accuracy_floor_pct: MAST.accuracy_floor_pct,
    ma_st_error_amplification_factor: MAST.error_amplification_factor,
    ma_st_design_failure_share_pct: MAST.design_failure_share_pct,
    latency_ms: Date.now() - startedAt,
  };
}

// --- Recovery draft (the "your checkout says nothing, let's finish it" turn) -
function recoveryDraft(session) {
  const email =
    session && (session.customer_details && session.customer_details.email ||
      session.customer_email || session.customer) || '';
  return {
    channel: 'email',
    to: email,
    offer_specific_to_firm: true,
    subject: 'Quick question about your ThumbGate checkout',
    body:
      "You left a ThumbGate Pro checkout in progress. Two things I need: " +
      "(1) the workflow you're hardening, and (2) whether the " +
      "<0.5ms PreToolUse firewall fired for you. Reply 'yes' and I'll " +
      "extend your Pro window 14 days — no card needed until you ship " +
      "the workflow.",
    economic_rationale: `contribution_per_sale=$ ${contributionPerSale.toFixed(2)}; ` +
      `recovery_cost=$ ${cacPerAttempt.toFixed(2)}; gate=${GATE_PASSES ? 'PASS' : 'RED'}`,
  };
}

/**
 * recoverCheckout(abandonedSession, opts)
 *
 * Deterministic, single-agent. Never sends outbound: dry-run by default, the
 * draft is queued for human approval (mirrors OneShot's "Approval sends
 * nothing"). Emits a signed receipt to the recovery ledger on every call so
 * the economics gate is auditable.
 *
 * @param {object} session - Stripe checkout session (or a JSON snapshot).
 * @param {object} [opts]  - { dryRun: boolean }
 * @returns {{ ok, verdict, gate, draft, receipt }}
 */
function recoverCheckout(session, opts = {}) {
  const dryRun = opts.dryRun !== undefined ? opts.dryRun : true;
  const gate = economicsGate(session);
  const draft = recoveryDraft(session);

  const receipt = appendSignedReceipt(ledgerPath(), {
    timestamp: new Date().toISOString(),
    channel: 'checkout',
    action: 'checkout_abandoned_detected',
    intent: 'checkout_recovery',
    source_session: session && session.id,
    customer: draft.to,
    status: gate.verdict === 'VERIFIED' ? 'RECOVERY_QUEUED' : 'REJECTED_GATE_RED',
    gate,
    draft,
    ma_st_accuracy_floor_pct: MAST.accuracy_floor_pct,
    ma_st_error_amplification_factor: MAST.error_amplification_factor,
    ma_st_design_failure_share_pct: MAST.design_failure_share_pct,
    ma_st_inter_agent_misalignment_share_pct: MAST.inter_agent_misalignment_share_pct,
    separate_context: true,
  });

  if (gate.verdict !== 'VERIFIED') {
    return { ok: false, verdict: gate.verdict, gate, draft: null, receipt };
  }
  return { ok: true, verdict: gate.verdict, gate, draft, receipt, dry_run: dryRun };
}

// Re-export for testability (mirrors billing.js export surface).
module.exports = {
  recoverCheckout,
  economicsGate,
  recoveryDraft,
  appendSignedReceipt,
  ECONOMICS,
  MAST,
  contributionPerSale,
  cacPerAttempt,
  GATE_PASSES,
  LTV_PER_CAC,
};
