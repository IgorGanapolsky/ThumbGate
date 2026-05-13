#!/usr/bin/env node
'use strict';

/**
 * Workflow Gate Checkpoint — persist gate state across workflow restarts.
 *
 * Long-running agentic workflows (Open Agents, Temporal, etc.) need gates
 * that survive restarts. This module serializes gate evaluation state into
 * checkpoint format so enforcement survives workflow durability boundaries.
 *
 * Checkpoint format:
 *   {
 *     "checkpointId": "wfcp_...",
 *     "workflowId": "wf_...",
 *     "step": 3,
 *     "timestamp": "...",
 *     "sessionActions": ["npm test", "git add ."],
 *     "evaluationHistory": [...],
 *     "activeSpecs": ["agent-safety"],
 *     "gateState": { "blockedCount": 0, "nearMissCount": 1, ... }
 *   }
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { appendJsonl, ensureParentDir, readJsonl } = require('./fs-utils');
const { resolveFeedbackDir } = require('./feedback-paths');

const INTERACTION_EVENTS_FILE = 'interaction-events.jsonl';
const INTERACTION_EVENT_TYPES = new Set([
  'user_message',
  'assistant_message',
  'tool_intent',
  'tool_result',
  'pr_state',
  'ci_check',
  'publish_verification',
  'security_verification',
  'feedback',
  'observation',
]);
const TERMINAL_SUCCESS = new Set(['SUCCESS', 'success', 'pass', 'PASS']);
const TERMINAL_FAILURE = new Set(['FAILURE', 'failure', 'fail', 'FAIL', 'ERROR', 'error', 'CANCELLED', 'cancelled']);
const CLAIM_REQUIREMENTS = [
  {
    id: 'merged_claim_requires_merge_commit',
    pattern: /\b(merged|merge complete|landed on main)\b/i,
    claimKey: 'canClaimMerged',
    message: 'Do not claim merged until the source PR has mergedAt and mergeCommit evidence.',
  },
  {
    id: 'published_claim_requires_npm_latest',
    pattern: /\b(published|npm latest|released to npm)\b/i,
    claimKey: 'canClaimPublished',
    message: 'Do not claim published until npm latest/version verification is recorded.',
  },
  {
    id: 'security_clear_claim_requires_alert_counts',
    pattern: /\b(no (?:gh |github )?security issues|security (?:clear|clean)|alerts? (?:clear|zero|0))\b/i,
    claimKey: 'canClaimSecurityClear',
    message: 'Do not claim security is clear until code scanning, Dependabot, and secret scanning counts are verified at zero.',
  },
  {
    id: 'complete_claim_requires_all_verifications',
    pattern: /\b(done|complete|everything tested|all ci passed|all verified)\b/i,
    claimKey: 'canClaimComplete',
    message: 'Do not claim completion until merge, publish, and security verification evidence are all present.',
  },
];

// ---------------------------------------------------------------------------
// Checkpoint Create / Restore
// ---------------------------------------------------------------------------

/**
 * Create a checkpoint from current gate evaluation state.
 */
