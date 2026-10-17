#!/usr/bin/env node
'use strict';

/**
 * Task Outcomes — evidence-backed proof that an agent is working.
 *
 * A response, tool call, or demo is not a success event. This ledger stores
 * task-level outcomes and computes transparent component metrics without
 * hiding weak behavior behind a single composite score.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getFeedbackPaths } = require('./feedback-paths');
const { validateToolContract } = require('./tool-contract-validator');

const OUTCOMES_FILE = 'task-outcome-receipts.jsonl';
const SCHEMA_PATH = path.join(__dirname, '..', 'config', 'schemas', 'task-outcome-receipt.schema.json');
const TASK_OUTCOME_SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

function getTaskOutcomesPath(options = {}) {
  return path.join(getFeedbackPaths(options).FEEDBACK_DIR, OUTCOMES_FILE);
}

function normalizeTaskOutcome(input = {}, now = new Date()) {
  const verification = input.verification || {};
  const policy = input.policy || {};
  const efficiency = input.efficiency || {};
  const toolCalls = Array.isArray(input.toolCalls) ? input.toolCalls : [];
  const receipt = {
    taskId: cleanString(input.taskId),
    taskType: cleanString(input.taskType || 'general'),
    goal: cleanString(input.goal),
    expectedOutcome: optionalString(input.expectedOutcome),
    status: input.status || 'failed',
    verification: {
      performed: verification.performed === true,
      passed: verification.passed === true,
      verifier: optionalString(verification.verifier),
      method: optionalString(verification.method),
      evidence: cleanStringArray(verification.evidence),
      unsupportedClaims: nonNegativeInteger(verification.unsupportedClaims),
    },
    toolCalls: toolCalls.map((x) => normalizeToolCall(x)),
    policy: {
      violations: nonNegativeInteger(policy.violations),
      unsafeEscapes: nonNegativeInteger(policy.unsafeEscapes),
      falseBlocks: nonNegativeInteger(policy.falseBlocks),
    },
    failure: normalizeFailure(input.failure),
    escalation: normalizeEscalation(input.escalation),
    efficiency: {
      latencyMs: nonNegativeNumber(efficiency.latencyMs),
      costUsd: nonNegativeNumber(efficiency.costUsd),
      firstAttempt: efficiency.firstAttempt === true,
    },
    businessOutcome: normalizeBusinessOutcome(input.businessOutcome),
    traceId: optionalString(input.traceId),
    idempotencyKey: optionalString(input.idempotencyKey || input.taskId),
    versions: normalizeVersions(input.versions),
    metadata: isPlainObject(input.metadata) ? input.metadata : {},
    recordedAt: input.recordedAt || now.toISOString(),
  };

  removeUndefined(receipt);
  const verdict = evaluateWorkingVerdict(receipt);
  receipt.working = verdict.working;
  receipt.workingReasons = verdict.reasons;
  const isExplicitType = Boolean(input.failure && input.failure.type);
  const isExplicitSignal = Boolean(input.failure && input.failure.firstSignal);
  if (!verdict.working) {
    const classification = classifyFailureType(receipt);
    if (!receipt.failure) {
      receipt.failure = {
        type: classification.type,
        firstSignal: classification.firstSignal,
      };
    } else {
      if (!receipt.failure.type) receipt.failure.type = classification.type;
      if (!receipt.failure.firstSignal) receipt.failure.firstSignal = classification.firstSignal;
    }
  }
  receipt.receiptHash = hashReceipt(receipt, {
    excludeType: !isExplicitType,
    excludeSignal: !isExplicitSignal,
  });
  return receipt;
}

function evaluateWorkingVerdict(receipt = {}) {
  const reasons = [];
  if (receipt.status !== 'completed') reasons.push(`status_${receipt.status || 'unknown'}`);
  if (!receipt.verification?.performed) reasons.push('verification_not_performed');
  if (!receipt.verification?.passed) reasons.push('verification_failed');
  if (!receipt.verification?.evidence?.length) reasons.push('evidence_missing');
  if (Number(receipt.verification?.unsupportedClaims || 0) > 0) reasons.push('unsupported_claim');
  if ((receipt.toolCalls || []).some((call) => !call.contractValid)) reasons.push('tool_contract_invalid');
  if ((receipt.toolCalls || []).some((call) => !call.allowed)) reasons.push('tool_policy_denied');
  if ((receipt.toolCalls || []).some((call) => !call.succeeded)) reasons.push('tool_call_failed');
  if ((receipt.toolCalls || []).some((call) => call.duplicateSideEffect)) reasons.push('duplicate_side_effect');
  if (Number(receipt.policy?.violations || 0) > 0) reasons.push('policy_violation');
  if (Number(receipt.policy?.unsafeEscapes || 0) > 0) reasons.push('unsafe_escape');
  if (Number(receipt.policy?.falseBlocks || 0) > 0) reasons.push('safe_false_block');
  if (receipt.escalation?.required && receipt.escalation?.correct !== true) reasons.push('incorrect_escalation');
  return { working: reasons.length === 0, reasons };
}

function recordTaskOutcome(input = {}, options = {}) {
  const receipt = normalizeTaskOutcome(input, options.now || new Date());
  const validation = validateToolContract(TASK_OUTCOME_SCHEMA, receipt);
  if (!validation.valid) {
    const error = new Error(`Invalid task outcome receipt: ${validation.errors.join('; ')}`);
    error.code = 'THUMBGATE_TASK_OUTCOME_INVALID';
    error.validationErrors = validation.errors;
    throw error;
  }

  const outcomesPath = getTaskOutcomesPath(options);
  const existing = readTaskOutcomes(options);
  const duplicate = existing.find((entry) => entry.idempotencyKey === receipt.idempotencyKey);
  if (duplicate) {
    if (duplicate.receiptHash !== receipt.receiptHash) {
      const error = new Error(`Conflicting task outcome for idempotency key '${receipt.idempotencyKey}'`);
      error.code = 'THUMBGATE_IDEMPOTENCY_CONFLICT';
      throw error;
    }
    return { recorded: false, duplicate: true, receipt: duplicate };
  }

  fs.mkdirSync(path.dirname(outcomesPath), { recursive: true });
  fs.appendFileSync(outcomesPath, `${JSON.stringify(receipt)}\n`, 'utf8');
  recordOutcomeTrace(receipt, options);
  return { recorded: true, duplicate: false, receipt };
}

function readTaskOutcomes(options = {}) {
  const outcomesPath = options.inputPath
    ? path.resolve(options.inputPath)
    : getTaskOutcomesPath(options);
  let raw = '';
  try {
    raw = fs.readFileSync(outcomesPath, 'utf8');
  } catch {
    return [];
  }
  return raw.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function getTaskOutcome(taskId, options = {}) {
  const outcomes = readTaskOutcomes(options);
  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    if (outcomes[index].taskId === taskId) return outcomes[index];
  }
  return null;
}

function calculateTaskOutcomeMetrics(outcomes = []) {
  const valid = outcomes.filter((entry) => entry && typeof entry === 'object');
  const toolCalls = valid.flatMap((entry) => entry.toolCalls || []);
  const verifiedSuccesses = valid.filter((entry) => entry.status === 'completed' && entry.verification?.passed);
  const escalationEligible = valid.filter((entry) => entry.escalation?.required);
  const failures = valid.filter((entry) => entry.status === 'failed');
  const latencies = valid.map((entry) => Number(entry.efficiency?.latencyMs)).filter(Number.isFinite);
  const totalCostUsd = valid.reduce((sum, entry) => sum + nonNegativeNumber(entry.efficiency?.costUsd), 0);
  const businessOutcomes = aggregateBusinessOutcomes(valid);
  const nonWorking = valid.filter((entry) => !entry.working || entry.status === 'failed');
  let processFailureCount = 0;
  let contentFailureCount = 0;
  for (const entry of nonWorking) {
    const classification = classifyFailureType(entry);
    if (classification.type === 'process') processFailureCount += 1;
    else if (classification.type === 'content') contentFailureCount += 1;
  }
  const totalFailures = nonWorking.length;
  const processFailureRate = rate(processFailureCount, totalFailures);
  const contentFailureRate = rate(contentFailureCount, totalFailures);

  let recommendedIntervention = 'none';
  const harnessCeiling = totalFailures >= 3 && (processFailureRate || 0) <= 0.2 && (contentFailureRate || 0) >= 0.8;
  if (totalFailures > 0) {
    if (harnessCeiling) {
      recommendedIntervention = 'weight_training_or_model_escalation';
    } else if ((processFailureRate || 0) >= 0.2) {
      recommendedIntervention = 'harness_evolution';
    } else {
      recommendedIntervention = 'mixed_investigation';
    }
  }

  const failureComposition = {
    totalFailures,
    processFailures: processFailureCount,
    contentFailures: contentFailureCount,
    processFailureRate,
    contentFailureRate,
    harnessCeiling,
    recommendedIntervention,
  };
  return {
    generatedAt: new Date().toISOString(),
    sampleSize: valid.length,
    evidenceStatus: valid.length > 0 ? 'measured' : 'insufficient_evidence',
    task: {
      workingRate: rate(valid.filter((entry) => entry.working).length, valid.length),
      verifiedCompletionRate: rate(verifiedSuccesses.length, valid.length),
      evidenceBackedCompletionRate: rate(
        verifiedSuccesses.filter((entry) => entry.verification?.evidence?.length > 0).length,
        valid.length,
      ),
      unsupportedClaimRate: rate(
        valid.filter((entry) => Number(entry.verification?.unsupportedClaims || 0) > 0).length,
        valid.length,
      ),
      firstAttemptSuccessRate: rate(
        verifiedSuccesses.filter((entry) => entry.efficiency?.firstAttempt).length,
        valid.length,
      ),
      repeatedFailureRate: rate(
        failures.filter((entry) => entry.failure?.repeated).length,
        failures.length,
      ),
      recoveryRate: rate(
        failures.filter((entry) => entry.failure?.recovered).length,
        failures.length,
      ),
      rollbackRate: rate(
        failures.filter((entry) => entry.failure?.rolledBack).length,
        failures.length,
      ),
    },
    tools: {
      calls: toolCalls.length,
      contractAccuracy: rate(toolCalls.filter((call) => call.contractValid).length, toolCalls.length),
      executionSuccessRate: rate(toolCalls.filter((call) => call.succeeded).length, toolCalls.length),
      duplicateSideEffectRate: rate(toolCalls.filter((call) => call.duplicateSideEffect).length, toolCalls.length),
      retryRate: rate(toolCalls.filter((call) => call.attempts > 1).length, toolCalls.length),
    },
    safety: {
      unsafeEscapeRate: rate(valid.filter((entry) => Number(entry.policy?.unsafeEscapes || 0) > 0).length, valid.length),
      policyViolationRate: rate(valid.filter((entry) => Number(entry.policy?.violations || 0) > 0).length, valid.length),
      safeFalseBlockRate: rate(valid.filter((entry) => Number(entry.policy?.falseBlocks || 0) > 0).length, valid.length),
    },
    escalation: {
      eligible: escalationEligible.length,
      correctEscalationRate: rate(
        escalationEligible.filter((entry) => entry.escalation?.correct).length,
        escalationEligible.length,
      ),
    },
    efficiency: {
      latencyP50Ms: percentile(latencies, 0.5),
      latencyP95Ms: percentile(latencies, 0.95),
      totalCostUsd: roundMoney(totalCostUsd),
      costPerVerifiedSuccessUsd: verifiedSuccesses.length
        ? roundMoney(totalCostUsd / verifiedSuccesses.length)
        : null,
    },
    businessOutcomes,
    failureComposition,
  };
}

/**
 * arXiv:2610.11655 First-Signal-Fires Failure Classifier:
 * Separates process failures (repaired by harness evolution) from
 * content failures (repaired by weight training or model escalation).
 */
