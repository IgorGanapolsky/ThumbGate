'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildManagedScheduleCommand } = require('./schedule-manager');

const ROOT = path.join(__dirname, '..');
const RUNNER_PATH = require.resolve('./async-job-runner');
const FEEDBACK_PATH = require.resolve('./feedback-loop');
const VERIFICATION_PATH = require.resolve('./verification-loop');
const EXPERIMENT_TRACKER_PATH = require.resolve('./experiment-tracker');
const VERIFY_RUN_PATH = require.resolve('./verify-run');

function resolveProofPaths() {
  const proofDir = process.env.RLHF_RUNTIME_PROOF_DIR || process.env.RLHF_PROOF_DIR || path.join(ROOT, 'proof');
  return {
    proofDir,
    reportJson: path.join(proofDir, 'runtime-report.json'),
    reportMd: path.join(proofDir, 'runtime-report.md'),
  };
}

function resetModules() {
  [
    RUNNER_PATH,
    FEEDBACK_PATH,
    VERIFICATION_PATH,
    EXPERIMENT_TRACKER_PATH,
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

function makeAcceptedVerification() {
  return {
    accepted: true,
    attempts: 1,
    finalVerification: {
      score: 1,
      violations: [],
    },
    partnerStrategy: {
      profile: 'strict_reviewer',
      verificationMode: 'evidence_first',
    },
    partnerReward: {
      reward: 1,
    },
  };
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

function loadRuntimeHarness(feedbackDir, verificationLoopImpl) {
  process.env.RLHF_FEEDBACK_DIR = feedbackDir;
  resetModules();
  stubModule(VERIFICATION_PATH, {
    runVerificationLoop: verificationLoopImpl,
  });

  return {
    runner: require('./async-job-runner'),
    experimentTracker: require('./experiment-tracker'),
  };
}

function cleanupHarness(feedbackDir) {
  resetModules();
  delete process.env.RLHF_FEEDBACK_DIR;
  fs.rmSync(feedbackDir, { recursive: true, force: true });
}

async function run() {
  const results = { passed: 0, failed: 0, requirements: {} };
  const { proofDir, reportJson, reportMd } = resolveProofPaths();

  const checks = [
    {
      id: 'RUNTIME-01',
      desc: 'stage execution persists checkpointed state and stage history',
      fn: () => {
        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-runtime-proof-'));
        try {
          const { runner } = loadRuntimeHarness(feedbackDir, () => makeAcceptedVerification());
          runner.executeJob({
            id: 'checkpoint-job',
            tags: ['runtime'],
            stages: [
              { name: 'draft', context: 'draft ready' },
              { name: 'ship', appendContext: 'ship ready' },
            ],
          });
          const state = runner.readJobState('checkpoint-job');
          if (state.status !== 'completed') throw new Error(`Expected completed state, got ${state.status}`);
          if (state.stageHistory.length !== 2) throw new Error('Expected 2 completed stages');
          if (state.checkpoints.length !== 2) throw new Error('Expected 2 checkpoints');
          if (state.currentContext !== 'draft ready\nship ready') {
            throw new Error(`Unexpected final context: ${state.currentContext}`);
          }
        } finally {
          cleanupHarness(feedbackDir);
        }
      },
    },
    {
      id: 'RUNTIME-02',
      desc: 'pause requests yield a paused checkpoint and resume continues from the next stage',
      fn: () => {
        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-runtime-proof-'));
        try {
          const { runner } = loadRuntimeHarness(feedbackDir, () => makeAcceptedVerification());
          const job = {
            id: 'pause-job',
            tags: ['runtime'],
            stages: [
              {
                name: 'draft',
                run({ controller }) {
                  controller.requestPause({ reason: 'proof pause' });
                  return { context: 'draft ready' };
                },
              },
              {
                name: 'ship',
                run() {
                  return { appendContext: 'ship ready' };
                },
              },
            ],
          };

          const paused = runner.executeJob(job);
          const pausedState = runner.readJobState('pause-job');
          const resumed = runner.resumeJob('pause-job', job);

          if (paused.status !== 'paused') throw new Error(`Expected paused result, got ${paused.status}`);
          if (pausedState.nextStageIndex !== 1) throw new Error(`Expected nextStageIndex=1, got ${pausedState.nextStageIndex}`);
          if (resumed.status !== 'completed') throw new Error(`Expected resumed completion, got ${resumed.status}`);
        } finally {
          cleanupHarness(feedbackDir);
        }
      },
    },
    {
      id: 'RUNTIME-03',
      desc: 'managed job files auto-resume through resumeManagedJobs without manual stage reconstruction',
      fn: () => {
        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-runtime-proof-'));
        try {
          const { runner } = loadRuntimeHarness(feedbackDir, () => makeAcceptedVerification());
          const jobFile = path.join(feedbackDir, 'managed-job.json');
          fs.writeFileSync(jobFile, JSON.stringify({
            id: 'managed-job',
            tags: ['runtime'],
            stages: [
              { name: 'plan', context: 'plan ready' },
              { name: 'ship', appendContext: 'ship ready' },
            ],
          }, null, 2));

          runner.requestJobControl('managed-job', 'pause', { reason: 'pause before start' });
          const paused = runner.runJobFromFile(jobFile);
          const resumed = runner.resumeManagedJobs();
          const state = runner.readJobState('managed-job');

          if (paused.status !== 'paused') throw new Error(`Expected paused managed job, got ${paused.status}`);
          if (resumed.completed !== 1) throw new Error(`Expected 1 resumed completion, got ${resumed.completed}`);
          if (state.currentContext !== 'plan ready\nship ready') {
            throw new Error(`Unexpected managed final context: ${state.currentContext}`);
          }
        } finally {
          cleanupHarness(feedbackDir);
        }
      },
    },
    {
      id: 'RUNTIME-04',
      desc: 'failed verification queues an auto-improvement experiment',
      fn: () => {
        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-runtime-proof-'));
        try {
          const { runner, experimentTracker } = loadRuntimeHarness(feedbackDir, () => makeRejectedVerification());
          const result = runner.executeJob({
            id: 'verification-fail-job',
            context: 'webhook signature mismatch',
            tags: ['billing'],
            skill: 'billing-guard',
          });
          const experiments = experimentTracker.loadExperiments();
          const experiment = experiments[0];

          if (result.status !== 'failed') throw new Error(`Expected failed result, got ${result.status}`);
          if (!experiment) throw new Error('Expected one pending improvement experiment');
          if (experiment.mutation.failureType !== 'verification') {
            throw new Error(`Expected verification failureType, got ${experiment.mutation.failureType}`);
          }
        } finally {
          cleanupHarness(feedbackDir);
        }
      },
    },
    {
      id: 'RUNTIME-05',
      desc: 'schedule manager builds a managed async-job-runner command for job files',
      fn: () => {
        const command = buildManagedScheduleCommand({
          jobFile: '/tmp/thumbgate/jobs/runtime-proof.json',
          autoResume: true,
        });

        if (!command.includes('async-job-runner.js')) throw new Error('Missing async-job-runner reference');
        if (!command.includes('runJobFromFile')) throw new Error('Missing runJobFromFile invocation');
        if (!command.includes('runtime-proof.json')) throw new Error('Missing job file reference');
      },
    },
    {
      id: 'RUNTIME-06',
      desc: 'verify-run full includes the runtime proof lane and artifact',
      fn: () => {
        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-runtime-proof-'));
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-runtime-proof-cwd-'));
        try {
          process.env.RLHF_FEEDBACK_DIR = feedbackDir;
          resetModules();
          const { buildVerifyPlan, recordVerifyWorkflowRun } = require('./verify-run');
          const plan = buildVerifyPlan('full');
          const commands = plan.map((step) => [step.command, ...(step.args || [])].join(' ')).join('\n');
          if (!commands.includes('prove:runtime')) {
            throw new Error('verify:full is missing prove:runtime');
          }

          const entry = recordVerifyWorkflowRun('full', cwd, feedbackDir);
          const hasRuntimeArtifact = entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'runtime-report.json')));
          if (!hasRuntimeArtifact) {
            throw new Error('verify workflow run is missing runtime proof artifact');
          }
        } finally {
          resetModules();
          delete process.env.RLHF_FEEDBACK_DIR;
          fs.rmSync(feedbackDir, { recursive: true, force: true });
          fs.rmSync(cwd, { recursive: true, force: true });
        }
      },
    },
  ];

  console.log('Interruptible Runtime - Proof Gate\n');
  console.log('Checking requirements:\n');

  for (const check of checks) {
    try {
      await check.fn();
      results.passed += 1;
      results.requirements[check.id] = { status: 'pass', desc: check.desc };
      console.log(`  PASS  ${check.id}: ${check.desc}`);
    } catch (error) {
      results.failed += 1;
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
    phase: '12-interruptible-runtime',
    generatedAt: new Date().toISOString(),
    passed: results.passed,
    failed: results.failed,
    total: checks.length,
    requirements: results.requirements,
  };

  fs.writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`);

  const markdown = [
    '# Interruptible Runtime Proof Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Result: ${results.passed}/${checks.length} passed`,
    '',
    '## Requirements',
    '',
    ...Object.entries(results.requirements).map(([id, requirement]) => {
      const checkbox = requirement.status === 'pass' ? '[x]' : '[ ]';
      const errorLine = requirement.error ? `\n  - Error: \`${requirement.error}\`` : '';
      return `- ${checkbox} **${id}**: ${requirement.desc}${errorLine}`;
    }),
    '',
    `${results.passed} passed, ${results.failed} failed`,
    '',
  ].join('\n');
  fs.writeFileSync(reportMd, `${markdown}\n`);

  console.log(`\nResult: ${results.passed} passed, ${results.failed} failed`);
  console.log(`Report: ${reportJson}`);

  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  resolveProofPaths,
  run,
};