function createCheckpoint({
  workflowId,
  step = 0,
  phase = 'intent',
  status = 'running',
  sessionActions = [],
  evaluationHistory = [],
  activeSpecs = [],
  gateState = {},
  intent = null,
  plan = null,
  report = null,
  evidence = [],
  metadata = {},
} = {}) {
  return {
    checkpointId: `wfcp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    workflowId: workflowId || `wf_${crypto.randomBytes(6).toString('hex')}`,
    step,
    phase,
    status,
    timestamp: new Date().toISOString(),
    sessionActions: sessionActions.slice(-100), // keep last 100 actions
    evaluationHistory: evaluationHistory.slice(-50), // keep last 50 evaluations
    activeSpecs,
    intent: intent && typeof intent === 'object' ? { ...intent } : null,
    plan: plan && typeof plan === 'object' ? { ...plan } : null,
    report: report && typeof report === 'object' ? { ...report } : null,
    evidence: Array.isArray(evidence) ? evidence.filter(Boolean) : [],
    metadata: metadata && typeof metadata === 'object' ? { ...metadata } : {},
    gateState: {
      blockedCount: gateState.blockedCount || 0,
      nearMissCount: gateState.nearMissCount || 0,
      totalChecked: gateState.totalChecked || 0,
      safetyPosture: gateState.safetyPosture || 'unknown',
    },
  };
}

/**
 * Save checkpoint to a file.
 */
function saveCheckpoint(checkpoint, filePath) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf8');
  return filePath;
}

/**
 * Load checkpoint from a file.
 */
function loadCheckpoint(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return null;
  const raw = fs.readFileSync(resolved, 'utf8');
  return JSON.parse(raw);
}

/**
 * Advance a checkpoint to the next step with new state.
 */
function advanceCheckpoint(checkpoint, {
  newActions = [],
  newEvaluations = [],
  gateState = {},
  phase,
  status,
  intent,
  plan,
  report,
  evidence = [],
  metadata = {},
} = {}) {
  return createCheckpoint({
    workflowId: checkpoint.workflowId,
    step: checkpoint.step + 1,
    phase: phase || checkpoint.phase || 'intent',
    status: status || checkpoint.status || 'running',
    sessionActions: [...checkpoint.sessionActions, ...newActions],
    evaluationHistory: [...checkpoint.evaluationHistory, ...newEvaluations],
    activeSpecs: checkpoint.activeSpecs,
    intent: intent === undefined ? checkpoint.intent : intent,
    plan: plan === undefined ? checkpoint.plan : plan,
    report: report === undefined ? checkpoint.report : report,
    evidence: [...(checkpoint.evidence || []), ...((Array.isArray(evidence) ? evidence : []).filter(Boolean))],
    metadata: {
      ...(checkpoint.metadata && typeof checkpoint.metadata === 'object' ? checkpoint.metadata : {}),
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
    },
    gateState: {
      blockedCount: (checkpoint.gateState.blockedCount || 0) + (gateState.blockedCount || 0),
      nearMissCount: (checkpoint.gateState.nearMissCount || 0) + (gateState.nearMissCount || 0),
      totalChecked: (checkpoint.gateState.totalChecked || 0) + (gateState.totalChecked || 0),
      safetyPosture: gateState.safetyPosture || checkpoint.gateState.safetyPosture,
    },
  });
}

/**
 * Check if a checkpoint indicates the workflow should be halted.
 */
function shouldHaltWorkflow(checkpoint, { maxBlocked = 5, maxConsecutiveBlocks = 3 } = {}) {
  if (checkpoint.gateState.blockedCount >= maxBlocked) {
    return { halt: true, reason: `Total blocked actions (${checkpoint.gateState.blockedCount}) exceeded threshold (${maxBlocked})` };
  }

  // Check consecutive blocks in recent history
  const recent = checkpoint.evaluationHistory.slice(-maxConsecutiveBlocks);
  if (recent.length >= maxConsecutiveBlocks && recent.every((e) => !e.allowed)) {
    return { halt: true, reason: `${maxConsecutiveBlocks} consecutive blocked actions` };
  }

  return { halt: false, reason: null };
}

// ---------------------------------------------------------------------------
// Interaction Model Runtime
// ---------------------------------------------------------------------------

function getInteractionEventsPath(options = {}) {
  const feedbackDir = options.feedbackDir || resolveFeedbackDir(options);
  return path.join(feedbackDir, INTERACTION_EVENTS_FILE);
}

function normalizeInteractionEvent(raw = {}, options = {}) {
  const type = String(raw.type || '').trim();
  if (!INTERACTION_EVENT_TYPES.has(type)) {
    throw new Error(`Unsupported interaction event type: ${type || '<missing>'}`);
  }

  const occurredAt = raw.occurredAt || raw.timestamp || new Date().toISOString();
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid interaction event timestamp: ${occurredAt}`);
  }

  return {
    id: raw.id || `evt_${date.getTime()}_${crypto.randomBytes(4).toString('hex')}`,
    type,
    occurredAt: date.toISOString(),
    source: normalizeInteractionScalar(raw.source || options.source || 'thumbgate', 80),
    correlationId: normalizeInteractionScalar(raw.correlationId || raw.sessionId || null, 160),
    payload: normalizeInteractionPayload(raw.payload || {}),
  };
}

function normalizeInteractionScalar(value, maxLength) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength);
}

function normalizeInteractionPayload(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (depth > 6) return '[truncated-depth]';
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => normalizeInteractionPayload(entry, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, entry] of Object.entries(value).slice(0, 100)) {
      output[normalizeInteractionScalar(key, 120)] = normalizeInteractionPayload(entry, depth + 1);
    }
    return output;
  }
  if (typeof value === 'string') return value.replace(/\r/g, '\\r').replace(/\n/g, '\\n').slice(0, 5000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  return String(value).slice(0, 1000);
}

function appendInteractionEvent(event, options = {}) {
  const normalized = normalizeInteractionEvent(event, options);
  appendJsonl(getInteractionEventsPath(options), normalized);
  return normalized;
}

