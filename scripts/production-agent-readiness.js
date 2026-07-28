#!/usr/bin/env node
'use strict';

function readinessStatus(score, missing) {
  if (missing.length === 0) return 'production_ready';
  if (score >= 60) return 'needs_hardening';
  return 'prototype';
}

function evaluateProductionAgentReadiness(input = {}) {
  const signals = {
    subAgents: Array.isArray(input.subAgents) && input.subAgents.length >= 2,
    structuredOutputs: input.structuredOutputs === true,
    dynamicRag: input.dynamicRag === true,
    observability: input.observability === true || input.tracing === true,
    circuitBreakers: input.circuitBreakers === true,
    evaluationDataset: input.evaluationDataset === true,
    deterministicRegression: input.deterministicRegression === true,
    toolContractValidation: input.toolContractValidation === true,
    taskOutcomeMonitoring: input.taskOutcomeMonitoring === true,
    humanEscalation: input.humanEscalation === true,
    securityControls: input.securityControls === true,
    deploymentEvidence: input.deploymentEvidence === true,
  };
  const missing = Object.entries(signals)
    .filter(([, present]) => !present)
    .map(([name]) => name);
  const score = Math.round((Object.values(signals).filter(Boolean).length / Object.keys(signals).length) * 100);
  return {
    status: readinessStatus(score, missing),
    score,
    signals,
    missing,
    requiredFixes: missing.map((name) => ({
      subAgents: 'Split monolithic prompts into narrow sub-agent stages.',
      structuredOutputs: 'Use runtime-validated schemas instead of prompt-only JSON formatting.',
      dynamicRag: 'Replace hardcoded context with refreshed retrieval over indexed source material.',
      observability: 'Emit traces for model calls, tool calls, tokens, latency, and stage failures.',
      circuitBreakers: 'Set retry, timeout, loop, and spend limits before production use.',
      evaluationDataset: 'Maintain versioned golden task and retrieval cases with explicit expected outcomes.',
      deterministicRegression: 'Gate releases on deterministic tests; keep LLM judges diagnostic or secondary.',
      toolContractValidation: 'Validate tool inputs and declared structured outputs at runtime.',
      taskOutcomeMonitoring: 'Record evidence-backed task outcomes and require measured production samples.',
      humanEscalation: 'Use authenticated, auditable escalation with independent human decision makers.',
      securityControls: 'Enforce least privilege, OAuth scopes, secret filtering, and tenant/session isolation.',
      deploymentEvidence: 'Verify the exact merge commit in CI and the deployed build before claiming production readiness.',
    }[name])),
  };
}

module.exports = {
  evaluateProductionAgentReadiness,
  readinessStatus,
};
