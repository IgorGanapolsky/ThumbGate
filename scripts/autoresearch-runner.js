#!/usr/bin/env node
'use strict';
/**
 * Autoresearch Runner (AUTORESEARCH-02)
 *
 * Karpathy-inspired self-optimizing loop for the ThumbGate feedback studio.
 * Each iteration: mutate local evolution state → run primary + holdout checks
 * → measure score → keep/discard with rollback snapshots.
 *
 * The runner never rewrites tracked source files. It mutates the local
 * evolution-state overlay, evaluates in place, and only persists accepted
 * settings plus rollback snapshots.
 *
 * Mutation targets (in priority order):
 *   1. Thompson Sampling priors (HALF_LIFE_DAYS, DECAY_FLOOR)
 *   2. Prevention rule thresholds (minOccurrences)
 *   3. Verification loop retries (MAX_RETRIES)
 *   4. DPO temperature (DPO_BETA)
 *
 * Score function: command pass rate × approval weighting, with holdout gating.
 *
 * Zero external dependencies.
 *
 * Exports: runIteration, runLoop, scoreSuite, MUTATION_TARGETS
 */

const {
  getProgress,
} = require('./experiment-tracker');
const { buildResearchBrief } = require('./hf-papers');
const {
  EVOLUTION_TARGETS,
  parseCommandScore,
  runWorkspaceEvolution,
} = require('./workspace-evolver');

// ---------------------------------------------------------------------------
// Mutation Targets
// ---------------------------------------------------------------------------

const MUTATION_TARGETS = EVOLUTION_TARGETS;

// ---------------------------------------------------------------------------
// Score Function
// ---------------------------------------------------------------------------

/**
 * Score a test suite run. Returns a number in [0, 1].
 *
 * @param {object} params
 * @param {string} params.testOutput - stdout from test run
 * @param {number} [params.approvalRate] - Current approval rate from feedback
 * @returns {{ score: number, testPassRate: number, details: object }}
 */
function scoreSuite(params) {
  return parseCommandScore(params.testOutput || '', 0, typeof params.approvalRate === 'number' ? params.approvalRate : 0.5);
}

// ---------------------------------------------------------------------------
// Single Iteration
// ---------------------------------------------------------------------------

/**
 * Run one autoresearch iteration.
 *
 * 1. Pick a random mutation target
 * 2. Read current value, compute a random neighbor
 * 3. Run the test suite in a tmp env with the mutation
 * 4. Score and keep/discard via experiment tracker
 *
 * @param {object} [opts]
 * @param {string} [opts.targetName] - Force a specific mutation target
 * @param {number} [opts.nextValue] - Force the candidate value instead of a random neighbor
 * @param {string} [opts.testCommand] - Override test command (default: npm test)
 * @param {string[]} [opts.holdoutCommands] - Optional holdout commands required for acceptance
 * @param {number} [opts.timeoutMs] - Test timeout in ms (default: 120000)
 * @param {string} [opts.cwd] - Working directory for evaluation commands
 * @param {string} [opts.researchQuery] - Optional external research query
 * @param {number} [opts.paperLimit] - Max papers to ingest for research context
 * @param {Function} [opts.fetchImpl] - Optional fetch implementation override
 * @param {Function} [opts.searchPapersImpl] - Optional paper search override
 * @returns {Promise<object>} experiment result
 */
async function runIteration(opts = {}) {
  const options = opts || {};
  const timeoutMs = options.timeoutMs || 120000;
  const testCommand = options.testCommand || 'npm test';
  const research = options.researchQuery
    ? await buildResearchBrief({
      query: options.researchQuery,
      limit: options.paperLimit,
      fetchImpl: options.fetchImpl,
      searchPapersImpl: options.searchPapersImpl,
      template: 'autoresearch-brief',
    })
    : null;

  const result = runWorkspaceEvolution({
    targetName: options.targetName,
    nextValue: options.nextValue,
    primaryCommands: [testCommand],
    holdoutCommands: options.holdoutCommands || [],
    timeoutMs,
    cwd: options.cwd,
    hypothesisSuffix: research ? `Research query: ${research.query}` : null,
    additionalMetrics: {
      researchQuery: research ? research.query : null,
      researchPackId: research ? research.packId : null,
      researchPaperIds: research ? research.citations.map((citation) => citation.paperId).filter(Boolean) : [],
    },
  });

  return result;
}