function appendInteractionEvents(events, options = {}) {
  if (!Array.isArray(events)) throw new Error('events must be an array');
  return events.map((event) => appendInteractionEvent(event, options));
}

function loadInteractionEvents(options = {}) {
  return readJsonl(getInteractionEventsPath(options), {
    tail: Boolean(options.tail || options.maxLines),
    maxLines: options.maxLines,
  });
}

function buildInteractionState(events = [], options = {}) {
  const sorted = [...events].sort((a, b) => String(a.occurredAt || '').localeCompare(String(b.occurredAt || '')));
  const state = {
    targetPr: options.targetPr || null,
    phase: 'unknown',
    originalPr: null,
    activeQueuePr: null,
    queueAttempts: [],
    queueRecycleCount: 0,
    checks: {},
    publish: {
      verified: false,
      packageName: null,
      version: null,
      latest: null,
    },
    security: {
      verified: false,
      codeScanningOpen: null,
      dependabotOpen: null,
      secretScanningOpen: null,
    },
    claims: {
      canClaimQueued: false,
      canClaimMerged: false,
      canClaimPublished: false,
      canClaimSecurityClear: false,
      canClaimComplete: false,
    },
    evidence: [],
  };

  for (const event of sorted) {
    applyInteractionEvent(state, event);
  }

  finalizeInteractionState(state);
  return state;
}

function applyInteractionEvent(state, event = {}) {
  const payload = event.payload || {};
  switch (event.type) {
    case 'pr_state':
      applyInteractionPrState(state, payload, event);
      break;
    case 'ci_check':
      applyInteractionCheck(state, payload, event);
      break;
    case 'publish_verification':
      applyInteractionPublishVerification(state, payload, event);
      break;
    case 'security_verification':
      applyInteractionSecurityVerification(state, payload, event);
      break;
    case 'tool_intent':
    case 'tool_result':
    case 'feedback':
    case 'observation':
    case 'user_message':
    case 'assistant_message':
      state.evidence.push(interactionEvidence(event.type, summarizeInteractionPayload(payload), event));
      break;
    default:
      break;
  }
}

function applyInteractionPrState(state, payload, event) {
  const pr = normalizeInteractionPr(payload);
  if (pr.isQueuePr) {
    const existing = state.queueAttempts.find((attempt) => attempt.prNumber === pr.prNumber);
    const queueRecord = existing || pr;
    if (existing) Object.assign(existing, pr);
    else state.queueAttempts.push(queueRecord);

    if (queueRecord.state === 'OPEN') {
      state.activeQueuePr = queueRecord;
      state.phase = 'trunk_queue_running';
      state.claims.canClaimQueued = true;
    }

    if (queueRecord.state === 'CLOSED' && !queueRecord.mergedAt) {
      queueRecord.recycled = true;
      state.queueRecycleCount = state.queueAttempts.filter((attempt) => attempt.recycled).length;
      state.activeQueuePr = null;
      state.phase = 'queue_recycled';
      state.evidence.push(interactionEvidence('queue_recycled', `queue PR #${queueRecord.prNumber} closed without merge`, event));
    }
    return;
  }

  state.originalPr = pr;
  if (pr.state === 'OPEN') {
    state.phase = pr.mergeStateStatus === 'BEHIND' ? 'main_moved' : 'pr_open';
  }
  if (pr.mergedAt && pr.mergeCommit) {
    state.phase = 'merged';
    state.claims.canClaimMerged = true;
  }
  state.evidence.push(interactionEvidence('pr_state', `PR #${pr.prNumber || '?'} ${pr.state || 'unknown'}`, event));
}

function applyInteractionCheck(state, payload, event) {
  const name = String(payload.name || payload.context || 'unknown').trim();
  const status = String(payload.status || payload.state || '').trim();
  const conclusion = String(payload.conclusion || payload.result || '').trim();
  const key = normalizeInteractionCheckKey(name);
  const check = {
    name,
    status,
    conclusion,
    prNumber: payload.prNumber || null,
    url: payload.url || payload.detailsUrl || null,
    completed: status.toUpperCase() === 'COMPLETED' || Boolean(payload.completedAt),
    success: TERMINAL_SUCCESS.has(conclusion),
    failure: TERMINAL_FAILURE.has(conclusion),
  };
  state.checks[key] = check;
  if (/trunk merge queue/i.test(name) && !check.success && !check.failure) {
    state.phase = 'trunk_queue_running';
    state.claims.canClaimQueued = true;
  }
  state.evidence.push(interactionEvidence('ci_check', `${name}: ${conclusion || status || 'pending'}`, event));
}

