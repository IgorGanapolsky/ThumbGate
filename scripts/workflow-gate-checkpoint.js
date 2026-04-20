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
const { ensureParentDir } = require('./fs-utils');

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
  advanceCheckpoint,
  createCheckpoint,
  formatCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
  shouldHaltWorkflow,
};
