#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  loadSubagentProfiles,
  getAllowedTools,
} = require('./mcp-policy');
const {
  loadModel,
  saveModel,
  updateModel,
  getReliability,
} = require('./thompson-sampling');

const DELEGATION_MODES = ['off', 'auto', 'sequential'];
const HANDOFF_OUTCOMES = ['accepted', 'rejected', 'aborted'];
const RECENT_FAILURE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const PROMOTABLE_REASON_CODES = new Set([
  'single_phase_task',
  'missing_required_evidence',
  'unresolved_handoff_exists',
]);

function getFeedbackLoopModule() {
  return require('./feedback-loop');
}

function getVerificationLoopModule() {
  return require('./verification-loop');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function appendJSONL(filePath, record) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

function createDelegationError(message, statusCode, details = null) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (details) {
    err.details = details;
  }
  return err;
}

function normalizeDelegationMode(mode) {
  if (mode === undefined || mode === null || mode === '') {
    return 'off';
  }
  const value = String(mode).trim().toLowerCase();
  if (!DELEGATION_MODES.includes(value)) {
    throw new Error(`Unsupported delegationMode '${mode}'`);
  }
  return value;
}

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim().replace(/\s+/g, ' ');
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getDelegationPaths() {
  const { FEEDBACK_DIR } = getFeedbackLoopModule().getFeedbackPaths();
  return {
    FEEDBACK_DIR,
    DELEGATION_LOG_PATH: path.join(FEEDBACK_DIR, 'delegation-log.jsonl'),
    DELEGATION_MODEL_PATH: path.join(FEEDBACK_DIR, 'delegation-model.json'),
  };
}

function readDelegationEvents(filePath) {
  const { DELEGATION_LOG_PATH } = getDelegationPaths();
  return readJSONL(filePath || DELEGATION_LOG_PATH);
}

function getSemanticKind(action = {}) {
  const name = String(action.name || '').trim();
  if ([
    'construct_context_pack',
    'context_provenance',
    'feedback_summary',
    'recall',
    'commerce_recall',
    'diagnose_failure',
  ].includes(name)) {
    return 'evidence';
  }
  if ([
    'evaluate_context_pack',
    'feedback_stats',
    'gate_stats',
    'dashboard',
  ].includes(name)) {
    return 'verification';
  }
  if ([
    'capture_feedback',
    'prevention_rules',
    'export_dpo_pairs',
    'export_databricks_bundle',
    'generate_skill',
    'satisfy_gate',
  ].includes(name)) {
    return 'mutation';
  }
  return 'general';
}

function deriveSemanticPhases(actions = []) {
  if (!Array.isArray(actions) || actions.length === 0) return [];
  const phases = [];
  let current = {
    kind: getSemanticKind(actions[0]),
    actions: [actions[0]],
  };

  for (const action of actions.slice(1)) {
    const kind = getSemanticKind(action);
    if (kind === current.kind) {
      current.actions.push(action);
      continue;
    }
    phases.push(current);
    current = { kind, actions: [action] };
  }
  phases.push(current);

  return phases.map((phase, index) => ({
    phaseIndex: index,
    kind: phase.kind,
    parallel: phase.actions.length > 1,
    actions: phase.actions,
  }));
}

function buildTaskKey({ intentId, repoPath, context }) {
  const hash = crypto.createHash('sha1');
  hash.update(String(intentId || '').trim());
  hash.update('\n');
  hash.update(String(repoPath || '').trim());
  hash.update('\n');
  hash.update(normalizeText(context));
  return hash.digest('hex');
}

function deriveActiveHandoffs(events = []) {
  const activeByTaskKey = new Map();
  const activeByHandoffId = new Map();

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    if (event.eventType === 'started') {
      activeByTaskKey.set(event.taskKey, event);
      activeByHandoffId.set(event.handoffId, event);
      continue;
    }
    if (event.eventType === 'completed') {
      activeByHandoffId.delete(event.handoffId);
      const active = activeByTaskKey.get(event.taskKey);
      if (active && active.handoffId === event.handoffId) {
        activeByTaskKey.delete(event.taskKey);
      }
    }
  }

  return {
    byTaskKey: activeByTaskKey,
    byHandoffId: activeByHandoffId,
  };
}