function classifyFailureType(outcome = {}) { // NOSONAR
  if (outcome.working && outcome.status === 'completed' && outcome.verification?.passed) {
    return { type: 'none', firstSignal: null };
  }

  const explicitType = String(outcome.failure?.type || '').toLowerCase();
  if (explicitType === 'process' || explicitType === 'content') {
    return { type: explicitType, firstSignal: outcome.failure?.firstSignal || `explicit_${explicitType}` };
  }

  const explicitCategory = String(outcome.failure?.category || '').toLowerCase();
  if (['process', 'contract', 'runtime', 'timeout', 'tool', 'policy', 'syntax'].includes(explicitCategory)) {
    return { type: 'process', firstSignal: `category_${explicitCategory}` };
  }
  if (['content', 'reasoning', 'planning', 'logic', 'domain', 'quality'].includes(explicitCategory)) {
    return { type: 'content', firstSignal: `category_${explicitCategory}` };
  }

  const reasons = Array.isArray(outcome.workingReasons) ? outcome.workingReasons : [];
  const toolCalls = Array.isArray(outcome.toolCalls) ? outcome.toolCalls : [];

  // Check process failure signals first (first signal that fires)
  for (const call of toolCalls) {
    if (!call.contractValid) return { type: 'process', firstSignal: `tool_contract_invalid:${call.name}` };
    if (!call.allowed) return { type: 'process', firstSignal: `tool_policy_denied:${call.name}` };
    if (!call.succeeded) return { type: 'process', firstSignal: `tool_call_failed:${call.name}` };
    if (call.duplicateSideEffect) return { type: 'process', firstSignal: `duplicate_side_effect:${call.name}` };
  }

  if (Number(outcome.policy?.violations || 0) > 0) return { type: 'process', firstSignal: 'policy_violation' };
  if (Number(outcome.policy?.unsafeEscapes || 0) > 0) return { type: 'process', firstSignal: 'unsafe_escape' };
  if (Number(outcome.policy?.falseBlocks || 0) > 0) return { type: 'process', firstSignal: 'safe_false_block' };

  const statusReason = reasons.find((r) => [
    'status_failed',
    'status_cancelled',
    'status_aborted',
    'status_timeout',
  ].includes(r));
  if (statusReason) return { type: 'process', firstSignal: statusReason };

  if (outcome.verification?.performed === true && (outcome.verification?.passed === false || Number(outcome.verification?.unsupportedClaims || 0) > 0)) {
    const signal = outcome.verification.passed === false ? 'verification_failed' : 'unsupported_claim';
    return { type: 'content', firstSignal: signal };
  }

  const processReason = reasons.find((r) => [
    'tool_contract_invalid',
    'tool_policy_denied',
    'tool_call_failed',
    'duplicate_side_effect',
    'policy_violation',
    'unsafe_escape',
    'safe_false_block',
    'status_failed',
    'status_cancelled',
    'status_aborted',
    'status_timeout',
    'verification_not_performed',
  ].includes(r));
  if (processReason) return { type: 'process', firstSignal: processReason };

  const contentReason = reasons.find((r) => [
    'verification_failed',
    'unsupported_claim',
    'evidence_missing',
    'incorrect_escalation',
  ].includes(r));
  if (contentReason) return { type: 'content', firstSignal: contentReason };

  return { type: 'process', firstSignal: reasons[0] || 'unspecified_failure' };
}

