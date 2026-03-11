'use strict';
/**
 * Experiment Tracker (AUTORESEARCH-01)
 *
 * Tracks autonomous iteration experiments inspired by Karpathy's autoresearch.
 * Each experiment = a config mutation + test run + measurable score.
 * Keeps/discards based on whether score improves over baseline.
 *
 * Persists experiments to .rlhf/experiments.jsonl and writes a progress
 * summary to .rlhf/experiment-progress.json.
 *
 * Zero external dependencies — uses only node:* and existing project modules.
 *
 * Exports: createExperiment, recordResult, getProgress, getBestExperiment,
 *          loadExperiments, EXPERIMENT_LOG_PATH
 */

const fs = require('fs');
const path = require('path');
const { getFeedbackPaths, readJSONL } = require('./feedback-loop');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getExperimentPaths() {
  const { FEEDBACK_DIR } = getFeedbackPaths();
  return {
    logPath: path.join(FEEDBACK_DIR, 'experiments.jsonl'),
    progressPath: path.join(FEEDBACK_DIR, 'experiment-progress.json'),
  };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function appendJSONL(filePath, record) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

// ---------------------------------------------------------------------------
// Experiment Lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a new experiment record. Does NOT execute anything — just records
 * the intent so the runner can fill in results later.
 *
 * @param {object} params
 * @param {string} params.name - Human-readable experiment name
 * @param {string} params.hypothesis - What change is being tested
 * @param {string} params.mutationType - Category of mutation (config|prompt|code|threshold)
 * @param {object} [params.mutation] - The actual mutation applied (key/value diff)
 * @param {string} [params.branch] - Git branch name for this experiment
 * @returns {object} experiment record with id and status='pending'
 */
function createExperiment(params) {
  if (!params || !params.name || !params.hypothesis) {
    throw new Error('Experiment requires name and hypothesis');
  }

  const validMutationTypes = ['config', 'prompt', 'code', 'threshold'];
  const mutationType = params.mutationType || 'config';
  if (!validMutationTypes.includes(mutationType)) {
    throw new Error(`Invalid mutationType "${mutationType}". Must be one of: ${validMutationTypes.join(', ')}`);
  }

  const experiment = {
    id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: params.name,
    hypothesis: params.hypothesis,
    mutationType,
    mutation: params.mutation || null,
    branch: params.branch || null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    completedAt: null,
    baseline: null,
    result: null,
    score: null,
    kept: null,
    reason: null,
  };

  const { logPath } = getExperimentPaths();
  appendJSONL(logPath, experiment);
  return experiment;
}

/**
 * Record the result of a completed experiment.
 *
 * @param {object} params
 * @param {string} params.experimentId - ID from createExperiment
 * @param {number} params.score - Measured score (higher = better)
 * @param {number} params.baseline - Baseline score to compare against
 * @param {boolean} [params.testsPassed] - Whether the test suite passed
 * @param {object} [params.metrics] - Additional metrics (coverage, duration, etc.)
 * @returns {object} Updated experiment with kept/discarded decision
 */
function recordResult(params) {
  if (!params || !params.experimentId) {
    throw new Error('recordResult requires experimentId');
  }
  if (typeof params.score !== 'number' || typeof params.baseline !== 'number') {
    throw new Error('recordResult requires numeric score and baseline');
  }

  const { logPath } = getExperimentPaths();
  const experiments = loadExperiments();
  const experiment = experiments.find(e => e.id === params.experimentId);

  if (!experiment) {
    throw new Error(`Experiment ${params.experimentId} not found`);
  }

  const improved = params.score > params.baseline;
  const testsPassed = params.testsPassed !== false;
  const kept = improved && testsPassed;

  const result = {
    ...experiment,
    status: 'completed',
    completedAt: new Date().toISOString(),
    baseline: params.baseline,
    score: params.score,
    delta: params.score - params.baseline,
    testsPassed,
    metrics: params.metrics || null,
    kept,
    reason: !testsPassed
      ? 'Tests failed — discarded'
      : improved
        ? `Score improved by ${(params.score - params.baseline).toFixed(4)}`
        : `Score did not improve (${params.score} <= ${params.baseline})`,
  };

  appendJSONL(logPath, result);
  updateProgress();
  return result;
}

// ---------------------------------------------------------------------------
// Progress Tracking
// ---------------------------------------------------------------------------

/**
 * Load all experiment records from the JSONL log.
 * @returns {object[]}
 */
function loadExperiments() {
  const { logPath } = getExperimentPaths();
  return readJSONL(logPath);
}

/**
 * Recompute and persist experiment progress summary.
 * @returns {object} progress summary
 */
function updateProgress() {
  const experiments = loadExperiments();
  const completed = experiments.filter(e => e.status === 'completed');
  const kept = completed.filter(e => e.kept === true);
  const discarded = completed.filter(e => e.kept === false);
  const pending = experiments.filter(e => e.status === 'pending');

  const bestExperiment = kept.length > 0
    ? kept.reduce((best, e) => (e.delta || 0) > (best.delta || 0) ? e : best, kept[0])
    : null;

  const progress = {
    totalExperiments: experiments.length,
    completed: completed.length,
    kept: kept.length,
    discarded: discarded.length,
    pending: pending.length,
    keepRate: completed.length > 0
      ? (kept.length / completed.length * 100).toFixed(1)
      : '0.0',
    bestExperiment: bestExperiment
      ? { id: bestExperiment.id, name: bestExperiment.name, delta: bestExperiment.delta }
      : null,
    lastUpdated: new Date().toISOString(),
  };

  const { progressPath } = getExperimentPaths();
  ensureDir(path.dirname(progressPath));
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2) + '\n');
  return progress;
}

/**
 * Get current experiment progress.
 * @returns {object} progress summary
 */
function getProgress() {
  const { progressPath } = getExperimentPaths();
  if (fs.existsSync(progressPath)) {
    try {
      return JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
    } catch {
      // Fall through to recompute
    }
  }
  return updateProgress();
}

/**
 * Get the best-performing kept experiment.
 * @returns {object|null}
 */
function getBestExperiment() {
  const experiments = loadExperiments();
  const kept = experiments.filter(e => e.kept === true);
  if (kept.length === 0) return null;
  return kept.reduce((best, e) => (e.delta || 0) > (best.delta || 0) ? e : best, kept[0]);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length > 0 ? rest.join('=') : true;
  });

  if (args.progress) {
    console.log(JSON.stringify(getProgress(), null, 2));
  } else if (args.best) {
    const best = getBestExperiment();
    console.log(best ? JSON.stringify(best, null, 2) : 'No kept experiments yet.');
  } else if (args.list) {
    const exps = loadExperiments().filter(e => e.status === 'completed');
    console.log(`${exps.length} completed experiments (${exps.filter(e => e.kept).length} kept)`);
    exps.slice(-10).forEach(e => {
      const icon = e.kept ? '✓' : '✗';
      console.log(`  ${icon} ${e.name} — delta: ${(e.delta || 0).toFixed(4)}`);
    });
  } else {
    console.log(`Usage:
  node scripts/experiment-tracker.js --progress
  node scripts/experiment-tracker.js --best
  node scripts/experiment-tracker.js --list`);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createExperiment,
  recordResult,
  getProgress,
  getBestExperiment,
  loadExperiments,
  updateProgress,
  getExperimentPaths,
};
