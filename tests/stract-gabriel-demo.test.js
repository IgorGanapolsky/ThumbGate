'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateStractThumbGateSandwich,
} = require('../scripts/demo-stract-gabriel');

test('evaluateStractThumbGateSandwich: chains PreToolUse receipt with Stract PostToolUse verification and auto-promotes silent drift into a PreToolUse block', () => {
  const promoted = new Set();

  // Step 1: Valid action passes PreToolUse and is verified by Stract PostToolUse
  const step1 = evaluateStractThumbGateSandwich({
    step: 1,
    toolName: 'crm_book_appointment',
    payload: { endpoint: 'ghl/appointments/create', amountUsd: 150 },
    stractPostVerifyResult: { verified: true },
    promotedDriftSignatures: promoted,
  });
  assert.equal(step1.allowed, true);
  assert.equal(step1.postVerification.status, 'REAL_WORLD_SIDE_EFFECT_VERIFIED');

  // Step 2: Action passes PreToolUse, but Stract detects post-action drift -> auto-promotes to PreToolUse block
  const step2 = evaluateStractThumbGateSandwich({
    step: 2,
    toolName: 'stripe_webhook_sync',
    payload: { endpoint: 'api.stract.co/v1/billing/settle', amountUsd: 250 },
    stractPostVerifyResult: { verified: false, driftReason: 'Downstream invoice remained unpaid' },
    promotedDriftSignatures: promoted,
  });
  assert.equal(step2.allowed, true);
  assert.equal(step2.postVerification.status, 'DRIFT_DETECTED_AND_PROMOTED');

  // Step 3: Next retry of the drifted endpoint is hard-blocked in <1ms BEFORE execution
  const step3 = evaluateStractThumbGateSandwich({
    step: 3,
    toolName: 'stripe_webhook_sync',
    payload: { endpoint: 'api.stract.co/v1/billing/settle', amountUsd: 250 },
    promotedDriftSignatures: promoted,
  });
  assert.equal(step3.allowed, false);
  assert.equal(step3.gateId, 'gate:stract:post_action_drift_diode');

  // Step 4: HIPAA/PII leak blocked by House 12 agency diode
  const step4 = evaluateStractThumbGateSandwich({
    step: 4,
    toolName: 'twilio_send_sms',
    payload: { endpoint: 'twilio/messages', body: 'patient_ssn 123-45-6789' },
    promotedDriftSignatures: promoted,
  });
  assert.equal(step4.allowed, false);
  assert.equal(step4.gateId, 'gate:house12:hipaa_pii_diode');
});