function recordOutcomeTrace(receipt, options) {
  if (options.recordTrace === false) return;
  try {
    const { recordReasoningTrace } = require('./agent-reasoning-traces');
    const messages = [
      { role: 'user', content: `intent: ${receipt.goal}` },
      ...receipt.toolCalls.map((call) => ({
        role: 'assistant',
        content: `tool: ${call.name}`,
        tool_calls: [{ function: { name: call.name, arguments: {} } }],
      })),
      {
        role: 'tool',
        content: `tool response: ${receipt.toolCalls.every((call) => call.succeeded) ? 'success' : 'failure'}`,
      },
      {
        role: 'assistant',
        content: receipt.verification.evidence.length
          ? `verification evidence: ${receipt.verification.evidence.join('; ')}`
          : 'verification missing',
      },
    ];
    recordReasoningTrace({
      trace_id: receipt.traceId || receipt.taskId,
      task_type: receipt.taskType,
      messages,
      success: receipt.working,
      outcome: {
        success: receipt.working,
        terminalState: receipt.status,
      },
      source: 'task-outcome-receipt',
    }, options);
  } catch {
    // Outcome recording is authoritative; best-effort trace analytics cannot
    // make a verified receipt disappear.
  }
}

function normalizeToolCall(call = {}) {
  const sideEffect = call.sideEffect === true;
  return {
    name: cleanString(call.name),
    contractValid: call.contractValid === true,
    allowed: call.allowed === true,
    succeeded: call.succeeded === true,
    attempts: Math.max(1, nonNegativeInteger(call.attempts || 1)),
    latencyMs: nonNegativeNumber(call.latencyMs),
    costUsd: nonNegativeNumber(call.costUsd),
    sideEffect,
    idempotencyKey: optionalString(call.idempotencyKey),
    duplicateSideEffect: call.duplicateSideEffect === true,
  };
}