function buildContextDigest(plan = {}, context) {
  return JSON.stringify({
    context: normalizeText(context || plan.context || ''),
    actions: Array.isArray(plan.actions) ? plan.actions.map((action) => action.name) : [],
    checks: plan.partnerStrategy && Array.isArray(plan.partnerStrategy.recommendedChecks)
      ? plan.partnerStrategy.recommendedChecks
      : [],
  });
}

function getProfileCandidates(mcpProfile, hasMutation) {
  if (mcpProfile === 'readonly') {
    return hasMutation ? ['secure_runtime', 'review_workflow'] : ['review_workflow', 'secure_runtime'];
  }
  if (mcpProfile === 'locked') {
    return ['secure_runtime'];
  }
  return hasMutation
    ? ['pr_workflow', 'review_workflow', 'secure_runtime']
    : ['review_workflow', 'pr_workflow', 'secure_runtime'];
}

function selectDelegateProfile({ mcpProfile, plan, contextChars }) {
  const config = loadSubagentProfiles();
  const semanticPhases = deriveSemanticPhases(plan.actions);
  const hasMutation = semanticPhases.some((phase) => phase.kind === 'mutation');
  const candidates = getProfileCandidates(mcpProfile, hasMutation);
  let fallback = null;

  for (const profileName of candidates) {
    const profileConfig = config.profiles[profileName];
    if (!profileConfig || !profileConfig.mcpProfile) continue;
    const allowedTools = new Set(getAllowedTools(profileConfig.mcpProfile));
    const actionsFit = Array.isArray(plan.actions)
      ? plan.actions.every((action) => allowedTools.has(action.name))
      : false;
    const maxChars = Number(profileConfig.context && profileConfig.context.maxChars) || 0;
    const contextFits = maxChars > 0 ? contextChars <= maxChars : false;
    if (!actionsFit) continue;
    const candidate = {
      delegateProfile: profileName,
      profileConfig,
      actionsFit,
      contextFits,
      maxChars,
    };
    if (contextFits) {
      return candidate;
    }
    if (!fallback) {
      fallback = candidate;
    }
  }

  return fallback || {
    delegateProfile: null,
    profileConfig: null,
    actionsFit: false,
    contextFits: false,
    maxChars: 0,
  };
}

function loadDelegationModel(modelPath) {
  return loadModel(modelPath);
}

function getReliabilityBias(model, categories = []) {
  const reliability = getReliability(model);
  const relevant = categories
    .map((category) => reliability[category])
    .filter(Boolean);

  if (relevant.length === 0) {
    return 0;
  }

  const average = relevant.reduce((sum, entry) => sum + entry.reliability, 0) / relevant.length;
  return Math.max(-0.25, Math.min(0.25, (average - 0.5) * 0.5));
}

function hasRecentSimilarFailure(events = [], intentId, delegateProfile) {
  const cutoff = Date.now() - RECENT_FAILURE_WINDOW_MS;
  return events.some((event) => {
    if (!event || typeof event !== 'object') return false;
    const timestamp = event.timestamp ? new Date(event.timestamp).getTime() : 0;
    if (timestamp < cutoff) return false;
    if (event.intentId !== intentId) return false;
    if (delegateProfile && event.delegateProfile && event.delegateProfile !== delegateProfile) return false;

    if (event.eventType === 'rejected_start') {
      return true;
    }

    if (event.eventType !== 'completed') {
      return false;
    }

    return event.outcome !== 'accepted' || event.verificationAccepted === false;
  });
}

function buildHandoffContract({ plan, delegateProfile, plannedChecks = [] }) {
  const profiles = loadSubagentProfiles();
  const profileConfig = profiles.profiles[delegateProfile];
  const requiredChecks = unique([
    ...(Array.isArray(plannedChecks) ? plannedChecks : []),
    ...(plan.partnerStrategy && Array.isArray(plan.partnerStrategy.recommendedChecks)
      ? plan.partnerStrategy.recommendedChecks
      : []),
  ]);

  return {
    objective: plan.context
      ? `${plan.intent.description}: ${plan.context}`
      : plan.intent.description,
    scopeIn: Array.isArray(plan.actions) ? plan.actions.map((action) => action.name) : [],
    scopeOut: [
      'parallel fan-out',
      'nested handoffs',
      'unapproved scope expansion',
    ],
    requiredEvidence: ['summary', 'result_context'],
    requiredChecks,
    contextBudget: profileConfig && profileConfig.context
      ? {
        maxItems: profileConfig.context.maxItems,
        maxChars: profileConfig.context.maxChars,
      }
      : null,
    completionDefinition: 'Return a concise summary, include result context, and report attempts, violations, and executed checks.',
  };
}

