'use strict';
/**
 * DPO Batch Optimizer (DPO-02)
 *
 * Builds (chosen, rejected) preference pairs from feedback-log.jsonl memories,
 * computes DPO log-ratio adjustments using Thompson Sampling posteriors,
 * and writes dpo-model.json to RLHF_FEEDBACK_DIR.
 *
 * Does NOT call any external API. Pure offline batch optimization.
 *
 * Exports: run, buildPreferencePairs, applyDpoAdjustments, dpoLogRatio
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getEffectiveSetting } = require('./evolution-state');

const DPO_BETA = 0.1;

// ---------------------------------------------------------------------------
// dpoLogRatio — DPO preference adjustment formula
// ---------------------------------------------------------------------------

/**
 * Compute DPO adjustment in range [-1, +1] from chosen and rejected weights.
 *
 * @param {number} chosenWeight  - Time-decay weight for chosen (positive) outcome
 * @param {number} rejectedWeight - Time-decay weight for rejected (negative) outcome
 * @param {number} [beta=0.1]   - Temperature parameter (lower = more aggressive)
 * @returns {number} Adjustment in [-1, +1]
 */
function dpoLogRatio(chosenWeight, rejectedWeight, beta) {
  const b = (beta !== undefined && beta !== null) ? beta : getEffectiveSetting('dpo_beta', DPO_BETA);
  const cw = Math.max(chosenWeight, 0.01);
  const rw = Math.max(rejectedWeight, 0.01);
  const logRatio = Math.log(cw) - Math.log(rw);
  const sigmoid = 1.0 / (1.0 + Math.exp(-b * logRatio));
  return (sigmoid - 0.5) * 2;
}

// ---------------------------------------------------------------------------
// buildPreferencePairs — groups DPO pairs by category from feedbackDir
// ---------------------------------------------------------------------------

/**
 * Build preference pairs grouped by category.
 *
 * Uses buildDpoPairs() from export-dpo-pairs.js (do NOT reimplement).
 * Reads memory-log.jsonl from feedbackDir to get error + learning memories.
 *
 * @param {string} feedbackDir - Directory containing memory-log.jsonl
 * @returns {Object} Map of category → [{ chosen, rejected }]
 */
function buildPreferencePairs(feedbackDir) {
  const { buildDpoPairs, readJSONL } = require('./export-dpo-pairs');
  const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');
  const memories = readJSONL(memoryLogPath);

  const errors = memories.filter((m) => m.category === 'error');
  const learnings = memories.filter((m) => m.category === 'learning');

  const result = buildDpoPairs(errors, learnings);

  // Group pairs by category (inferred from matchedKeys or tags)
  const grouped = {};
  for (const pair of result.pairs) {
    const keys = (pair.metadata && pair.metadata.matchedKeys) || [];
    const category = keys.length > 0 ? keys[0] : 'uncategorized';
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push({
      chosen: pair.metadata
        ? { id: pair.metadata.learningId, content: pair.chosen, timestamp: null }
        : { content: pair.chosen },
      rejected: pair.metadata
        ? { id: pair.metadata.errorId, content: pair.rejected, timestamp: null }
        : { content: pair.rejected },
      metadata: pair.metadata,
    });
  }

  return grouped;
}

// ---------------------------------------------------------------------------
// applyDpoAdjustments — mutates Thompson model with DPO posterior adjustments
// ---------------------------------------------------------------------------

/**
 * Apply DPO adjustments to Thompson Sampling posteriors and save the model.
 *
 * CRITICAL: calls ts.saveModel(model, modelPath) after all mutations.
 *
 * @param {string} modelPath - Path to feedback_model.json
 * @param {Object} pairs     - Map of category → [{ chosen, rejected }] from buildPreferencePairs
 * @returns {Object} adjustments - Map of category → { pairs, avg_adjustment }
 */
function applyDpoAdjustments(modelPath, pairs) {
  const ts = require('./thompson-sampling');
  const model = ts.loadModel(modelPath);
  const adjustments = {};

  for (const [cat, catPairs] of Object.entries(pairs)) {
    if (!catPairs || catPairs.length === 0) continue;

    // Ensure category exists in model
    if (!model.categories[cat]) {
      model.categories[cat] = { alpha: 1.0, beta: 1.0, samples: 0, last_updated: null };
    }

    let total = 0;
    for (const pair of catPairs) {
      const chosenTs = (pair.chosen && pair.chosen.timestamp) || null;
      const rejectedTs = (pair.rejected && pair.rejected.timestamp) || null;
      const cw = ts.timeDecayWeight(chosenTs);
      const rw = ts.timeDecayWeight(rejectedTs);
      total += dpoLogRatio(cw, rw);
    }

    const avg = total / catPairs.length;

    if (avg > 0) {
      model.categories[cat].alpha += avg * catPairs.length * 0.5;
    } else {
      model.categories[cat].beta += Math.abs(avg) * catPairs.length * 0.5;
    }

    adjustments[cat] = {
      pairs: catPairs.length,
      avg_adjustment: Math.round(avg * 10000) / 10000,
    };
  }

  // CRITICAL: save after all mutations (Pitfall 2 from RESEARCH.md)
  ts.saveModel(model, modelPath);

  return adjustments;
}

// ---------------------------------------------------------------------------
// run — top-level batch DPO optimization entry point
// ---------------------------------------------------------------------------

/**
 * Run the full DPO optimization batch:
 * 1. Build preference pairs from memory-log.jsonl
 * 2. Apply DPO adjustments to Thompson model
 * 3. Write dpo-model.json to feedbackDir
 *
 * @param {Object} [opts]
 * @param {string} [opts.feedbackDir] - Override RLHF_FEEDBACK_DIR
 * @param {string} [opts.modelPath]   - Override Thompson model path
 * @returns {{ adjustments: Object, pairs_processed: number }}
 */
function run(opts) {
  const options = opts || {};
  const feedbackDir = options.feedbackDir ||
    process.env.RLHF_FEEDBACK_DIR ||
    path.join(os.homedir(), '.claude', 'memory', 'feedback');
  const modelPath = options.modelPath ||
    path.join(process.cwd(), '.claude', 'memory', 'feedback', 'feedback_model.json');

  const pairs = buildPreferencePairs(feedbackDir);

  const pairsProcessed = Object.values(pairs).reduce((sum, arr) => sum + arr.length, 0);

  let adjustments = {};
  if (pairsProcessed > 0) {
    adjustments = applyDpoAdjustments(modelPath, pairs);
  }

  const dpoModel = {
    generated: new Date().toISOString(),
    pairs_processed: pairsProcessed,
    adjustments,
  };

  const dpoModelPath = path.join(feedbackDir, 'dpo-model.json');
  if (!fs.existsSync(feedbackDir)) {
    fs.mkdirSync(feedbackDir, { recursive: true });
  }
  fs.writeFileSync(dpoModelPath, `${JSON.stringify(dpoModel, null, 2)}\n`);

  console.log(`DPO optimization complete: ${pairsProcessed} pairs processed`);
  if (Object.keys(adjustments).length > 0) {
    console.log('Adjustments:', JSON.stringify(adjustments, null, 2));
  } else {
    console.log('No adjustment pairs found (empty or no overlapping memories)');
  }

  return { adjustments, pairs_processed: pairsProcessed };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module && process.argv.includes('--run')) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { run, buildPreferencePairs, applyDpoAdjustments, dpoLogRatio };