function normalizeFailure(value) {
  if (!value) return undefined;
  return {
    category: optionalString(value.category),
    type: optionalString(value.type),
    firstSignal: optionalString(value.firstSignal),
    recovered: value.recovered === true,
    repeated: value.repeated === true,
    rolledBack: value.rolledBack === true,
  };
}

function normalizeEscalation(value) {
  if (!value) return undefined;
  return {
    required: value.required === true,
    correct: value.correct === true,
    escalationId: optionalString(value.escalationId),
  };
}

function normalizeBusinessOutcome(value) {
  if (!value) return undefined;
  return {
    kpi: cleanString(value.kpi),
    value: Number(value.value),
    unit: cleanString(value.unit),
  };
}

function normalizeVersions(value) {
  if (!value) return undefined;
  return {
    model: optionalString(value.model),
    prompt: optionalString(value.prompt),
    tools: optionalString(value.tools),
    policy: optionalString(value.policy),
    release: optionalString(value.release),
  };
}

function aggregateBusinessOutcomes(outcomes) {
  const groups = new Map();
  for (const outcome of outcomes) {
    const item = outcome.businessOutcome;
    if (!item) continue;
    const key = `${item.kpi}\0${item.unit}`;
    const current = groups.get(key) || { kpi: item.kpi, unit: item.unit, value: 0, tasks: 0 };
    current.value += Number(item.value || 0);
    current.tasks += 1;
    groups.set(key, current);
  }
  return Array.from(groups.values()).map((entry) => ({ ...entry, value: roundMetric(entry.value) }));
}