function evaluateDelegation(params = {}) {
  const delegationMode = normalizeDelegationMode(params.delegationMode);
  const plan = params.plan || {};
  const mcpProfile = String(params.mcpProfile || plan.mcpProfile || 'default').trim();
  const context = String(params.context || plan.context || '');
  const repoPath = params.repoPath || null;
  const taskKey = buildTaskKey({
    intentId: plan.intent && plan.intent.id,
    repoPath,
    context,
  });
  const semanticPhases = deriveSemanticPhases(plan.actions);
  const hasEvidence = semanticPhases.some((phase) => phase.kind === 'evidence');
  const hasMutation = semanticPhases.some((phase) => phase.kind === 'mutation');
  const contextDigest = buildContextDigest(plan, context);
  const contextChars = contextDigest.length;
  const selection = selectDelegateProfile({ mcpProfile, plan, contextChars });
  const { DELEGATION_MODEL_PATH } = getDelegationPaths();
  const model = loadDelegationModel(DELEGATION_MODEL_PATH);
  const events = readDelegationEvents();
  const activeHandoffs = deriveActiveHandoffs(events);
  const activeHandoff = activeHandoffs.byTaskKey.get(taskKey) || null;
  const reliabilityBias = selection.delegateProfile
    ? getReliabilityBias(model, [
      'delegation_global',
      `intent_${plan.intent && plan.intent.id}`,
      `profile_${selection.delegateProfile}`,
    ])
    : 0;
  const recentFailure = selection.delegateProfile
    ? hasRecentSimilarFailure(events, plan.intent && plan.intent.id, selection.delegateProfile)
    : false;

  let score = 0;
  if (semanticPhases.length >= 2) score += 0.25;
  else score -= 0.30;

  if (hasEvidence && hasMutation) score += 0.15;
  if (selection.delegateProfile) score += 0.15;
  if (plan.codegraphImpact && plan.codegraphImpact.enabled && Array.isArray(plan.codegraphImpact.verificationHints) && plan.codegraphImpact.verificationHints.length > 0) {
    score += 0.10;
  }
  if (selection.contextFits) score += 0.10;
  else if (selection.delegateProfile) score -= 0.20;
  score += reliabilityBias;
  if (recentFailure) score -= 0.25;

  score = Number(Math.max(0, Math.min(1, score)).toFixed(3));

  let reasonCode = 'delegation_disabled';
  let delegationReason = 'Delegation is disabled for this plan.';
  let delegationEligible = false;
  let executionMode = 'single_agent';
  let delegateProfile = null;
  let handoffContract = null;

  if (delegationMode !== 'off') {
    if (plan.status !== 'ready') {
      reasonCode = 'checkpoint_required';
      delegationReason = 'Delegation is blocked until the required approval checkpoint is cleared.';
    } else if (mcpProfile === 'locked') {
      reasonCode = 'locked_profile';
      delegationReason = 'Locked MCP profile may inspect the plan but cannot start a handoff.';
    } else if (semanticPhases.length < 2) {
      reasonCode = 'single_phase_task';
      delegationReason = 'Delegation was skipped because the task collapses into a single semantic phase.';
    } else if ((plan.actions || []).length < 3) {
      reasonCode = 'insufficient_actions';
      delegationReason = 'Delegation was skipped because the task does not have enough action surface to justify a handoff.';
    } else if (!selection.delegateProfile) {
      reasonCode = 'no_compatible_delegate';
      delegationReason = 'Delegation was skipped because no existing delegate profile can execute the required actions within policy.';
    } else if (!selection.contextFits) {
      reasonCode = 'budget_exceeded';
      delegationReason = 'Delegation was skipped because the context exceeds the selected delegate profile budget.';
    } else if (activeHandoff) {
      reasonCode = 'unresolved_handoff_exists';
      delegationReason = 'Delegation is blocked because an unresolved handoff already exists for this task.';
    } else if (recentFailure) {
      reasonCode = 'recent_failure';
      delegationReason = 'Delegation confidence was reduced by a recent similar failure, so the planner kept the task single-agent.';
    } else if (score < 0.6) {
      reasonCode = 'low_score';
      delegationReason = 'Delegation was considered but the reliability score did not clear the handoff threshold.';
    } else {
      reasonCode = 'delegation_selected';
      delegationReason = 'Delegation cleared the structural, budget, and reliability checks.';
      delegationEligible = true;
      executionMode = 'sequential_delegate';
      delegateProfile = selection.delegateProfile;
      handoffContract = buildHandoffContract({
        plan,
        delegateProfile,
        plannedChecks: params.plannedChecks,
      });
    }
  }

  return {
    delegationMode,
    executionMode,
    delegationEligible,
    delegationScore: executionMode === 'sequential_delegate' ? score : 0,
    delegationReason,
    delegateProfile,
    handoffContract,
    reasonCode,
    rawDelegationScore: score,
    taskKey,
    activeHandoffId: activeHandoff ? activeHandoff.handoffId : null,
    semanticPhases,
    contextChars,
  };
}

