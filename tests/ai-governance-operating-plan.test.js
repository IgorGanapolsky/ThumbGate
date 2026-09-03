'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DATA_CLASSES,
  RISK_TIERS,
  CONSEQUENTIAL_ACTIONS,
  registerUseCase,
  classifyFlow,
  checkPilotScope,
  assessBlastRadius,
  checkMachineIdentity,
  eventTaxonomy,
  releaseGate,
  checkKitchen,
  tabletopScenario,
} = require('../scripts/ai-governance-operating-plan');

test('step 1: register refuses incomplete inventories (CMDB, not slides)', () => {
  const bad = registerUseCase({ name: 'chatbot' });
  assert.equal(bad.accepted, false);
  assert.ok(bad.reason.includes('model'));
  const good = registerUseCase({
    name: 'ticket-summary', model: 'local-llm', vendor: 'ollama',
    owner: 'support-lead', userGroup: 'support', businessPurpose: 'ticket triage',
    riskTier: 'low',
  });
  assert.equal(good.accepted, true);
  assert.ok(good.entry.registeredAt);
});

test('step 1: risk tiering validates and refuses unjustified critical', () => {
  assert.ok(!RISK_TIERS.includes('extreme'));
  const noTier = registerUseCase({
    name: 'x', model: 'm', vendor: 'v', owner: 'o',
    userGroup: 'g', businessPurpose: 'p', riskTier: 'extreme',
  });
  assert.equal(noTier.accepted, false);
  const criticalNoReason = registerUseCase({
    name: 'x', model: 'm', vendor: 'v', owner: 'o',
    userGroup: 'g', businessPurpose: 'p', riskTier: 'critical',
  });
  assert.equal(criticalNoReason.accepted, false);
  const criticalWithActions = registerUseCase({
    name: 'x', model: 'm', vendor: 'v', owner: 'o',
    userGroup: 'g', businessPurpose: 'p', riskTier: 'critical', takesActions: true,
  });
  assert.equal(criticalWithActions.accepted, true);
});

test('step 2: sensitive data barred from unapproved models and browsers', () => {
  assert.equal(classifyFlow({ dataClass: 'pii', modelApproved: false }).allowed, false);
  assert.equal(classifyFlow({ dataClass: 'customer', modelApproved: true, viaUnmanagedBrowser: true }).allowed, false);
  assert.equal(classifyFlow({ dataClass: 'confidential', modelApproved: true }).allowed, true);
  assert.equal(classifyFlow({ dataClass: 'public', modelApproved: false }).allowed, true);
  assert.equal(classifyFlow({ dataClass: 'banana', modelApproved: true }).allowed, false);
  assert.equal(DATA_CLASSES.length, 7);
});

test('step 3: pilot must be constrained with exactly one metric', () => {
  const ok = checkPilotScope({
    taskType: 'summarization',
    successMetrics: ['reduce ticket-summary time 60% at >=95% factual accuracy'],
    canModifyProduction: false,
  });
  assert.equal(ok.approved, true);
  const reasoning = checkPilotScope({ taskType: 'autonomous-reasoning', successMetrics: ['m'], canModifyProduction: false });
  assert.equal(reasoning.approved, false);
  const twoMetrics = checkPilotScope({ taskType: 'extraction', successMetrics: ['a', 'b'], canModifyProduction: false });
  assert.equal(twoMetrics.approved, false);
  const prodWriter = checkPilotScope({ taskType: 'retrieval', successMetrics: ['a'], canModifyProduction: true });
  assert.equal(prodWriter.approved, false);
});