function hashReceipt(receipt, options = {}) {
  const copy = { ...receipt };
  delete copy.receiptHash;
  delete copy.recordedAt;
  if (copy.failure) {
    const failureCopy = { ...copy.failure };
    if (options.excludeType ?? false) {
      delete failureCopy.type;
    }
    if (options.excludeSignal ?? false) {
      delete failureCopy.firstSignal;
    }
    if (Object.keys(failureCopy).length === 0) {
      delete copy.failure;
    } else {
      copy.failure = failureCopy;
    }
  }
  return crypto.createHash('sha256').update(stableStringify(copy)).digest('hex');
}

function stableStringify(value) {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const properties = keys.map((key) => [
    JSON.stringify(key),
    stableStringify(value[key]),
  ].join(':'));
  return ['{', properties.join(','), '}'].join('');
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(quantile * sorted.length) - 1;
  return roundMetric(sorted[Math.max(0, index)]);
}

function rate(numerator, denominator) {
  return denominator > 0 ? roundMetric(numerator / denominator) : null;
}

function cleanString(value) {
  return String(value ?? '').trim();
}

function optionalString(value) {
  const result = cleanString(value);
  return result || undefined;
}

function cleanStringArray(value) {
  return Array.isArray(value) ? value.map(cleanString).filter(Boolean) : [];
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function nonNegativeInteger(value) {
  return Math.floor(nonNegativeNumber(value));
}

function roundMetric(value) {
  return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null;
}

function roundMoney(value) {
  return Number.isFinite(value) ? Math.round(value * 1000000) / 1000000 : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function removeUndefined(value) {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
    else removeUndefined(value[key]);
  }
}

function isCliInvocation() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;
}

if (isCliInvocation()) {
  const command = process.argv[2] || 'metrics';
  if (command === 'metrics') {
    console.log(JSON.stringify(calculateTaskOutcomeMetrics(readTaskOutcomes()), null, 2));
  } else {
    console.error('Usage: task-outcomes.js metrics');
    process.exitCode = 1;
  }
}

module.exports = {
  TASK_OUTCOME_SCHEMA,
  calculateTaskOutcomeMetrics,
  classifyFailureType,
  evaluateWorkingVerdict,
  getTaskOutcome,
  getTaskOutcomesPath,
  normalizeTaskOutcome,
  readTaskOutcomes,
  recordTaskOutcome,
};