function buildRejectedStartEvent(params = {}) {
  return {
    eventType: 'rejected_start',
    handoffId: null,
    taskKey: params.taskKey,
    intentId: params.intentId,
    delegateProfile: params.delegateProfile || null,
    mcpProfile: params.mcpProfile,
    partnerProfile: params.partnerProfile || null,
    reasonCode: params.reasonCode,
    reason: params.reason,
    context: normalizeText(params.context),
    repoPath: params.repoPath || null,
    timestamp: new Date().toISOString(),
  };
}

function buildDelegationFeedback(reasonCode, params = {}) {
  if (reasonCode === 'single_phase_task') {
    return {
      context: `Delegation was attempted for single-phase intent '${params.intentId}'.`,
      whatWentWrong: 'The task did not justify a handoff.',
      whatToChange: 'Keep single-phase work single-agent unless a second semantic phase appears.',
    };
  }
  if (reasonCode === 'missing_required_evidence') {
    return {
      context: `Delegation completed without required evidence for intent '${params.intentId}'.`,
      whatWentWrong: 'The handoff returned without a usable summary or result context.',
      whatToChange: 'Require summary and result context before accepting delegated work.',
    };
  }
  if (reasonCode === 'unresolved_handoff_exists') {
    return {
      context: `Delegation was re-attempted while a handoff was still unresolved for intent '${params.intentId}'.`,
      whatWentWrong: 'A second handoff started before the first one completed.',
      whatToChange: 'Finish or abort the active handoff before starting another one on the same task.',
    };
  }
  return null;
}

function promoteDelegationFailure(reasonCode, params = {}) {
  if (!PROMOTABLE_REASON_CODES.has(reasonCode)) {
    return null;
  }
  const payload = buildDelegationFeedback(reasonCode, params);
  if (!payload) {
    return null;
  }
  const { captureFeedback } = getFeedbackLoopModule();
  return captureFeedback({
    signal: 'down',
    context: payload.context,
    whatWentWrong: payload.whatWentWrong,
    whatToChange: payload.whatToChange,
    tags: unique([
      'delegation',
      reasonCode,
      params.intentId ? `intent:${params.intentId}` : null,
      params.delegateProfile ? `delegate:${params.delegateProfile}` : null,
    ]),
    skill: 'delegation_runtime',
  });
}

function persistRejectedStart(params = {}) {
  const { DELEGATION_LOG_PATH } = getDelegationPaths();
  const event = buildRejectedStartEvent(params);
  appendJSONL(DELEGATION_LOG_PATH, event);
  promoteDelegationFailure(params.reasonCode, params);
  return event;
}

