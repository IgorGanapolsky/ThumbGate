'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const harmonizer = require('../scripts/unified-ai-secops-governance');

test('SecOps Harmonizer: loads default gate configuration cleanly', () => {
  const config = harmonizer.loadGateConfig();
  assert.equal(config.gateId, 'gate_secops_governance_harmonizer_2026');
  assert.ok(Array.isArray(config.complianceFrameworks));
  assert.ok(config.autonomyBoundaries.humanApprovalMandatory.includes('isolate_production_host'));
});

test('SecOps Harmonizer: assessAutonomyBoundary enforces 3-tier autonomy matrix', () => {
  const allowed = harmonizer.assessAutonomyBoundary('triage_alert', 'standard', 'low');
  assert.equal(allowed.boundary, harmonizer.AUTONOMY_LEVELS.AUTONOMOUS_ALLOWED);
  assert.equal(allowed.requiresApproval, false);
  assert.equal(allowed.allowedAutonomously, true);

  const advisory = harmonizer.assessAutonomyBoundary('recommend_firewall_rule', 'standard', 'high');
  assert.equal(advisory.boundary, harmonizer.AUTONOMY_LEVELS.ADVISORY_ONLY);
  assert.equal(advisory.requiresApproval, true);

  const mandatory = harmonizer.assessAutonomyBoundary('isolate_production_host', 'production_critical', 'critical');
  assert.equal(mandatory.boundary, harmonizer.AUTONOMY_LEVELS.HUMAN_APPROVAL_MANDATORY);
  assert.equal(mandatory.requiresApproval, true);
  assert.equal(mandatory.allowedAutonomously, false);
});

test('SecOps Harmonizer: generateSinglePassAuditReceipt produces tamper-evident dual audit format', () => {
  const receipt = harmonizer.generateSinglePassAuditReceipt({
    traceId: 'trace_test_001',
    agentIdentity: 'agent_threat_hunter',
    actionType: 'query_threat_intel',
    targetEntity: 'ip_198_51_100_1',
    governanceRiskTier: 'TIER_2_CONTROLLED',
  });

  assert.ok(receipt.receiptId.startsWith('receipt_secops_'));
  assert.equal(receipt.traceId, 'trace_test_001');
  assert.equal(receipt.agentIdentity, 'agent_threat_hunter');
  assert.equal(receipt.dualPurpose.secopsSIEMFormat.event_type, 'ai_secops_action_evaluated');
  assert.equal(receipt.dualPurpose.governanceAuditFormat.oversightMode, 'SINGLE_PASS_CRYPTO_VERIFIED');
  assert.equal(typeof receipt.integrityHash, 'string');
  assert.equal(receipt.integrityHash.length, 64);
});

test('SecOps Harmonizer: scanGovernanceSecOpsConflicts detects contradictory policies', () => {
  const conflictRuleset = {
    policies: {
      retentionHoldActive: true,
      evidencePreservationMandatory: true,
      humanOversightMandatory: true,
    },
    rules: [
      { action: 'purge_logs' },
      { action: 'hard_delete_infected_blob' },
      { unsupervisedExecution: true },
    ],
  };

  const scan = harmonizer.scanGovernanceSecOpsConflicts(conflictRuleset);
  assert.equal(scan.conflictsDetected, true);
  assert.equal(scan.conflictCount, 3);
  assert.equal(scan.status, 'CONFLICT_INTERDICTED');
  assert.ok(scan.conflicts.some((c) => c.conflictId === 'CONF_01_RETENTION_VS_PURGE'));
  assert.ok(scan.conflicts.some((c) => c.conflictId === 'CONF_02_QUARANTINE_VS_CHAIN_OF_CUSTODY'));
  assert.ok(scan.conflicts.some((c) => c.conflictId === 'CONF_03_AUTONOMOUS_CONTAINMENT_OVERSIGHT'));
});

test('SecOps Harmonizer: scanGovernanceSecOpsConflicts returns HARMONIZED when no conflicts exist', () => {
  const cleanRuleset = {
    policies: {
      retentionHoldActive: false,
    },
    rules: [
      { action: 'read_telemetry' },
    ],
  };

  const scan = harmonizer.scanGovernanceSecOpsConflicts(cleanRuleset);
  assert.equal(scan.conflictsDetected, false);
  assert.equal(scan.conflictCount, 0);
  assert.equal(scan.status, 'HARMONIZED');
});

test('SecOps Harmonizer: evaluateSecOpsGovernance end-to-end evaluation', () => {
  const safeEval = harmonizer.evaluateSecOpsGovernance(
    { type: 'detect_anomaly' },
    { scope: 'standard', severity: 'low' }
  );
  assert.equal(safeEval.decision, 'ALLOWED');
  assert.equal(safeEval.autonomyVerdict.allowedAutonomously, true);

  const blockedEval = harmonizer.evaluateSecOpsGovernance(
    { type: 'isolate_production_host' },
    { scope: 'production_critical', severity: 'critical' }
  );
  assert.equal(blockedEval.decision, 'INTERDICTED');
  assert.equal(blockedEval.autonomyVerdict.requiresApproval, true);
});

