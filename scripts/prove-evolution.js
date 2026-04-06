'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RUNNER_PATH = require.resolve('./async-job-runner');
const FEEDBACK_PATH = require.resolve('./feedback-loop');
const VERIFICATION_PATH = require.resolve('./verification-loop');
const EXPERIMENT_TRACKER_PATH = require.resolve('./experiment-tracker');
const EVOLUTION_STATE_PATH = require.resolve('./evolution-state');
const WORKSPACE_EVOLVER_PATH = require.resolve('./workspace-evolver');
const AUTORESEARCH_PATH = require.resolve('./autoresearch-runner');
const VERIFY_RUN_PATH = require.resolve('./verify-run');

function resolveProofPaths() {
  const proofDir = process.env.THUMBGATE_PROOF_DIR || path.join(ROOT, 'proof');
  return {
    proofDir,
    reportJson: path.join(proofDir, 'evolution-report.json'),
    reportMd: path.join(proofDir, 'evolution-report.md'),
  };
}

function resetModules() {
  [
    RUNNER_PATH,
    FEEDBACK_PATH,
    VERIFICATION_PATH,
    EXPERIMENT_TRACKER_PATH,
    EVOLUTION_STATE_PATH,
    WORKSPACE_EVOLVER_PATH,
    AUTORESEARCH_PATH,
    VERIFY_RUN_PATH,
  ].forEach((modulePath) => {
    delete require.cache[modulePath];
  });
}

function stubModule(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
}