test('step 4: blast radius names surfaces and demands approval gates', () => {
  const b = assessBlastRadius({
    name: 'ticket-summary',
    exposes: ['records', 'customerCommunications'],
    actions: ['external-communication', 'read-only'],
  });
  assert.deepEqual(b.blastRadius, ['records', 'customerCommunications']);
  assert.deepEqual(b.consequentialActions, ['external-communication']);
  assert.equal(b.requiresApprovalGate, true);
  const safe = assessBlastRadius({ name: 'research', exposes: [], actions: [] });
  assert.equal(safe.blastRadius, 'none');
  assert.equal(safe.requiresApprovalGate, false);
  assert.ok(CONSEQUENTIAL_ACTIONS.includes('payment'));
  assert.ok(CONSEQUENTIAL_ACTIONS.includes('deletion'));
});

test('step 5: least privilege — no birthrights, rotate, separate action identities', () => {
  const good = checkMachineIdentity({
    scopes: ['tickets:read'], credentialRotationDays: 30, readOnlyResearch: true,
  });
  assert.equal(good.compliant, true);
  const wildcard = checkMachineIdentity({ scopes: ['*'], credentialRotationDays: 30 });
  assert.ok(wildcard.problems.some((p) => p.includes('wildcard')));
  const noRotate = checkMachineIdentity({ scopes: ['x:read'], credentialRotationDays: 365 });
  assert.ok(noRotate.problems.some((p) => p.includes('rotate')));
  const mixedIdentity = checkMachineIdentity({
    scopes: ['x:read'], credentialRotationDays: 30, readOnlyResearch: true, capabilities: ['action'],
  });
  assert.ok(mixedIdentity.problems.some((p) => p.includes('read-only')));
  const noScopes = checkMachineIdentity({ credentialRotationDays: 30 });
  assert.equal(noScopes.compliant, false);
});

test('step 6: taxonomy covers the episode event classes with owners and containment', () => {
  const tx = eventTaxonomy();
  const names = tx.map((e) => e.event);
  for (const required of [
    'hallucinated-high-impact-output', 'unsafe-tool-call', 'data-leakage',
    'prompt-injection', 'unauthorized-retrieval', 'abnormal-cost', 'output-drift',
  ]) {
    assert.ok(names.includes(required), `missing event type ${required}`);
  }
  for (const e of tx) {
    assert.ok(e.owner && e.severity && e.containment, `${e.event} needs owner/severity/containment`);
  }
});

test('step 8: release gate blocks regression, broadening, missing monitoring/approval', () => {
  const green = releaseGate({
    evalsPass: true, noEvalRegression: true, noPermissionBroadening: true,
    monitoringPresent: true, approvalCheckpointsCoverConsequential: true,
  });
  assert.equal(green.ship, true);
  assert.equal(green.rollbackPaths.length, 4);
  const blocked = releaseGate({
    evalsPass: true, noEvalRegression: false, noPermissionBroadening: false,
    monitoringPresent: false, approvalCheckpointsCoverConsequential: false,
  });
  assert.equal(blocked.ship, false);
  assert.equal(blocked.blockers.length, 4);
});

test('step 9: AI Kitchen requires all five functions', () => {
  const partial = checkKitchen([{ function: 'engineering' }]);
  assert.equal(partial.formed, false);
  assert.deepEqual(partial.missing.sort(), ['business-sponsor', 'data-owner', 'legal-privacy', 'security']);
  const full = checkKitchen([
    { function: 'engineering' }, { function: 'security' }, { function: 'legal-privacy' },
    { function: 'data-owner' }, { function: 'business-sponsor' },
  ]);
  assert.equal(full.formed, true);
  assert.equal(full.cadence.activeHighRisk, 'weekly');
  assert.equal(full.cadence.portfolioReview, 'monthly');
});

test('step 10: tabletop covers injection -> retrieval -> privileged call', () => {
  const t = tabletopScenario();
  assert.ok(t.scenario.includes('prompt-injected'));
  assert.ok(t.containment.includes('revoke credentials'));
  assert.ok(t.containment.includes('preserve logs'));
  assert.ok(t.participants.includes('SOC'));
  assert.ok(t.participants.includes('CSIRT'));
});
