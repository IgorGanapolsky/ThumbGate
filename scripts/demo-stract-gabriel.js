#!/usr/bin/env node
'use strict';

/**
 * scripts/demo-stract-gabriel.js
 *
 * Live 5-Minute Screen-Share Demo for Gabriel Olufade / Gabriel Harrolds
 * (Founder @ Stract & House 12 Consulting)
 * Meeting: Friday, October 16, 2026 @ 9:30 AM ET (https://meet.google.com/nih-ajsv-jxk)
 *
 * Demonstrates the "Closed-Loop Agent Execution Sandwich" (ThumbGate PreToolUse + Stract PostToolUse):
 *   1. Pre-Action Gate (<0.1ms local CPU): ThumbGate validates tool arguments, spend caps,
 *      and HIPAA/PII boundaries before execution.
 *   2. Post-Action Verification (Stract): Verifies real-world side effects (CRM/webhook/payment state)
 *      and auto-compiles any post-action drift into an active ThumbGate PreToolUse block rule.
 *   3. House 12 Consulting Agency Pack: Shows how House 12 can bundle ThumbGate's Operator Framework
 *      into high-ticket client automations ($2,500 Turnkey / $500/mo Retainer · 30% Partner Share).
 */

const crypto = require('node:crypto');

function evaluateStractThumbGateSandwich({
  step = 1,
  toolName = '',
  payload = {},
  stractPostVerifyResult = { verified: true, driftReason: null },
  promotedDriftSignatures = new Set(),
} = {}) {
  const startNs = process.hrtime.bigint();
  const payloadStr = JSON.stringify(payload);
  const signature = `${toolName}::${payload.endpoint || payload.action || ''}`;

  let preDecision = 'ALLOW';
  let gateId = 'gate:thumbgate:pre_action_verified';
  let reason = 'PreToolUse verified tool contract, spend cap, and PII diode';

  // 1. Check if Stract previously flagged post-action drift on this endpoint/action
  if (promotedDriftSignatures instanceof Set && promotedDriftSignatures.has(signature)) {
    preDecision = 'BLOCK';
    gateId = 'gate:stract:post_action_drift_diode';
    reason = `Blocked before execution: Stract previously detected real-world state drift on '${signature}'`;
  }

  // 2. Check House 12 Consulting HIPAA / PII / Double-Charge Agency Guardrails
  if (preDecision === 'ALLOW') {
    if (/(?:\b\d{3}-\d{2}-\d{4}\b|patient_ssn|unredacted_medical_record)/i.test(payloadStr)) {
      preDecision = 'BLOCK';
      gateId = 'gate:house12:hipaa_pii_diode';
      reason = 'Unredacted client/patient PII blocked before external webhook/SMS egress';
    } else if (Number(payload.amountUsd || 0) > 500 && !payload.humanApproved) {
      preDecision = 'BLOCK';
      gateId = 'gate:house12:autonomous_spend_cap';
      reason = `Autonomous client charge ($${payload.amountUsd}) exceeds $500 pre-action safety cap`;
    }
  }

  const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(3));
  const preReceiptHash = `tg_pre_${crypto.createHash('sha256').update(`${step}:${toolName}:${payloadStr}`).digest('hex').slice(0, 16)}`;

  let postVerification = null;
  if (preDecision === 'ALLOW') {
    if (stractPostVerifyResult && !stractPostVerifyResult.verified) {
      if (promotedDriftSignatures instanceof Set) {
        promotedDriftSignatures.add(signature);
      }
      postVerification = {
        status: 'DRIFT_DETECTED_AND_PROMOTED',
        driftReason: stractPostVerifyResult.driftReason || 'Real-world state did not match intended tool outcome',
        promotedRule: `gate:stract:post_action_drift_diode -> ${signature}`,
      };
    } else {
      const postHash = `stract_post_${crypto.createHash('sha256').update(`${preReceiptHash}:verified`).digest('hex').slice(0, 16)}`;
      postVerification = {
        status: 'REAL_WORLD_SIDE_EFFECT_VERIFIED',
        chainedReceipt: `${preReceiptHash} -> ${postHash}`,
      };
    }
  }

  return {
    step,
    toolName,
    preDecision,
    allowed: preDecision === 'ALLOW',
    gateId,
    latencyMs,
    preReceiptHash,
    postVerification,
    reason,
  };
}

function runLiveDemo() {
  const promotedDrift = new Set();
  console.log('================================================================================');
  console.log('  THUMBGATE (PreToolUse) x STRACT & HOUSE 12 (PostToolUse) — LIVE DEMO');
  console.log('  Counterpart: Gabriel Olufade (Founder, Stract & House 12 Consulting)');
  console.log('  Target Pre-Action Latency: <0.500ms | Architecture: Closed-Loop Agent Sandwich');
  console.log('================================================================================\n');

  const steps = [
    {
      step: 1,
      toolName: 'crm_book_appointment',
      payload: { endpoint: 'ghl/appointments/create', client: 'Medspa Miami', amountUsd: 150 },
      stractPostVerifyResult: { verified: true },
    },
    {
      step: 2,
      toolName: 'stripe_webhook_sync',
      payload: { endpoint: 'api.stract.co/v1/billing/settle', amountUsd: 250 },
      stractPostVerifyResult: {
        verified: false,
        driftReason: 'Webhook returned 200 OK but downstream CRM invoice remained UNPAID (silent state drift)',
      },
    },
    {
      step: 3,
      toolName: 'stripe_webhook_sync',
      payload: { endpoint: 'api.stract.co/v1/billing/settle', amountUsd: 250 },
      stractPostVerifyResult: { verified: true },
    },
    {
      step: 4,
      toolName: 'twilio_send_sms',
      payload: { endpoint: 'twilio/messages', body: 'Patient intake patient_ssn 123-45-6789' },
      stractPostVerifyResult: { verified: true },
    },
  ];

  for (const s of steps) {
    const res = evaluateStractThumbGateSandwich({
      ...s,
      promotedDriftSignatures: promotedDrift,
    });
    console.log(`[Step ${res.step}] [${res.preDecision}] (${res.latencyMs}ms) | Tool: ${res.toolName}`);
    console.log(`   PreToolUse Gate : ${res.gateId} — ${res.reason}`);
    if (res.postVerification) {
      console.log(`   Stract PostCheck: ${res.postVerification.status}`);
      if (res.postVerification.chainedReceipt) {
        console.log(`   Chained Proof   : ${res.postVerification.chainedReceipt}`);
      }
      if (res.postVerification.promotedRule) {
        console.log(`   Auto-Promoted   : ${res.postVerification.promotedRule}`);
      }
    }
    console.log('');
  }

  console.log('--------------------------------------------------------------------------------');
  console.log('  [READY] 7-DAY FREE OPERATOR FRAMEWORK & CO-SELL PILOT FOR STRACT / HOUSE 12:');
  console.log('  Trial ID   : tg_trial_stract_house12_20261016');
  console.log('  Blueprint  : https://thumbgate.ai/operator-framework');
  console.log('  Commercials: $2,500 Turnkey Agency Setup / $500/mo Retainer (30% Partner Share)');
  console.log('================================================================================');
}

if (require.main === module) {
  runLiveDemo();
}

module.exports = {
  evaluateStractThumbGateSandwich,
  runLiveDemo,
};