function applyInteractionPublishVerification(state, payload, event) {
  const ok = Boolean(payload.ok || (payload.version && payload.latest && payload.version === payload.latest));
  state.publish = {
    verified: ok,
    packageName: payload.packageName || payload.name || state.publish.packageName,
    version: payload.version || state.publish.version,
    latest: payload.latest || state.publish.latest,
  };
  state.claims.canClaimPublished = ok;
  state.evidence.push(interactionEvidence('publish_verification', ok ? 'npm latest verified' : 'npm latest not verified', event));
}

function applyInteractionSecurityVerification(state, payload, event) {
  const codeScanningOpen = toInteractionCount(payload.codeScanningOpen);
  const dependabotOpen = toInteractionCount(payload.dependabotOpen);
  const secretScanningOpen = toInteractionCount(payload.secretScanningOpen);
  const ok = [codeScanningOpen, dependabotOpen, secretScanningOpen].every((count) => count === 0);
  state.security = {
    verified: ok,
    codeScanningOpen,
    dependabotOpen,
    secretScanningOpen,
  };
  state.claims.canClaimSecurityClear = ok;
  state.evidence.push(interactionEvidence('security_verification', ok ? 'security alerts verified clear' : 'security alerts not clear', event));
}

function finalizeInteractionState(state) {
  if (state.claims.canClaimMerged && state.claims.canClaimPublished && state.claims.canClaimSecurityClear) {
    state.claims.canClaimComplete = true;
    state.phase = 'complete_verified';
    return;
  }
  if (state.claims.canClaimMerged) state.phase = 'merged';
  if (!state.activeQueuePr && state.queueRecycleCount > 0 && !state.claims.canClaimMerged) state.phase = 'queue_recycled';
}

function evaluateInteractionForegroundGate(intent = {}, state = {}) {
  const kind = intent.kind || inferInteractionIntentKind(intent);
  if (kind === 'claim') return evaluateInteractionClaim(intent, state);
  if (kind === 'action') return evaluateInteractionAction(intent, state);
  return allowInteraction('No foreground gate matched.');
}

function evaluateInteractionClaim(intent = {}, state = {}) {
  const text = String(intent.text || intent.claim || '').trim();
  const claims = state.claims || {};
  const blocked = [];

  for (const requirement of CLAIM_REQUIREMENTS) {
    if (requirement.pattern.test(text) && !claims[requirement.claimKey]) {
      blocked.push({
        id: requirement.id,
        reason: requirement.message,
      });
    }
  }

  if (blocked.length > 0) {
    return {
      decision: 'block',
      blocked,
      warnings: [],
      evidenceRequired: blocked.map((entry) => entry.id),
    };
  }

  return allowInteraction('Claim has required interaction-state evidence.');
}

function evaluateInteractionAction(intent = {}, state = {}) {
  const text = `${intent.command || ''} ${intent.text || ''}`;
  if (/\bgh\s+pr\s+merge\b/i.test(text) && state.phase === 'trunk_queue_running') {
    return {
      decision: 'warn',
      blocked: [],
      warnings: [{
        id: 'manual_merge_while_trunk_running',
        reason: 'Trunk merge queue is already running. Prefer waiting for the protected queue unless explicitly overriding.',
      }],
      evidenceRequired: [],
    };
  }
  return allowInteraction('Action has no interaction-state conflict.');
}

