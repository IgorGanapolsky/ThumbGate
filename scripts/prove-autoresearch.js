'use strict';
/**
 * Phase 9: Autoresearch — Proof Gate
 *
 * Validates all AUTORESEARCH-01 through AUTORESEARCH-06 requirements offline.
 * Mirrors the pattern of prove-loop-closure.js.
 *
 * Usage:
 *   node scripts/prove-autoresearch.js
 *
 * Produces:
 *   proof/autoresearch-report.json
 *   proof/autoresearch-report.md
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function resolveProofPaths() {
  const proofDir = process.env.THUMBGATE_PROOF_DIR || path.join(ROOT, 'proof');
  return {
    proofDir,
    reportJson: path.join(proofDir, 'autoresearch-report.json'),
    reportMd: path.join(proofDir, 'autoresearch-report.md'),
  };
}

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-autoresearch-proof-'));
  const results = { passed: 0, failed: 0, requirements: {} };
  const { proofDir, reportJson, reportMd } = resolveProofPaths();

  const checks = [
    {
      id: 'AUTORESEARCH-01',
      desc: 'experiment-tracker.js: createExperiment() returns valid experiment with id, status=pending',
      fn: () => {
        process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
        delete require.cache[require.resolve('./experiment-tracker')];
        delete require.cache[require.resolve('./feedback-loop')];
        const m = require('./experiment-tracker');

        if (typeof m.createExperiment !== 'function') throw new Error('createExperiment not exported');
        if (typeof m.recordResult !== 'function') throw new Error('recordResult not exported');
        if (typeof m.getProgress !== 'function') throw new Error('getProgress not exported');
        if (typeof m.getBestExperiment !== 'function') throw new Error('getBestExperiment not exported');
        if (typeof m.loadExperiments !== 'function') throw new Error('loadExperiments not exported');

        const exp = m.createExperiment({
          name: 'proof-test',
          hypothesis: 'Proof gate validates experiment lifecycle',
          mutationType: 'config',
        });
        if (!exp.id.startsWith('exp_')) throw new Error('Experiment id must start with exp_');
        if (exp.status !== 'pending') throw new Error('Experiment status must be pending');
        if (!exp.createdAt) throw new Error('Experiment must have createdAt');
      },
    },
    {
      id: 'AUTORESEARCH-02',
      desc: 'experiment-tracker.js: recordResult() keeps improved experiments, discards regressions',
      fn: () => {
        process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
        delete require.cache[require.resolve('./experiment-tracker')];
        delete require.cache[require.resolve('./feedback-loop')];
        const m = require('./experiment-tracker');

        // Kept: score improved
        const exp1 = m.createExperiment({ name: 'kept', hypothesis: 'improve' });
        const r1 = m.recordResult({ experimentId: exp1.id, score: 0.95, baseline: 0.90, testsPassed: true });
        if (!r1.kept) throw new Error('Should keep improved experiment');
        if (r1.status !== 'completed') throw new Error('Status must be completed');

        // Discarded: score regressed
        const exp2 = m.createExperiment({ name: 'discarded', hypothesis: 'regress' });
        const r2 = m.recordResult({ experimentId: exp2.id, score: 0.80, baseline: 0.90 });
        if (r2.kept) throw new Error('Should discard regressed experiment');

        // Discarded: tests failed
        const exp3 = m.createExperiment({ name: 'test-fail', hypothesis: 'fail' });
        const r3 = m.recordResult({ experimentId: exp3.id, score: 0.99, baseline: 0.50, testsPassed: false });
        if (r3.kept) throw new Error('Should discard experiment with failed tests');
      },
    },
    {
      id: 'AUTORESEARCH-03',
      desc: 'experiment-tracker.js: getProgress() returns valid progress with keepRate',
      fn: () => {
        process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
        delete require.cache[require.resolve('./experiment-tracker')];
        delete require.cache[require.resolve('./feedback-loop')];
        const m = require('./experiment-tracker');

        const p = m.getProgress();
        if (typeof p.totalExperiments !== 'number') throw new Error('totalExperiments must be a number');
        if (typeof p.completed !== 'number') throw new Error('completed must be a number');
        if (typeof p.kept !== 'number') throw new Error('kept must be a number');
        if (typeof p.keepRate !== 'string') throw new Error('keepRate must be a string');
        if (!p.lastUpdated) throw new Error('lastUpdated required');

        const paths = m.getExperimentPaths();
        if (!fs.existsSync(paths.progressPath)) throw new Error('Progress file must be persisted');
      },
    },
    {
      id: 'AUTORESEARCH-04',
      desc: 'autoresearch-runner.js: scoreSuite() correctly parses node:test output and bounds score in [0,1]',
      fn: () => {
        delete require.cache[require.resolve('./autoresearch-runner')];
        const m = require('./autoresearch-runner');

        if (typeof m.scoreSuite !== 'function') throw new Error('scoreSuite not exported');
        if (typeof m.runIteration !== 'function') throw new Error('runIteration not exported');
        if (typeof m.runLoop !== 'function') throw new Error('runLoop not exported');
        if (!Array.isArray(m.MUTATION_TARGETS)) throw new Error('MUTATION_TARGETS not exported');

        // Perfect run
        const perfect = m.scoreSuite({ testOutput: 'ℹ tests 50\nℹ pass 50\nℹ fail 0', approvalRate: 1.0 });
        if (perfect.score < 0.95) throw new Error(`Perfect score should be >= 0.95, got ${perfect.score}`);
        if (perfect.score > 1.0) throw new Error(`Score must not exceed 1.0`);

        // Partial failure
        const partial = m.scoreSuite({ testOutput: 'ℹ tests 10\nℹ pass 5\nℹ fail 5', approvalRate: 0.5 });
        if (partial.score <= 0 || partial.score >= 1) throw new Error(`Partial score must be in (0,1), got ${partial.score}`);

        // Empty
        const empty = m.scoreSuite({ testOutput: '' });
        if (typeof empty.score !== 'number') throw new Error('Empty output must still return numeric score');
      },
    },
    {
      id: 'AUTORESEARCH-05',
      desc: 'MUTATION_TARGETS resolve to evolution-state settings with valid ranges',
      fn: () => {
        delete require.cache[require.resolve('./autoresearch-runner')];
        delete require.cache[require.resolve('./evolution-state')];
        const m = require('./autoresearch-runner');
        const { DEFAULT_SETTINGS } = require('./evolution-state');

        for (const target of m.MUTATION_TARGETS) {
          const value = DEFAULT_SETTINGS[target.settingKey];
          if (!Number.isFinite(value)) throw new Error(`Default setting missing for ${target.settingKey}`);
          if (value < target.range[0] || value > target.range[1]) {
            throw new Error(`Current value ${value} for ${target.name} outside range [${target.range}]`);
          }
        }
      },
    },
    {
      id: 'AUTORESEARCH-06',
      desc: 'research-backed autoresearch ingests paper context, records citations, and preserves score execution flow',
      fn: async () => {
        process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
        delete require.cache[require.resolve('./contextfs')];
        delete require.cache[require.resolve('./hf-papers')];
        delete require.cache[require.resolve('./autoresearch-runner')];
        delete require.cache[require.resolve('./experiment-tracker')];
        delete require.cache[require.resolve('./feedback-loop')];

        const runner = require('./autoresearch-runner');
        const { constructTemplatedPack, NAMESPACES } = require('./contextfs');

        const result = await runner.runIteration({
          targetName: 'half_life_days',
          nextValue: 8,
          testCommand: `${JSON.stringify(process.execPath)} -e ${JSON.stringify([
            'const { readEvolutionState } = require("./scripts/evolution-state");',
            'const passed = readEvolutionState().settings.half_life_days === 8;',
            'console.log("ℹ tests 1");',
            'console.log("ℹ pass " + (passed ? 1 : 0));',
            'console.log("ℹ fail " + (passed ? 0 : 1));',
            'if (!passed) process.exit(1);',
          ].join(' '))}`,
          holdoutCommands: [`${JSON.stringify(process.execPath)} -e ${JSON.stringify([
            'const { readEvolutionState } = require("./scripts/evolution-state");',
            'const passed = readEvolutionState().settings.half_life_days === 8;',
            'console.log("ℹ tests 1");',
            'console.log("ℹ pass " + (passed ? 1 : 0));',
            'console.log("ℹ fail " + (passed ? 0 : 1));',
            'if (!passed) process.exit(1);',
          ].join(' '))}`],
          timeoutMs: 5000,
          researchQuery: 'rank fusion',
          searchPapersImpl: async () => [{
            paperId: '2603.01896',
            title: 'Agentic Rank Fusion for Research Systems',
            summary: 'Retrieval fusion for agent workflows.',
            authors: ['Ada Lovelace'],
            tags: ['retrieval'],
            url: 'https://arxiv.org/abs/2603.01896',
            source: 'huggingface-papers',
          }],
        });

        if (result.metrics.researchQuery !== 'rank fusion') {
          throw new Error('Research query metadata missing from autoresearch result');
        }
        if (!result.metrics.researchPackId) {
          throw new Error('Research pack id missing from autoresearch result');
        }
        if (!result.metrics.researchPaperIds.includes('2603.01896')) {
          throw new Error('Research paper id missing from autoresearch result');
        }
        if (result.metrics.baselineEvaluation.primary.results[0].details.pass !== 0) {
          throw new Error('Expected baseline to fail before the candidate mutation');
        }
        if (result.metrics.candidateEvaluation.primary.results[0].details.pass !== 1) {
          throw new Error('Research context changed score execution flow');
        }

        const pack = constructTemplatedPack({
          template: 'autoresearch-brief',
          query: 'rank fusion retrieval',
        });
        if (!pack.items.some((item) => item.namespace === NAMESPACES.research)) {
          throw new Error('Autoresearch pack did not include research namespace content');
        }
      },
    },
  ];

  console.log('Phase 9: Autoresearch — Proof Gate\n');
  console.log('Checking requirements:\n');

  for (const check of checks) {
    try {
      await check.fn();
      results.passed++;
      results.requirements[check.id] = { status: 'pass', desc: check.desc };
      console.log(`  PASS  ${check.id}: ${check.desc}`);
    } catch (err) {
      results.failed++;
      results.requirements[check.id] = {
        status: 'fail',
        desc: check.desc,
        error: err.message,
      };
      console.error(`  FAIL  ${check.id}: ${err.message}`);
    }
  }

  // Cleanup
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
  delete process.env.THUMBGATE_FEEDBACK_DIR;

  // Write proof artifacts
  fs.mkdirSync(proofDir, { recursive: true });

  const report = {
    phase: '09-autoresearch',
    generatedAt: new Date().toISOString(),
    passed: results.passed,
    failed: results.failed,
    total: checks.length,
    requirements: results.requirements,
  };

  fs.writeFileSync(reportJson, JSON.stringify(report, null, 2) + '\n');

  const md = [
    '# Phase 9: Autoresearch — Proof Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Result: ${results.passed}/${checks.length} passed`,
    '',
    '## Requirements',
    '',
    ...Object.entries(results.requirements).map(([id, r]) => {
      const checkbox = r.status === 'pass' ? '[x]' : '[ ]';
      const errLine = r.error ? `\n  - Error: \`${r.error}\`` : '';
      return `- ${checkbox} **${id}**: ${r.desc}${errLine}`;
    }),
    '',
    '## Evidence',
    '',
    '- `scripts/experiment-tracker.js` — Experiment lifecycle: create, record, progress, best',
    '- `scripts/autoresearch-runner.js` — Karpathy-inspired self-optimizing mutation loop',
    '- `scripts/hf-papers.js` — Hugging Face papers ingestion and research-brief builder',
    '- `tests/autoresearch.test.js` and `tests/hf-papers.test.js` — Node:test coverage for research-backed autoresearch',
    '- `scripts/prove-autoresearch.js` — This proof gate with 6 requirement checks',
    '',
  ].join('\n');

  fs.writeFileSync(reportMd, md);

  console.log(`\nPhase 9 proof: ${results.passed} passed, ${results.failed} failed`);
  console.log(`Report: ${reportJson}`);

  if (results.failed > 0) process.exit(1);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { run };
