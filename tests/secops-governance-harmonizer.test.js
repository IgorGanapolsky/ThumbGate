'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
