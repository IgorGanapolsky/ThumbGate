/**
 * Test Suite for Box & NVIDIA Agent Security & Context Governance Diode
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CLASSIFICATION_LEVELS,
  filterContextByAgentPermissions,
  enforceMcpToolGuardrails,
  AgentThreatDetector,
  validateSandboxMountPath
} = require('../src/box-nvidia-agent-security-diode');

test('Box-NVIDIA Security - Permission-Aware Context Retrieval filters sensitive passages', () => {
  const passages = [
    { documentId: 'doc_1', title: 'Public API Reference', classification: 'PUBLIC' },
    { documentId: 'doc_2', title: 'Internal Onboarding Guide', classification: 'INTERNAL' },
    { documentId: 'doc_3', title: 'Customer Financial Ledger', classification: 'RESTRICTED_PII' }
  ];

  // Researcher agent (INTERNAL clearance) can see PUBLIC and INTERNAL, but NOT RESTRICTED_PII
  const researcherResult = filterContextByAgentPermissions({
    agentRole: 'researcher_agent',
    passages
  });

  assert.equal(researcherResult.allowedPassages.length, 2);
  assert.equal(researcherResult.redactedCount, 1);
  assert.equal(researcherResult.redactedPassages[0].documentId, 'doc_3');
  assert.equal(researcherResult.redactedPassages[0].reason, 'INSUFFICIENT_CLEARANCE_PRE_LLM_ACL');

  // Security auditor (RESTRICTED_PII clearance) can see all 3
  const auditorResult = filterContextByAgentPermissions({
    agentRole: 'security_auditor',
    passages
  });
  assert.equal(auditorResult.allowedPassages.length, 3);
  assert.equal(auditorResult.redactedCount, 0);
});

test('Box-NVIDIA Security - MCP Tool Guardrails and Boundary Containment', () => {
  // Untrusted guest agent is blocked from calling terminal or write_file
  const res1 = enforceMcpToolGuardrails({
    agentRole: 'untrusted_guest',
    toolName: 'terminal',
    parameters: { command: 'ls -la' }
  });
  assert.equal(res1.allowed, false);
  assert.equal(res1.violation, 'MCP_ROLE_TOOL_RESTRICTION');

  // Developer agent calling read_file is allowed
  const res2 = enforceMcpToolGuardrails({
    agentRole: 'developer_agent',
    toolName: 'read_file',
    parameters: { path: 'src/index.js' }
  });
  assert.equal(res2.allowed, true);

  // Path traversal attempt (/etc/shadow) is blocked
  const res3 = enforceMcpToolGuardrails({
    agentRole: 'developer_agent',
    toolName: 'read_file',
    parameters: { path: '/etc/shadow' }
  });
  assert.equal(res3.allowed, false);
  assert.equal(res3.violation, 'MCP_PATH_TRAVERSAL_DETECTED');
});

test('Box-NVIDIA Security - Agent Velocity & Threat Anomaly Detection', () => {
  const detector = new AgentThreatDetector({ maxDocsPerMinute: 5, maxDeletionsPerMinute: 2 });
  const agentId = 'agent_sub_007';

  // Record 5 retrievals -> normal
  for (let i = 0; i < 5; i++) {
    const res = detector.recordActivity({ agentId, actionType: 'RETRIEVE_DOCUMENT' });
    assert.equal(res.anomalyDetected, false);
  }

  // 6th retrieval trips velocity anomaly circuit breaker
  const tripRes = detector.recordActivity({ agentId, actionType: 'RETRIEVE_DOCUMENT' });
  assert.equal(tripRes.anomalyDetected, true);
  assert.equal(tripRes.trippedCircuitBreaker, true);
  assert.equal(tripRes.violation, 'MASS_EXFILTRATION_VELOCITY_EXCEEDED');
});

test('Box-NVIDIA Security - Governed Sandbox Mount Invariants', () => {
  const workspaceRoot = '/Users/iganapolsky/workspace/sandbox';

  // Mount within workspace is allowed
  const validMount = validateSandboxMountPath({
    workspaceRoot,
    mountPath: '/Users/iganapolsky/workspace/sandbox/repo-a'
  });
  assert.equal(validMount.allowed, true);

  // Escaping mount is blocked
  const invalidMount = validateSandboxMountPath({
    workspaceRoot,
    mountPath: '/Users/iganapolsky/.ssh'
  });
  assert.equal(invalidMount.allowed, false);
  assert.equal(invalidMount.violation, 'SANDBOX_ESCAPE_MOUNT');
});
