#!/usr/bin/env node
'use strict';

const {
  buildCostControl,
  buildWorkflowControl,
  normalizeProviderAction,
} = require('./provider-action-normalizer');

const RUNTIME_MODES = Object.freeze(['live', 'sidecar', 'batch', 'simulation']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedStrings(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map((item) => String(item || '').trim()).filter(Boolean);
}

function evaluatePolicyLayer(layer = {}, action = {}) {
  const reasons = [];
  const toolName = String(action.toolName || '');
  const actionType = String(action.actionType || '');
  const allowedTools = normalizedStrings(layer.allowedTools);
  const deniedTools = normalizedStrings(layer.deniedTools);
  const allowedActionTypes = normalizedStrings(layer.allowedActionTypes);
  const deniedActionTypes = normalizedStrings(layer.deniedActionTypes);
  const actionScopes = new Set(normalizedStrings(
    action.toolInput?.scopes || action.toolInput?.scope || action.scopes,
  ));

  if (allowedTools.length > 0 && !allowedTools.includes(toolName)) {
    reasons.push(`tool_not_allowed:${toolName || 'unknown'}`);
  }
  if (deniedTools.includes(toolName)) reasons.push(`tool_denied:${toolName}`);
  if (allowedActionTypes.length > 0 && !allowedActionTypes.includes(actionType)) {
    reasons.push(`action_type_not_allowed:${actionType || 'unknown'}`);
  }
  if (deniedActionTypes.includes(actionType)) reasons.push(`action_type_denied:${actionType}`);

  for (const scope of normalizedStrings(layer.requiredScopes)) {
    if (!actionScopes.has(scope)) reasons.push(`missing_scope:${scope}`);
  }

  if (Number.isFinite(Number(layer.maxTokens))) {
    const totalTokens = Number(action.usage?.totalTokens || 0);
    if (totalTokens > Number(layer.maxTokens)) {
      reasons.push(`tokens_over_limit:${totalTokens}>${Number(layer.maxTokens)}`);
    }
  }
  if (Number.isFinite(Number(layer.maxCostUsd))) {
    const costUsd = Number(action.usage?.estimatedCostUsd || 0);
    if (costUsd > Number(layer.maxCostUsd)) {
      reasons.push(`cost_over_limit:${costUsd}>${Number(layer.maxCostUsd)}`);
    }
  }
  if (Number.isFinite(Number(layer.maxLatencyMs))) {
    const latencyMs = Number(action.toolInput?.expectedLatencyMs || action.expectedLatencyMs || 0);
    if (latencyMs > Number(layer.maxLatencyMs)) {
      reasons.push(`latency_over_sla:${latencyMs}>${Number(layer.maxLatencyMs)}`);
    }
  }

  if (layer.requireVerifiedHumanApproval === true) {
    const approval = action.toolInput?.humanApproval || {};
    const protocol = String(approval.protocol || '').toUpperCase();
    const verified = approval.verified === true
      && approval.actor?.kind === 'human'
      && String(approval.receiptId || '').trim().length > 0
      && ['CIBA', 'RAR'].includes(protocol);
    if (!verified) reasons.push('verified_human_approval_required');
  }

  return {
    id: String(layer.id || layer.category || 'unnamed-layer'),
    category: String(layer.category || 'business'),
    decision: reasons.length > 0 ? 'deny' : 'allow',
    reasons,
  };
}

/**
 * Evaluate one normalized tool action through ordered safety, business, and
 * client-SLA layers. Live mode enforces the result. Sidecar records the result
 * while allowing the host action. Batch and simulation never authorize an
 * execution, which keeps replay traffic from being mistaken for production.
 */
function evaluateRuntimeGovernanceAction(input = {}, policy = {}) {
  const mode = RUNTIME_MODES.includes(policy.mode) ? policy.mode : 'simulation';
  const action = normalizeProviderAction(input);
  const layers = asArray(policy.layers).map((layer) => evaluatePolicyLayer(layer, action));
  const cost = buildCostControl(action, policy.budget || {});
  const workflow = buildWorkflowControl(action, policy.workflow || {});
  const reasons = [
    ...layers.flatMap((layer) => layer.reasons.map((reason) => `${layer.id}:${reason}`)),
    ...cost.reasons.map((reason) => `cost:${reason}`),
    ...workflow.reasons.map((reason) => `workflow:${reason}`),
  ];
  const observedDecision = layers.some((layer) => layer.decision === 'deny')
    || cost.mode === 'block'
    || workflow.mode === 'block'
    ? 'deny'
    : reasons.length > 0 ? 'warn' : 'allow';
  const executionDecision = mode === 'live'
    ? observedDecision
    : mode === 'sidecar' ? 'allow' : 'not_executed';

  return {
    schemaVersion: 'thumbgate.runtime-governance.v1',
    mode,
    action,
    layers,
    cost,
    workflow,
    observedDecision,
    executionDecision,
    executionAllowed: executionDecision === 'allow',
    wouldDeny: observedDecision === 'deny',
    reasons,
  };
}

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
  RUNTIME_MODES,
  evaluatePolicyLayer,
  evaluateProductionAgentReadiness,
  evaluateRuntimeGovernanceAction,
  readinessStatus,
};