function reviewInteractionState(state = {}) {
  const recommendations = [];

  if ((state.queueRecycleCount || 0) > 0 && !state.claims?.canClaimMerged) {
    recommendations.push({
      id: 'summarize_queue_recycle',
      severity: 'medium',
      action: 'status_update',
      summary: 'Report Trunk queue recycling as external validation churn, not as code failure or merge completion.',
      proposedRule: 'When synthetic trunk-merge PRs close unmerged after successful checks, call it queue recycling and continue tracking the latest queue PR.',
    });
  }

  if (!state.claims?.canClaimPublished) {
    recommendations.push({
      id: 'verify_npm_before_release_claim',
      severity: 'high',
      action: 'verify',
      summary: 'Query npm dist-tags before claiming a version is published.',
      proposedRule: 'A publish claim requires npm version and dist-tag evidence for the package.',
    });
  }

  if (!state.claims?.canClaimSecurityClear) {
    recommendations.push({
      id: 'verify_security_alert_counts',
      severity: 'high',
      action: 'verify',
      summary: 'Query code scanning, Dependabot, and secret scanning alert counts before claiming security is clear.',
      proposedRule: 'A security-clear claim requires all three GitHub security alert counts to be zero.',
    });
  }

  if (state.phase === 'trunk_queue_running' || state.phase === 'main_moved') {
    recommendations.push({
      id: 'wait_for_protected_queue',
      severity: 'medium',
      action: 'wait',
      summary: 'Do not bypass a running protected Trunk queue unless a human explicitly asks for a manual override.',
      proposedRule: 'Protected merge queues are the source of truth for merge readiness.',
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    phase: state.phase || 'unknown',
    recommendations,
    proposedRules: recommendations.map((entry) => entry.proposedRule),
  };
}

function normalizeInteractionPr(payload = {}) {
  return {
    prNumber: payload.prNumber || payload.number || null,
    title: payload.title || '',
    isQueuePr: Boolean(payload.isQueuePr || /^trunk-merge\/pr-/i.test(String(payload.headRefName || ''))),
    basePrNumber: payload.basePrNumber || null,
    headRefName: payload.headRefName || null,
    state: String(payload.state || '').toUpperCase(),
    mergeStateStatus: payload.mergeStateStatus || null,
    mergedAt: payload.mergedAt || null,
    mergeCommit: payload.mergeCommit || null,
  };
}

function toInteractionCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isFinite(count) ? count : null;
}

function normalizeInteractionCheckKey(name) {
  return String(name || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function interactionEvidence(kind, summary, event) {
  return {
    kind,
    summary,
    eventId: event.id || null,
    occurredAt: event.occurredAt || null,
  };
}

function summarizeInteractionPayload(payload = {}) {
  if (payload.summary) return String(payload.summary).slice(0, 240);
  if (payload.message) return String(payload.message).slice(0, 240);
  if (payload.command) return String(payload.command).slice(0, 240);
  return Object.keys(payload).slice(0, 5).join(', ') || 'event recorded';
}

function inferInteractionIntentKind(intent = {}) {
  if (intent.text || intent.claim) return 'claim';
  if (intent.command || intent.toolName) return 'action';
  return 'unknown';
}

function allowInteraction(reason) {
  return {
    decision: 'allow',
    blocked: [],
    warnings: [],
    evidenceRequired: [],
    reason,
  };
}

/**
 * Format checkpoint as human-readable summary.
 */
function formatCheckpoint(checkpoint) {
  const lines = [];
  lines.push(`Workflow: ${checkpoint.workflowId} | Step: ${checkpoint.step} | Phase: ${checkpoint.phase || 'unknown'} | Status: ${checkpoint.status || 'unknown'}`);
  lines.push(`Checkpoint: ${checkpoint.checkpointId}`);
  lines.push(`Actions: ${checkpoint.sessionActions.length} | Evaluations: ${checkpoint.evaluationHistory.length}`);
  lines.push(`Evidence: ${(checkpoint.evidence || []).length}`);
  lines.push(`Gate State: blocked=${checkpoint.gateState.blockedCount} near-miss=${checkpoint.gateState.nearMissCount} checked=${checkpoint.gateState.totalChecked} posture=${checkpoint.gateState.safetyPosture}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  return invokedPath ? path.resolve(invokedPath) === __filename : false;
}

if (isCliInvocation()) {
  const command = process.argv[2] || 'create';
  const filePath = process.argv[3] || '.thumbgate/workflow-checkpoint.json';

  if (command === 'create') {
    const cp = createCheckpoint({ activeSpecs: ['agent-safety'] });
    saveCheckpoint(cp, filePath);
    console.log(formatCheckpoint(cp));
  } else if (command === 'load') {
    const cp = loadCheckpoint(filePath);
    if (!cp) {
      console.error('No checkpoint found at:', filePath);
      process.exit(1);
    }
    console.log(formatCheckpoint(cp));
  } else {
    console.error(`Unknown command: ${command}. Use: create, load`);
    process.exit(1);
  }
}

module.exports = {
  CLAIM_REQUIREMENTS,
  INTERACTION_EVENTS_FILE,
  INTERACTION_EVENT_TYPES,
  appendInteractionEvent,
  appendInteractionEvents,
  advanceCheckpoint,
  buildInteractionState,
  createCheckpoint,
  evaluateInteractionClaim,
  evaluateInteractionForegroundGate,
  formatCheckpoint,
  getInteractionEventsPath,
  loadInteractionEvents,
  loadCheckpoint,
  normalizeInteractionCheckKey,
  normalizeInteractionEvent,
  normalizeInteractionPayload,
  reviewInteractionState,
  saveCheckpoint,
  shouldHaltWorkflow,
};
