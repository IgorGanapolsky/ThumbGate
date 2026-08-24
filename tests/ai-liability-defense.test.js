'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  loadLiabilityConfig,
  evaluateActionLiability,
  generateLiabilityReceipt,
  verifyLiabilityReceipt
} = require('../scripts/ai-liability-defense-engine.js');

test('AI Liability Defense Engine - Config Loader', () => {
  const config = loadLiabilityConfig();
  assert.ok(config);
  assert.equal(config.gateId, 'gate_ai_liability_defense_2026');
  assert.ok(Array.isArray(config.rules));
  assert.ok(config.governance.jurisdictions.includes('EU_AI_ACT'));
});

test('AI Liability Defense Engine - Evaluates Destructive Operations as CRITICAL Dual-Key', () => {
  const evalResult = evaluateActionLiability({ command: 'rm -rf /tmp/data' });
  assert.equal(evalResult.allowed, false);
  assert.equal(evalResult.verdict, 'DENY_DUAL_KEY_REQUIRED');
  assert.equal(evalResult.severity, 'CRITICAL');
  assert.equal(evalResult.dualKeyRequired, true);
  assert.ok(evalResult.matchedRules.includes('LIABILITY_01_DESTRUCTIVE_OPS'));
  assert.ok(evalResult.complianceObligations.euAiAct.article14_humanOversight);
});

test('AI Liability Defense Engine - Allows Destructive Operations when Operator Approved', () => {
  const evalResult = evaluateActionLiability(
    { command: 'rm -rf /tmp/data' },
    { operatorApproved: true }
  );
  assert.equal(evalResult.allowed, true);
  assert.equal(evalResult.severity, 'CRITICAL');
  assert.equal(evalResult.operatorApproved, true);
});

test('AI Liability Defense Engine - nonempty operatorSignature is not approval', () => {
  const evalResult = evaluateActionLiability({
    command: 'rm -rf /srv/data',
    operatorSignature: 'x',
  });
  assert.equal(evalResult.allowed, false);
  assert.equal(evalResult.operatorApproved, false);
});

test('AI Liability Defense Engine - Credential Mutation & IAM Elevation Detection', () => {
  const evalResult = evaluateActionLiability({ command: 'aws iam create-user --user-name evil' });
  assert.equal(evalResult.allowed, false);
  assert.equal(evalResult.severity, 'CRITICAL');
  assert.ok(evalResult.matchedRules.includes('LIABILITY_02_CREDENTIAL_MUTATION'));
});

test('AI Liability Defense Engine - Financial Dispatch Detection', () => {
  const evalResult = evaluateActionLiability({ command: 'stripe payouts create --amount 5000' });
  assert.equal(evalResult.allowed, false);
  assert.equal(evalResult.severity, 'CRITICAL');
  assert.ok(evalResult.matchedRules.includes('LIABILITY_03_FINANCIAL_DISPATCH'));
});

test('AI Liability Defense Engine - Public Release Deploy Gating', () => {
  const evalResult = evaluateActionLiability({ command: 'npm publish' });
  assert.equal(evalResult.allowed, true);
  assert.equal(evalResult.severity, 'HIGH');
  assert.equal(evalResult.verdict, 'WARN_AUDIT_REQUIRED');
  assert.ok(evalResult.matchedRules.includes('LIABILITY_04_PUBLIC_RELEASE_DEPLOY'));
});

test('AI Liability Defense Engine - "AI did it" excuse never clears a deny', () => {
  const evalResult = evaluateActionLiability({
    command: 'rm -rf /tmp/data',
    excuse: 'AI did it, the agent went rogue',
  });
  assert.equal(evalResult.allowed, false);
  assert.equal(evalResult.aiDidItIsNotADefense, true);
  assert.equal(evalResult.certified, false);
  assert.equal(evalResult.complianceObligations.cisoDefenseWarranty.safeHarborEligible, false);
});

test('AI Liability Defense Engine - gate JSON is executable by gates-engine', () => {
  const config = loadLiabilityConfig();
  assert.equal(config.certified, false);
  assert.equal(config.aiDidItIsNotADefense, true);
  assert.ok(Array.isArray(config.gates));
  assert.ok(config.gates.length >= 3);
  for (const gate of config.gates) {
    assert.equal(typeof gate.pattern, 'string', `${gate.id} must use gates-engine pattern`);
    assert.doesNotThrow(() => new RegExp(gate.pattern));
  }
});

test('AI Liability Defense Engine - unsigned receipt without signing secret', () => {
  const evalResult = evaluateActionLiability({ command: 'status' });
  const receipt = generateLiabilityReceipt({ command: 'status' }, evalResult, {});
  assert.equal(receipt.unsigned, true);
  assert.equal(receipt.proofSignature, null);
  assert.equal(verifyLiabilityReceipt(receipt), false);
});

test('AI Liability Defense Engine - Cryptographic Receipt Generation & Verification', () => {
  const action = {
    type: 'EXECUTE_QUERY',
    command: 'SELECT COUNT(*) FROM users',
    agentIdentity: 'ThumbGate-Auditor-1',
    sessionScope: 'session-2026-audit'
  };

  const evalResult = evaluateActionLiability(action);
  const receipt = generateLiabilityReceipt(action, evalResult, { signingSecret: 'custom-secret' });

  assert.ok(receipt.receiptId.startsWith('rcpt_liab_'));
  assert.ok(receipt.payloadHash);
  assert.ok(receipt.proofSignature);
  assert.equal(receipt.action.agentIdentity, 'ThumbGate-Auditor-1');

  const isValid = verifyLiabilityReceipt(receipt, 'custom-secret');
  assert.equal(isValid, true);

  // Tamper detection
  const tamperedReceipt = JSON.parse(JSON.stringify(receipt));
  tamperedReceipt.action.command = 'DROP TABLE users';
  const isTamperedValid = verifyLiabilityReceipt(tamperedReceipt, 'custom-secret');
  assert.equal(isTamperedValid, false);

  const flippedAllow = JSON.parse(JSON.stringify(receipt));
  flippedAllow.evaluation.allowed = true;
  flippedAllow.evaluation.operatorApproved = true;
  assert.equal(verifyLiabilityReceipt(flippedAllow, 'custom-secret'), false);
});