function buildStateCommand(settingKey, expectedValue) {
  const script = [
    'const { readEvolutionState } = require("./scripts/evolution-state");',
    `const expected = ${JSON.stringify(expectedValue)};`,
    `const value = readEvolutionState().settings[${JSON.stringify(settingKey)}];`,
    'const passed = value === expected;',
    'console.log("ℹ tests 1");',
    'console.log("ℹ pass " + (passed ? 1 : 0));',
    'console.log("ℹ fail " + (passed ? 0 : 1));',
    'if (!passed) process.exit(1);',
  ].join(' ');
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

function makeRejectedVerification() {
  return {
    accepted: false,
    attempts: 2,
    finalVerification: {
      score: 0.2,
      violations: [
        {
          pattern: 'webhook signature mismatch',
          avoidRule: 'Verify webhook signatures before deploy.',
        },
      ],
    },
    partnerStrategy: {
      profile: 'strict_reviewer',
      verificationMode: 'evidence_first',
    },
    partnerReward: {
      reward: 0,
    },
  };
}

async function run() {
  const results = { passed: 0, failed: 0, requirements: {} };
  const { proofDir, reportJson, reportMd } = resolveProofPaths();

  const checks = [
    {
      id: 'EVOLVE-01',
      desc: 'evolution-state loads defaults and captures rollback snapshots',
      fn: () => {
        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-evolution-proof-'));
        try {
          process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
          resetModules();
          const state = require('./evolution-state');
          const initial = state.readEvolutionState();
          if (initial.settings.half_life_days !== 7) throw new Error('Expected default half_life_days=7');

          const accepted = state.applyAcceptedMutation({
            targetKey: 'half_life_days',
            nextValue: 9,
            experimentId: 'exp_proof',
            summary: 'proof mutation',
          });
          if (!accepted.rollbackSnapshot.snapshotId) throw new Error('Expected rollback snapshot id');
          if (state.readEvolutionState().settings.half_life_days !== 9) throw new Error('Accepted mutation did not persist');
        } finally {
          delete process.env.THUMBGATE_FEEDBACK_DIR;
          resetModules();
          fs.rmSync(feedbackDir, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'EVOLVE-02',
      desc: 'workspace-evolver accepts improved candidates only when primary and holdout checks pass',
      fn: () => {
        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-evolution-proof-'));
        try {
          process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
          resetModules();
          const { runWorkspaceEvolution } = require('./workspace-evolver');
          const { readEvolutionState } = require('./evolution-state');
          const result = runWorkspaceEvolution({
            cwd: ROOT,
            targetName: 'half_life_days',
            nextValue: 8,
            primaryCommands: [buildStateCommand('half_life_days', 8)],
            holdoutCommands: [buildStateCommand('half_life_days', 8)],
            timeoutMs: 5000,
          });

          if (!result.kept) throw new Error('Expected improved candidate to be kept');
          if (!result.metrics.rollbackSnapshotId) throw new Error('Expected rollback snapshot metadata');
          if (readEvolutionState().settings.half_life_days !== 8) throw new Error('Accepted evolution state not applied');
        } finally {
          delete process.env.THUMBGATE_FEEDBACK_DIR;
          resetModules();
          fs.rmSync(feedbackDir, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'EVOLVE-03',
      desc: 'restoreWorkspaceEvolution rolls accepted state back to the previous snapshot',
      fn: () => {
        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-evolution-proof-'));
        try {
          process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
          resetModules();
          const { runWorkspaceEvolution, restoreWorkspaceEvolution } = require('./workspace-evolver');
          const { readEvolutionState } = require('./evolution-state');
          const result = runWorkspaceEvolution({
            cwd: ROOT,
            targetName: 'half_life_days',
            nextValue: 8,
            primaryCommands: [buildStateCommand('half_life_days', 8)],
            holdoutCommands: [buildStateCommand('half_life_days', 8)],
            timeoutMs: 5000,
          });

          restoreWorkspaceEvolution(result.metrics.rollbackSnapshotId);
          if (readEvolutionState().settings.half_life_days !== 7) throw new Error('Rollback did not restore default state');
        } finally {
          delete process.env.THUMBGATE_FEEDBACK_DIR;
          resetModules();
          fs.rmSync(feedbackDir, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'EVOLVE-04',
      desc: 'autoresearch-runner delegates to workspace evolver and records research metadata plus rollback evidence',
      fn: async () => {
        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-evolution-proof-'));
        try {
          process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
          resetModules();
          const runner = require('./autoresearch-runner');
          const result = await runner.runIteration({
            targetName: 'half_life_days',
            nextValue: 8,
            testCommand: buildStateCommand('half_life_days', 8),
            holdoutCommands: [buildStateCommand('half_life_days', 8)],
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

          if (!result.kept) throw new Error('Expected autoresearch iteration to keep the improved candidate');
          if (result.metrics.researchQuery !== 'rank fusion') throw new Error('Research query metadata missing');
          if (!result.metrics.researchPackId) throw new Error('Research pack id missing');
          if (!result.metrics.researchPaperIds.includes('2603.01896')) throw new Error('Research paper id missing');
          if (!result.metrics.rollbackSnapshotId) throw new Error('Rollback snapshot metadata missing');
        } finally {
          delete process.env.THUMBGATE_FEEDBACK_DIR;
          resetModules();
          fs.rmSync(feedbackDir, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'EVOLVE-05',
      desc: 'async-job-runner follow-up experiments include a recommended evolution target and replay command',
      fn: () => {
        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-evolution-proof-'));
        try {
          process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
          resetModules();
          stubModule(VERIFICATION_PATH, {
            runVerificationLoop: () => makeRejectedVerification(),
          });
          const runner = require('./async-job-runner');
          const tracker = require('./experiment-tracker');
          runner.executeJob({
            id: 'verification-failure-job',
            context: 'webhook signature mismatch',
            tags: ['billing'],
            skill: 'billing-guard',
          });
          const experiments = tracker.loadExperiments();
          const experiment = experiments[0];

          if (!experiment) throw new Error('Expected queued improvement experiment');
          if (!experiment.mutation.recommendedTarget) throw new Error('Missing recommendedTarget');
          if (!experiment.mutation.evolutionCommand.includes('workspace-evolver.js')) {
            throw new Error('Missing workspace evolver replay command');
          }
        } finally {
          delete process.env.THUMBGATE_FEEDBACK_DIR;
          resetModules();
          fs.rmSync(feedbackDir, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'EVOLVE-06',
      desc: 'verify:full includes the evolution proof lane and records the artifact',
      fn: () => {
        resetModules();
        const { buildVerifyPlan, recordVerifyWorkflowRun } = require('./verify-run');
        const plan = buildVerifyPlan('full');
        const commands = plan.map((step) => [step.command, ...(step.args || [])].join(' ')).join('\n');
        if (!commands.includes('prove:evolution')) {
          throw new Error('verify:full is missing prove:evolution');
        }

        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-evolution-proof-feedback-'));
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-evolution-proof-cwd-'));
        try {
          const entry = recordVerifyWorkflowRun('full', cwd, feedbackDir);
          if (!entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'evolution-report.json')))) {
            throw new Error('Workflow run missing evolution proof artifact');
          }
        } finally {
          fs.rmSync(feedbackDir, { recursive: true, force: true });
          fs.rmSync(cwd, { recursive: true, force: true });
        }
      },
    },
  ];

  console.log('Phase 17: Agent Workspace Evolution — Proof Gate\n');
  console.log('Checking requirements:\n');

  for (const check of checks) {
    try {
      await check.fn();
      results.passed++;
      results.requirements[check.id] = { status: 'pass', desc: check.desc };
      console.log(`  PASS  ${check.id}: ${check.desc}`);
    } catch (error) {
      results.failed++;
      results.requirements[check.id] = {
        status: 'fail',
        desc: check.desc,
        error: error.message,
      };
      console.error(`  FAIL  ${check.id}: ${error.message}`);
    }
  }

  fs.mkdirSync(proofDir, { recursive: true });

  const report = {
    phase: '17-agent-workspace-evolution',
    generatedAt: new Date().toISOString(),
    passed: results.passed,
    failed: results.failed,
    requirements: results.requirements,
  };

  fs.writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`);

  const lines = [
    '# Agent Workspace Evolution Proof Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Summary: ${results.passed} passed, ${results.failed} failed`,
    '',
    '## Requirements',
    '',
  ];

  for (const [id, requirement] of Object.entries(results.requirements)) {
    lines.push(`- [${requirement.status === 'pass' ? 'x' : ' '}] **${id}** — ${requirement.desc}`);
    if (requirement.error) {
      lines.push(`  - Error: ${requirement.error}`);
    }
  }

  lines.push('');
  lines.push('## Evidence');
  lines.push('');
  lines.push('- `scripts/evolution-state.js` — local accepted-state overlay + rollback snapshots');
  lines.push('- `scripts/workspace-evolver.js` — evolve / evaluate / accept / rollback engine');
  lines.push('- `scripts/autoresearch-runner.js` — shared research-backed mutation loop on top of the evolver');
  lines.push('- `scripts/prove-evolution.js` — this proof gate');

  fs.writeFileSync(reportMd, `${lines.join('\n')}\n`);

  console.log(`\n${results.passed} passed, ${results.failed} failed`);

  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  run,
};