// ---------------------------------------------------------------------------
// The autonomy matrix must FAIL CLOSED
// ---------------------------------------------------------------------------

test('SecOps Harmonizer: an action absent from every list is NOT autonomous', () => {
  // The defect: AUTONOMOUS_ALLOWED was the trailing `else`, so any action not
  // named in the advisory or mandatory lists — a new action type, a
  // misspelling, or an outright destructive one — was classified autonomous.
  const unknown = harmonizer.assessAutonomyBoundary('delete_all_customer_data', 'standard', 'medium');
  assert.equal(unknown.boundary, harmonizer.AUTONOMY_LEVELS.HUMAN_APPROVAL_MANDATORY);
  assert.equal(unknown.allowedAutonomously, false);
  assert.equal(unknown.requiresApproval, true);
  assert.equal(unknown.recognizedAction, false);
  assert.match(unknown.rationale, /absent from the autonomy allowlist/);

  // A misspelling of an allowlisted action must not inherit its permission.
  const typo = harmonizer.assessAutonomyBoundary('triage_alerts', 'standard', 'low');
  assert.equal(typo.allowedAutonomously, false);

  // An empty / missing action type is unknown too.
  for (const bad of ['', null, undefined]) {
    assert.equal(harmonizer.assessAutonomyBoundary(bad, 'standard', 'low').allowedAutonomously, false);
  }
});

test('SecOps Harmonizer: only allowlisted actions reach AUTONOMOUS_ALLOWED', () => {
  for (const action of harmonizer.DEFAULT_BOUNDARIES.autonomousAllowed) {
    const verdict = harmonizer.assessAutonomyBoundary(action, 'standard', 'low');
    assert.equal(verdict.boundary, harmonizer.AUTONOMY_LEVELS.AUTONOMOUS_ALLOWED, action);
    assert.equal(verdict.recognizedAction, true, action);
  }
});

test('SecOps Harmonizer: an unknown action is INTERDICTED end to end', () => {
  const verdict = harmonizer.evaluateSecOpsGovernance(
    { type: 'exfiltrate_customer_database' },
    { scope: 'standard', severity: 'low' }
  );
  assert.equal(verdict.decision, 'INTERDICTED');
});

// ---------------------------------------------------------------------------
// loadGateConfig must actually read the manifest
// ---------------------------------------------------------------------------

test('SecOps Harmonizer: loadGateConfig reads an operator manifest instead of silently defaulting', () => {
  // The defect: the module never imported `fs`, so every call threw a
  // ReferenceError that the broad catch swallowed. The shipped manifest and any
  // operator --config were ignored, and customised mandatory-action boundaries
  // were evaluated as autonomous.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-secops-config-'));
  const configPath = path.join(dir, 'custom.json');
  fs.writeFileSync(configPath, JSON.stringify({
    gateId: 'gate_operator_custom',
    autonomyBoundaries: {
      autonomousAllowed: ['read_telemetry'],
      advisoryOnly: [],
      humanApprovalMandatory: ['triage_alert'],
    },
  }), 'utf8');

  try {
    const cfg = harmonizer.loadGateConfig(configPath);
    assert.equal(cfg.gateId, 'gate_operator_custom', 'the operator manifest was actually read');
    assert.equal(cfg.configSource, configPath);

    // The operator moved triage_alert into the mandatory tier; that must win.
    const verdict = harmonizer.assessAutonomyBoundary('triage_alert', 'standard', 'low', cfg);
    assert.equal(verdict.boundary, harmonizer.AUTONOMY_LEVELS.HUMAN_APPROVAL_MANDATORY);
    assert.equal(verdict.allowedAutonomously, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SecOps Harmonizer: a malformed manifest is reported, not silently replaced by defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-secops-bad-'));
  const configPath = path.join(dir, 'broken.json');
  fs.writeFileSync(configPath, '{ not json', 'utf8');

  try {
    const cfg = harmonizer.loadGateConfig(configPath);
    assert.equal(cfg.configSource, null);
    assert.match(cfg.configError, /broken\.json/);
    // It still fails safe: the built-in boundaries are in force.
    assert.ok(cfg.autonomyBoundaries.humanApprovalMandatory.includes('isolate_production_host'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SecOps Harmonizer: a missing manifest path yields defaults with configSource null', () => {
  const cfg = harmonizer.loadGateConfig(path.join(os.tmpdir(), 'tg-secops-nope', 'absent.json'));
  assert.equal(cfg.configSource, null);
  assert.equal(cfg.configError, undefined);
  assert.equal(cfg.gateId, 'gate_secops_governance_harmonizer_2026');
});
