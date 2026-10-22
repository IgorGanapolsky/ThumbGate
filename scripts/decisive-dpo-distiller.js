'use strict';

/**
 * decisive-dpo-distiller.js — On-Device Trajectory Distillation Engine
 *
 * Implements SOTA post-training distillation:
 * 1. Reads task outcomes / trajectories.
 * 2. Isolates the Decisive Step (NVIDIA arXiv:2610.10478) flipping fail -> pass.
 * 3. Enforces the RRSI Pre-Screening Leakage Critic (Google Cloud arXiv:2609.24972)
 *    to prevent benchmark contamination in the training dataset.
 * 4. Compiles high-signal DPO preference triples (prompt, chosen, rejected)
 *    for LoRA fine-tuning / on-device student model adaptation.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { findDecisiveStep } = require('./decisive-step-evaluator');
const { screenLeakage } = require('./rrsi-regularizer');
const { getFeedbackPaths } = require('./feedback-paths');

const DISTILLED_DPO_FILE = 'dpo-distilled-pairs.jsonl';

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    return fs.readFileSync(filePath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Distill a sequence of trajectory actions into a decisive DPO preference triple.
 *
 * @param {object} params
 * @param {string} params.taskGoal - The user intent / task prompt
 * @param {Array<object>} params.trajectorySteps - Sequence of tool calls and test outputs
 * @param {object} [options]
 * @returns {object|null}
 */
function distillDecisiveDpoPair({ taskGoal = '', trajectorySteps = [] } = {}, options = {}) {
  const decisiveResult = findDecisiveStep(trajectorySteps, options);
  if (!decisiveResult.hasDecisiveStep) {
    return {
      valid: false,
      pair: null,
      reason: decisiveResult.reason,
    };
  }

  const decisiveStep = decisiveResult.decisiveStep;
  const chosenPatch = String(decisiveStep.patch || decisiveStep.diff || decisiveStep.code || '').trim();
  if (!chosenPatch) {
    return {
      valid: false,
      pair: null,
      reason: 'Decisive step has empty patch content',
    };
  }

  // Find the strongest rejected candidate from earlier failed steps
  let rejectedPatch = '';
  if (decisiveResult.rejectedSteps.length > 0) {
    const lastRejected = decisiveResult.rejectedSteps[decisiveResult.rejectedSteps.length - 1];
    rejectedPatch = String(lastRejected.patch || '').trim();
  }

  if (!rejectedPatch) {
    // If no prior patch was recorded, use a generic failed baseline
    rejectedPatch = '// Failed attempt: tests failed or implementation was missing';
  }

  // Pre-Screening Leakage Critic (arXiv:2609.24972):
  // Check both prompt and chosen patch for synthetic benchmark leakage
  const leakCheck = screenLeakage({ patch: chosenPatch, prompt: taskGoal }, options);
  if (!leakCheck.passed) {
    return {
      valid: false,
      pair: null,
      reason: `Leakage critic rejected pair: ${leakCheck.reason}`,
    };
  }

  // Construct prefix trajectory context
  const prefixSummary = decisiveResult.prefixSteps
    .map((s, idx) => `Step ${idx + 1}: ${s.tool || 'action'} -> ${s.action || 'attempt'}`)
    .join('\n');

  const fullPrompt = [
    `Task: ${taskGoal || 'Resolve code issue and verify tests pass'}`,
    prefixSummary ? `Prior trajectory:\n${prefixSummary}` : '',
    'Generate the decisive code patch that resolves the issue and passes all verification tests.',
  ].filter(Boolean).join('\n\n');

  const pair = {
    id: `distill_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    prompt: fullPrompt,
    chosen: chosenPatch,
    rejected: rejectedPatch,
    decisiveStepIndex: decisiveResult.decisiveStepIndex,
    totalSteps: trajectorySteps.length,
    timestamp: new Date().toISOString(),
    source: 'nvidia_decisive_step_distillation',
  };

  return {
    valid: true,
    pair,
    reason: `Distilled decisive DPO pair at step ${decisiveResult.decisiveStepIndex} (tests flipped fail->pass)`,
  };
}

/**
 * Distill multiple trajectories and write to the distilled DPO ledger.
 */
function distillTrajectoryBatch(trajectories = [], options = {}) {
  const pairs = [];
  const rejected = [];

  for (const item of trajectories) {
    const res = distillDecisiveDpoPair(item, options);
    if (res.valid && res.pair) {
      pairs.push(res.pair);
    } else {
      rejected.push({ item, reason: res.reason });
    }
  }

  const feedbackDir = options.feedbackDir || getFeedbackPaths().FEEDBACK_DIR;
  const outputPath = path.join(feedbackDir, DISTILLED_DPO_FILE);

  if (options.save !== false && pairs.length > 0) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    for (const p of pairs) {
      fs.appendFileSync(outputPath, `${JSON.stringify(p)}\n`, 'utf8');
    }
  }

  return {
    status: 'ok',
    totalProcessed: trajectories.length,
    distilledPairsCount: pairs.length,
    rejectedCount: rejected.length,
    outputPath: pairs.length > 0 ? outputPath : null,
    pairs,
    rejected,
  };
}

module.exports = {
  DISTILLED_DPO_FILE,
  distillDecisiveDpoPair,
  distillTrajectoryBatch,
};