// ---------------------------------------------------------------------------
// Multi-Iteration Loop
// ---------------------------------------------------------------------------

/**
 * Run N autoresearch iterations.
 *
 * @param {object} params
 * @param {number} params.iterations - Number of experiments to run
 * @param {string} [params.targetName] - Force a specific mutation target
 * @param {number} [params.nextValue] - Force the candidate value instead of a random neighbor
 * @param {string} [params.testCommand] - Override test command
 * @param {string[]} [params.holdoutCommands] - Optional holdout commands required for acceptance
 * @param {number} [params.timeoutMs] - Per-iteration timeout
 * @param {string} [params.cwd] - Working directory for evaluation commands
 * @param {string} [params.researchQuery] - Optional external research query
 * @param {number} [params.paperLimit] - Max papers to ingest for research context
 * @param {Function} [params.fetchImpl] - Optional fetch implementation override
 * @param {Function} [params.searchPapersImpl] - Optional paper search override
 * @returns {Promise<object>} { results, progress }
 */
async function runLoop(params) {
  const iterations = params.iterations || 1;
  const results = [];

  for (let i = 0; i < iterations; i++) {
    console.log(`\n[autoresearch] Iteration ${i + 1}/${iterations}`);
    try {
      const result = await runIteration({
        targetName: params.targetName,
        nextValue: Number.isFinite(params.nextValue) ? params.nextValue : undefined,
        testCommand: params.testCommand,
        holdoutCommands: params.holdoutCommands,
        timeoutMs: params.timeoutMs,
        cwd: params.cwd,
        researchQuery: params.researchQuery,
        paperLimit: params.paperLimit,
        fetchImpl: params.fetchImpl,
        searchPapersImpl: params.searchPapersImpl,
      });
      results.push(result);
      if (result.kept) {
        console.log(`  ✓ KEPT: ${result.name} (delta: +${(result.delta || 0).toFixed(4)})`);
      } else if (result.skipped) {
        console.log(`  ⊘ SKIPPED: ${result.reason}`);
      } else {
        console.log(`  ✗ DISCARDED: ${result.reason}`);
      }
    } catch (err) {
      console.error(`  ✗ ERROR: ${err.message}`);
      results.push({ error: err.message });
    }
  }

  const progress = getProgress();
  console.log(`\n[autoresearch] Progress: ${progress.completed} experiments, ${progress.kept} kept (${progress.keepRate}%)`);
  return { results, progress };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length > 0 ? rest.join('=') : true;
  });

  if (args.run) {
    const iterations = Number(args.iterations || 1);
    const testCommand = args['test-command'] || 'npm test';
    const timeoutMs = Number(args.timeout || 120000);
    const paperLimit = Number(args['paper-limit'] || 5);
    const holdoutCommands = args.holdout ? [args.holdout] : [];
    runLoop({
      iterations,
      targetName: args.target || null,
      nextValue: args['next-value'] !== undefined ? Number(args['next-value']) : undefined,
      testCommand,
      holdoutCommands,
      timeoutMs,
      cwd: args.cwd || undefined,
      researchQuery: args['research-query'] || null,
      paperLimit,
    }).catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
  } else if (args.targets) {
    console.log('Mutation targets:');
    MUTATION_TARGETS.forEach((t) => {
      console.log(`  ${t.name} (${t.type}): range [${t.range.join(', ')}], step ${t.step}`);
    });
  } else {
    console.log(`Usage:
  node scripts/autoresearch-runner.js --run [--iterations=5] [--target=half_life_days] [--next-value=8] [--test-command="npm test"] [--holdout="npm run self-heal:check"] [--timeout=120000] [--research-query="rank fusion"] [--paper-limit=5]
  node scripts/autoresearch-runner.js --targets`);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  runIteration,
  runLoop,
  scoreSuite,
  MUTATION_TARGETS,
};