function startHandoff(params = {}) {
  const evaluation = evaluateDelegation({
    delegationMode: 'sequential',
    plan: params.plan,
    mcpProfile: params.mcpProfile,
    context: params.context,
    repoPath: params.repoPath,
    plannedChecks: params.plannedChecks,
  });

  if (String(params.mcpProfile || '').trim() === 'locked') {
    persistRejectedStart({
      taskKey: evaluation.taskKey,
      intentId: params.plan && params.plan.intent ? params.plan.intent.id : null,
      delegateProfile: null,
      mcpProfile: params.mcpProfile,
      partnerProfile: params.partnerProfile,
      reasonCode: 'locked_profile',
      reason: 'Locked MCP profile may not start handoffs.',
      context: params.context,
      repoPath: params.repoPath,
    });
    throw createDelegationError('Locked MCP profile may not start handoffs.', 403);
  }

  if (!evaluation.delegationEligible || evaluation.executionMode !== 'sequential_delegate') {
    persistRejectedStart({
      taskKey: evaluation.taskKey,
      intentId: params.plan && params.plan.intent ? params.plan.intent.id : null,
      delegateProfile: evaluation.delegateProfile,
      mcpProfile: params.mcpProfile,
      partnerProfile: params.partnerProfile,
      reasonCode: evaluation.reasonCode,
      reason: evaluation.delegationReason,
      context: params.context,
      repoPath: params.repoPath,
    });
    throw createDelegationError(evaluation.delegationReason, evaluation.reasonCode === 'unresolved_handoff_exists' ? 409 : 422, {
      reasonCode: evaluation.reasonCode,
    });
  }

  if (params.delegateProfile && params.delegateProfile !== evaluation.delegateProfile) {
    persistRejectedStart({
      taskKey: evaluation.taskKey,
      intentId: params.plan && params.plan.intent ? params.plan.intent.id : null,
      delegateProfile: params.delegateProfile,
      mcpProfile: params.mcpProfile,
      partnerProfile: params.partnerProfile,
      reasonCode: 'delegate_profile_mismatch',
      reason: 'Requested delegateProfile does not match the planner-selected profile.',
      context: params.context,
      repoPath: params.repoPath,
    });
    throw createDelegationError('Requested delegateProfile does not match the planner-selected profile.', 400);
  }

  const { DELEGATION_LOG_PATH } = getDelegationPaths();
  const handoffId = `handoff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const event = {
    eventType: 'started',
    handoffId,
    taskKey: evaluation.taskKey,
    intentId: params.plan.intent.id,
    delegateProfile: evaluation.delegateProfile,
    mcpProfile: params.mcpProfile,
    partnerProfile: params.partnerProfile || null,
    context: normalizeText(params.context || params.plan.context || ''),
    repoPath: params.repoPath || null,
    plannedChecks: unique([
      ...(Array.isArray(params.plannedChecks) ? params.plannedChecks : []),
      ...(evaluation.handoffContract && Array.isArray(evaluation.handoffContract.requiredChecks)
        ? evaluation.handoffContract.requiredChecks
        : []),
    ]),
    contract: evaluation.handoffContract,
    delegationScore: evaluation.delegationScore,
    timestamp: new Date().toISOString(),
  };

  appendJSONL(DELEGATION_LOG_PATH, event);

  return {
    handoffId,
    taskKey: event.taskKey,
    status: 'started',
    executionMode: 'sequential_delegate',
    delegateProfile: event.delegateProfile,
    handoffContract: event.contract,
  };
}

function buildDelegationDiagnosis(activeHandoff, params = {}) {
  if (params.reasonCode === 'missing_required_evidence') {
    return {
      rootCauseCategory: 'delegation_evidence_gap',
      criticalFailureStep: 'handoff_completion',
      violations: [{
        constraintId: 'delegation:missing_required_evidence',
        message: 'Delegated work was completed without required evidence.',
      }],
      evidence: [],
    };
  }

  if (params.outcome === 'aborted') {
    return {
      rootCauseCategory: 'delegation_aborted',
      criticalFailureStep: 'handoff_completion',
      violations: [{
        constraintId: 'delegation:aborted',
        message: 'Delegated work was aborted before completion.',
      }],
      evidence: [],
    };
  }

  if (params.outcome === 'rejected') {
    return {
      rootCauseCategory: 'delegation_rejected',
      criticalFailureStep: 'handoff_completion',
      violations: [{
        constraintId: 'delegation:rejected',
        message: 'Delegated work was rejected after review.',
      }],
      evidence: [],
    };
  }

  if (params.verification && params.verification.accepted === false && params.verification.finalVerification && params.verification.finalVerification.diagnosis) {
    return params.verification.finalVerification.diagnosis;
  }

  return {
    rootCauseCategory: 'delegation_failure',
    criticalFailureStep: 'handoff_completion',
    violations: [{
      constraintId: 'delegation:failed',
      message: 'Delegated work failed to complete cleanly.',
    }],
    evidence: [],
  };
}

function updateDelegationModel(params = {}) {
  const { DELEGATION_MODEL_PATH } = getDelegationPaths();
  const model = loadDelegationModel(DELEGATION_MODEL_PATH);
  updateModel(model, {
    signal: params.signal,
    timestamp: params.timestamp || new Date().toISOString(),
    categories: unique([
      'delegation_global',
      params.intentId ? `intent_${params.intentId}` : null,
      params.delegateProfile ? `profile_${params.delegateProfile}` : null,
      params.partnerProfile ? `partner_${params.partnerProfile}` : null,
    ]),
  });
  saveModel(model, DELEGATION_MODEL_PATH);
  return getReliability(model);
}

function completeHandoff(params = {}) {
  const outcome = String(params.outcome || '').trim().toLowerCase();
  if (!HANDOFF_OUTCOMES.includes(outcome)) {
    throw createDelegationError(`Unsupported handoff outcome '${params.outcome}'`, 400);
  }

  const events = readDelegationEvents();
  const active = deriveActiveHandoffs(events).byHandoffId.get(params.handoffId);
  if (!active) {
    throw createDelegationError(`No active handoff found for '${params.handoffId}'`, 404);
  }

  const summary = normalizeText(params.summary);
  const resultContext = normalizeText(params.resultContext);
  const missingRequiredEvidence = outcome !== 'aborted' && !summary && !resultContext;
  let verification = null;

  if (outcome !== 'aborted' && resultContext) {
    verification = getVerificationLoopModule().runVerificationLoop({
      context: resultContext,
      tags: unique([
        'delegation',
        active.intentId ? `intent:${active.intentId}` : null,
        active.delegateProfile ? `delegate:${active.delegateProfile}` : null,
      ]),
      partnerProfile: active.partnerProfile || null,
      maxRetries: 0,
    });
  }

  const verificationAccepted = verification ? verification.accepted : null;
  const negativeOutcome = outcome !== 'accepted' || verificationAccepted === false || missingRequiredEvidence;
  const diagnosis = negativeOutcome
    ? buildDelegationDiagnosis(active, {
      outcome,
      reasonCode: missingRequiredEvidence ? 'missing_required_evidence' : null,
      verification,
    })
    : null;

  if (diagnosis && (!verification || !verification.persistedDiagnosis)) {
    getFeedbackLoopModule().appendDiagnosticRecord({
      source: 'delegation_runtime',
      step: diagnosis.criticalFailureStep || 'handoff_completion',
      context: resultContext || summary || active.context || '',
      diagnosis,
      metadata: {
        handoffId: active.handoffId,
        intentId: active.intentId,
        delegateProfile: active.delegateProfile,
        outcome,
      },
    });
  }

  if (missingRequiredEvidence) {
    promoteDelegationFailure('missing_required_evidence', {
      intentId: active.intentId,
      delegateProfile: active.delegateProfile,
    });
  }

  const { DELEGATION_LOG_PATH } = getDelegationPaths();
  const event = {
    eventType: 'completed',
    handoffId: active.handoffId,
    taskKey: active.taskKey,
    intentId: active.intentId,
    delegateProfile: active.delegateProfile,
    mcpProfile: active.mcpProfile,
    partnerProfile: active.partnerProfile,
    outcome,
    summary: summary || null,
    resultContext: resultContext || null,
    attempts: Number.isFinite(Number(params.attempts)) ? Number(params.attempts) : 1,
    violationCount: Number.isFinite(Number(params.violationCount)) ? Number(params.violationCount) : 0,
    tokenEstimate: Number.isFinite(Number(params.tokenEstimate)) ? Number(params.tokenEstimate) : null,
    latencyMs: Number.isFinite(Number(params.latencyMs)) ? Number(params.latencyMs) : null,
    verificationAccepted,
    verification: verification
      ? {
        accepted: verification.accepted,
        attempts: verification.attempts,
        maxRetries: verification.maxRetries,
        finalVerification: verification.finalVerification,
        persistedDiagnosis: verification.persistedDiagnosis,
      }
      : null,
    diagnosis,
    timestamp: new Date().toISOString(),
  };
  appendJSONL(DELEGATION_LOG_PATH, event);

  const reliability = updateDelegationModel({
    signal: negativeOutcome ? 'negative' : 'positive',
    intentId: active.intentId,
    delegateProfile: active.delegateProfile,
    partnerProfile: active.partnerProfile,
    timestamp: event.timestamp,
  });

  return {
    handoffId: active.handoffId,
    status: 'completed',
    outcome,
    verificationAccepted,
    diagnosis,
    reliability,
  };
}

function summarizeDelegation(feedbackDir = null) {
  const paths = feedbackDir
    ? {
      DELEGATION_LOG_PATH: path.join(feedbackDir, 'delegation-log.jsonl'),
      DELEGATION_MODEL_PATH: path.join(feedbackDir, 'delegation-model.json'),
    }
    : getDelegationPaths();
  const events = readDelegationEvents(paths.DELEGATION_LOG_PATH);
  const active = deriveActiveHandoffs(events);
  const completions = events.filter((event) => event.eventType === 'completed');
  const starts = events.filter((event) => event.eventType === 'started');
  const rejectedStarts = events.filter((event) => event.eventType === 'rejected_start');
  const verificationSamples = completions.filter((event) => typeof event.verificationAccepted === 'boolean');
  const verificationFailures = verificationSamples.filter((event) => event.verificationAccepted === false);
  const completedAttempts = completions
    .map((event) => event.attempts)
    .filter((value) => Number.isFinite(value));
  const tokenEstimates = completions
    .map((event) => event.tokenEstimate)
    .filter((value) => Number.isFinite(value));
  const failingProfiles = {};
  const failingIntents = {};

  for (const event of [...rejectedStarts, ...completions]) {
    const failed = event.eventType === 'rejected_start'
      || event.outcome === 'rejected'
      || event.outcome === 'aborted'
      || event.verificationAccepted === false;
    if (!failed) continue;
    if (event.delegateProfile) {
      failingProfiles[event.delegateProfile] = (failingProfiles[event.delegateProfile] || 0) + 1;
    }
    if (event.intentId) {
      failingIntents[event.intentId] = (failingIntents[event.intentId] || 0) + 1;
    }
  }

  const model = loadDelegationModel(paths.DELEGATION_MODEL_PATH);
  const reliability = getReliability(model);

  return {
    attemptCount: starts.length,
    acceptedCount: completions.filter((event) => event.outcome === 'accepted').length,
    rejectedCount: completions.filter((event) => event.outcome === 'rejected').length,
    abortedCount: completions.filter((event) => event.outcome === 'aborted').length,
    activeCount: active.byHandoffId.size,
    avoidedDelegationCount: rejectedStarts.length,
    verificationFailureRate: verificationSamples.length > 0
      ? Number((verificationFailures.length / verificationSamples.length).toFixed(3))
      : 0,
    averageAttemptsPerTask: completedAttempts.length > 0
      ? Number((completedAttempts.reduce((sum, value) => sum + value, 0) / completedAttempts.length).toFixed(2))
      : 0,
    averageTokenEstimate: tokenEstimates.length > 0
      ? Number((tokenEstimates.reduce((sum, value) => sum + value, 0) / tokenEstimates.length).toFixed(2))
      : 0,
    topFailingProfiles: Object.entries(failingProfiles)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]) => ({ key, count })),
    topFailingIntents: Object.entries(failingIntents)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]) => ({ key, count })),
    reliability: {
      global: reliability.delegation_global || null,
    },
  };
}

module.exports = {
  DELEGATION_MODES,
  HANDOFF_OUTCOMES,
  normalizeDelegationMode,
  deriveSemanticPhases,
  buildTaskKey,
  getDelegationPaths,
  readDelegationEvents,
  deriveActiveHandoffs,
  evaluateDelegation,
  startHandoff,
  completeHandoff,
  summarizeDelegation,
};
