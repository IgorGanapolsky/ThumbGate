#!/usr/bin/env node
'use strict';

const { normalizeProviderAction } = require('../../scripts/provider-action-normalizer');

const BLOCK_DECISIONS = new Set([
  'block',
  'blocked',
  'deny',
  'denied',
  'disallow',
  'disallowed',
  'fail',
  'failed',
  'forbid',
  'forbidden',
  'reject',
  'rejected',
  'unsafe',
  'violation',
]);

const REVIEW_DECISIONS = new Set([
  'approval',
  'approval-required',
  'approval_required',
  'approve',
  'human-review',
  'human_review',
  'manual-review',
  'manual_review',
  'review',
  'requires-approval',
  'requires_approval',
  'requires-review',
  'requires_review',
]);

const ALLOW_DECISIONS = new Set([
  'accept',
  'accepted',
  'allow',
  'allowed',
  'ok',
  'pass',
  'passed',
  'permit',
  'permitted',
  'safe',
]);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function normalizeDecisionToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

function normalizeEvidence(value) {
  const direct = asArray(value.evidence);
  const citations = asArray(value.citations);
  const violations = asArray(value.violations);
  const reasons = asArray(value.reasons);
  const reasoning = asArray(value.reasoning);
  const threatTypes = asArray(value.threat_types || value.threatTypes)
    .map((threatType) => ({
      code: String(threatType || '').trim(),
      message: `Threat type: ${String(threatType || '').trim()}`,
      source: 'guardian',
      severity: firstString(value.threat_level, value.threatLevel),
    }));
  return [...direct, ...citations, ...violations, ...reasons, ...reasoning, ...threatTypes]
    .map((entry) => {
      if (typeof entry === 'string') return { text: entry };
      const object = asObject(entry);
      if (!Object.keys(object).length) return null;
      return {
        id: firstString(object.id, object.ruleId, object.rule_id, object.code),
        text: firstString(object.text, object.reason, object.message, object.description, object.title),
        source: firstString(object.source, object.provider, object.policy),
        severity: firstString(object.severity, object.level),
        raw: object,
      };
    })
    .filter(Boolean);
}

function extractPolicyDecision(input = {}) {
  const event = asObject(input);
  for (const candidate of [
    event.policyDecision,
    event.policy_decision,
    event.guardrailResult,
    event.guardrail_result,
    event.result,
  ]) {
    const object = asObject(candidate);
    if (Object.keys(object).length) return object;
  }
  return event;
}

function classifyPolicyDecision(input = {}) {
  const value = extractPolicyDecision(input);
  const token = normalizeDecisionToken(firstString(
    value.decision,
    value.action,
    value.status,
    value.result,
    value.verdict,
    value.outcome,
    value.effect,
    value.recommended_action,
    value.recommendedAction,
  ));

  if (
    value.allowed === false
    || value.is_safe === false
    || value.isSafe === false
    || value.accepted === false
    || value.blocked === true
    || value.denied === true
    || BLOCK_DECISIONS.has(token)
  ) {
    return 'block';
  }
  if (
    value.requiresApproval === true
    || value.requires_approval === true
    || value.reviewRequired === true
    || value.review_required === true
    || REVIEW_DECISIONS.has(token)
  ) {
    return 'approval_required';
  }
  if (
    value.allowed === true
    || value.is_safe === true
    || value.isSafe === true
    || value.accepted === true
    || ALLOW_DECISIONS.has(token)
  ) {
    return 'allow';
  }
  return 'unknown';
}

function normalizePolicyDecision(input = {}, options = {}) {
  const value = extractPolicyDecision(input);
  const decision = classifyPolicyDecision(value);
  const source = firstString(
    options.source,
    value.source,
    value.provider,
    value.engine,
    value.policyEngine,
    value.policy_engine,
    'policy-engine'
  );
  const reason = firstString(
    value.reason,
    value.message,
    value.explanation,
    value.summary,
    asArray(value.reasoning).join('; '),
    asArray(value.reasons).join('; '),
    decision === 'unknown' ? 'Policy engine returned an unknown decision; approval required before execution.' : ''
  );

  return {
    allowed: decision === 'allow',
    blocked: decision === 'block',
    approvalRequired: decision === 'approval_required' || decision === 'unknown',
    decision,
    reason,
    source,
    confidence: Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : null,
    policyId: firstString(value.policyId, value.policy_id, value.ruleId, value.rule_id, value.id),
    severity: firstString(value.severity, value.level, value.threat_level, value.threatLevel),
    score: Number.isFinite(Number(value.score))
      ? Number(value.score)
      : (Number.isFinite(Number(value.threat_score)) ? Number(value.threat_score) : null),
    evidence: normalizeEvidence(value),
    raw: value,
  };
}

function normalizePolicyAction(input = {}) {
  const event = asObject(input);
  return {
    ...normalizeProviderAction({
      ...event,
      provider: firstString(event.provider, event.agentRuntime, event.runtime, 'policy-engine'),
      toolName: firstString(event.toolName, event.tool_name, event.name),
      input: asObject(event.toolInput || event.input || event.arguments || event.args),
    }),
    policyContext: asObject(event.policyContext || event.policy_context),
  };
}

function createPolicyEngineGuard({
  policyCheck,
  executeTool,
  gateCheck,
  onDecision,
  source = 'policy-engine',
} = {}) {
  if (typeof policyCheck !== 'function') {
    throw new TypeError('createPolicyEngineGuard requires a policyCheck function');
  }
  if (typeof executeTool !== 'function') {
    throw new TypeError('createPolicyEngineGuard requires an executeTool function');
  }

  return async function guardedPolicyTool(input = {}) {
    const normalizedAction = normalizePolicyAction(input);
    const policyDecision = normalizePolicyDecision(await policyCheck(normalizedAction), { source });
    const gateDecision = typeof gateCheck === 'function'
      ? normalizePolicyDecision(await gateCheck({ normalizedAction, policyDecision }), { source: 'thumbgate' })
      : null;
    const effectiveDecision = gateDecision && !gateDecision.allowed ? gateDecision : policyDecision;

    if (typeof onDecision === 'function') {
      await onDecision({ normalizedAction, policyDecision, gateDecision, effectiveDecision });
    }

    if (!effectiveDecision.allowed) {
      const error = new Error(effectiveDecision.reason || 'ThumbGate blocked this action before execution.');
      error.code = effectiveDecision.approvalRequired ? 'THUMBGATE_APPROVAL_REQUIRED' : 'THUMBGATE_BLOCKED';
      error.thumbgate = { normalizedAction, policyDecision, gateDecision, effectiveDecision };
      throw error;
    }

    return executeTool(input, { normalizedAction, policyDecision, gateDecision, effectiveDecision });
  };
}

module.exports = {
  createPolicyEngineGuard,
  extractPolicyDecision,
  normalizePolicyAction,
  normalizePolicyDecision,
};
