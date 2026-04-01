'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RUNNER_PATH = require.resolve('../scripts/async-job-runner');
const FEEDBACK_PATH = require.resolve('../scripts/feedback-loop');
const VERIFICATION_PATH = require.resolve('../scripts/verification-loop');
const EXPERIMENT_TRACKER_PATH = require.resolve('../scripts/experiment-tracker');

function createFeedbackDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-async-runner-test-'));
}

function resetRuntimeModules() {
  [
    RUNNER_PATH,
    FEEDBACK_PATH,
    VERIFICATION_PATH,
    EXPERIMENT_TRACKER_PATH,
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

function loadRuntimeHarness({
  feedbackDir,
  verificationLoopImpl = () => makeAcceptedVerification(),
} = {}) {
  process.env.RLHF_FEEDBACK_DIR = feedbackDir;
  resetRuntimeModules();
  stubModule(VERIFICATION_PATH, {
    runVerificationLoop: verificationLoopImpl,
  });
  const runner = require('../scripts/async-job-runner');
  const experimentTracker = require('../scripts/experiment-tracker');

  return {
    runner,
    experimentTracker,
    cleanup() {
      resetRuntimeModules();
      delete process.env.RLHF_FEEDBACK_DIR;
    },
  };
}

test('async-job-runner exports runtime filenames and job-state paths', () => {
  const feedbackDir = createFeedbackDir();
  const harness = loadRuntimeHarness({ feedbackDir });

  try {
    const paths = harness.runner.getJobRuntimePaths('job_123');
    assert.equal(harness.runner.JOB_LOG_FILENAME, 'job-log.jsonl');
    assert.equal(harness.runner.JOB_CONTROL_FILENAME, 'job-control.json');
    assert.equal(harness.runner.JOB_STATE_DIRNAME, 'jobs');
    assert.equal(paths.feedbackDir, feedbackDir);
    assert.match(paths.statePath, /jobs\/job_123\/state\.json$/);
    assert.match(paths.controlPath, /jobs\/job_123\/job-control\.json$/);
  } finally {
    harness.cleanup();
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('recallContext returns normalized analytics structure', () => {
  const feedbackDir = createFeedbackDir();
  const harness = loadRuntimeHarness({ feedbackDir });

  try {
    const context = harness.runner.recallContext({ tags: ['testing'] });

    assert.equal(typeof context.totalFeedback, 'number');
    assert.equal(typeof context.approvalRate, 'number');
    assert.equal(typeof context.preventionRuleCount, 'number');
    assert.ok(Array.isArray(context.riskDomains));
    assert.ok(Array.isArray(context.recommendations));
  } finally {
    harness.cleanup();
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('executeJob runs the full pipeline and persists stage history and checkpoints', () => {
  const feedbackDir = createFeedbackDir();
  const harness = loadRuntimeHarness({ feedbackDir });

  try {
    const result = harness.runner.executeJob({
      id: 'pipeline-job',
      tags: ['testing'],
      stages: [
        { name: 'draft', context: 'draft ready' },
        { name: 'ship', appendContext: 'ship ready' },
      ],
    });
    const state = harness.runner.readJobState('pipeline-job');
    const log = harness.runner.readJobLog();

    assert.equal(result.status, 'completed');
    assert.equal(result.phases.verification.accepted, true);
    assert.equal(state.status, 'completed');
    assert.equal(state.currentContext, 'draft ready\nship ready');
    assert.equal(state.stageHistory.length, 2);
    assert.equal(state.checkpoints.length, 2);
    assert.equal(log[log.length - 1].jobId, 'pipeline-job');
  } finally {
    harness.cleanup();
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('runBatch processes multiple jobs sequentially', () => {
  const feedbackDir = createFeedbackDir();
  const harness = loadRuntimeHarness({ feedbackDir });

  try {
    const result = harness.runner.runBatch([
      { id: 'batch-1', context: 'first output', tags: ['testing'] },
      { id: 'batch-2', context: 'second output', tags: ['ops'] },
    ]);

    assert.equal(result.total, 2);
    assert.equal(result.completed, 2);
    assert.equal(result.failed, 0);
    assert.equal(result.paused, 0);
    assert.equal(result.cancelled, 0);
  } finally {
    harness.cleanup();
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('executeJob pauses after a checkpoint and resumeJob continues from the next stage', () => {
  const feedbackDir = createFeedbackDir();
  const harness = loadRuntimeHarness({ feedbackDir });

  try {
    const executedStages = [];
    const job = {
      id: 'resume-job',
      tags: ['testing'],
      stages: [
        {
          name: 'draft',
          run({ controller }) {
            executedStages.push('draft');
            controller.requestPause({ reason: 'checkpoint pause' });
            return { context: 'draft ready' };
          },
        },
        {
          name: 'ship',
          run() {
            executedStages.push('ship');
            return { appendContext: 'ship ready' };
          },
        },
      ],
    };

    const paused = harness.runner.executeJob(job);
    const pausedState = harness.runner.readJobState('resume-job');
    const resumed = harness.runner.resumeJob('resume-job', job);
    const completedState = harness.runner.readJobState('resume-job');

    assert.equal(paused.status, 'paused');
    assert.equal(pausedState.status, 'paused');
    assert.equal(pausedState.nextStageIndex, 1);
    assert.equal(pausedState.stageHistory.length, 1);
    assert.equal(pausedState.checkpoints.length, 1);
    assert.equal(harness.runner.readJobControl('resume-job'), null);

    assert.equal(resumed.status, 'completed');
    assert.deepEqual(executedStages, ['draft', 'ship']);
    assert.equal(completedState.status, 'completed');
    assert.equal(completedState.currentContext, 'draft ready\nship ready');
    assert.equal(completedState.stageHistory.length, 2);
  } finally {
    harness.cleanup();
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('resumeManagedJobs auto-resumes paused managed jobs from their job files', () => {
  const feedbackDir = createFeedbackDir();
  const harness = loadRuntimeHarness({ feedbackDir });

  try {
    const jobFile = path.join(feedbackDir, 'managed-job.json');
    fs.writeFileSync(jobFile, JSON.stringify({
      id: 'managed-job',
      tags: ['testing'],
      stages: [
        { name: 'plan', context: 'plan ready' },
        { name: 'ship', appendContext: 'ship ready' },
      ],
    }, null, 2));

    harness.runner.requestJobControl('managed-job', 'pause', { reason: 'simulate pause before start' });
    const paused = harness.runner.runJobFromFile(jobFile);
    const resumed = harness.runner.resumeManagedJobs();
    const state = harness.runner.readJobState('managed-job');

    assert.equal(paused.status, 'paused');
    assert.equal(resumed.total, 1);
    assert.equal(resumed.completed, 1);
    assert.equal(resumed.failed, 0);
    assert.equal(resumed.results[0].jobId, 'managed-job');
    assert.equal(state.status, 'completed');
    assert.equal(state.currentContext, 'plan ready\nship ready');
    assert.equal(state.jobFilePath, jobFile);
  } finally {
    harness.cleanup();
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('verification failures queue a follow-up experiment automatically', () => {
  const feedbackDir = createFeedbackDir();
  const harness = loadRuntimeHarness({
    feedbackDir,
    verificationLoopImpl: () => makeRejectedVerification(),
  });

  try {
    const result = harness.runner.executeJob({
      id: 'verification-failure-job',
      context: 'webhook signature mismatch',
      tags: ['billing'],
      skill: 'billing-guard',
    });
    const experiments = harness.experimentTracker.loadExperiments();
    const state = harness.runner.readJobState('verification-failure-job');

    assert.equal(result.status, 'failed');
    assert.equal(experiments.length, 1);
    assert.equal(experiments[0].status, 'pending');
    assert.equal(experiments[0].mutationType, 'prompt');
    assert.equal(experiments[0].mutation.failureType, 'verification');
    assert.equal(experiments[0].mutation.jobId, 'verification-failure-job');
    assert.equal(typeof experiments[0].mutation.recommendedTarget, 'string');
    assert.match(experiments[0].mutation.evolutionCommand, /workspace-evolver\.js/);
    assert.equal(state.improvementExperimentId, experiments[0].id);
  } finally {
    harness.cleanup();
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('command stages that emit no stdout preserve the current context', () => {
  const feedbackDir = createFeedbackDir();
  const harness = loadRuntimeHarness({ feedbackDir });

  try {
    const result = harness.runner.executeJob({
      id: 'stdout-preserve-job',
      tags: ['testing'],
      stages: [
        { name: 'seed', context: 'seed context' },
        { name: 'noop-command', command: `${process.execPath} -e ""` },
        { name: 'append', appendContext: 'final context' },
      ],
    });
    const state = harness.runner.readJobState('stdout-preserve-job');

    assert.equal(result.status, 'completed');
    assert.equal(state.currentContext, 'seed context\nfinal context');
  } finally {
    harness.cleanup();
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('runHarness compiles and executes a natural-language harness through async-job-runner', () => {
  const feedbackDir = createFeedbackDir();
  const harness = loadRuntimeHarness({ feedbackDir });

  try {
    const result = harness.runner.runHarness('repo-full-verification', {
      verificationCommand: 'node -e "process.stdout.write(\'verify ok\')"',
    }, {
      jobId: 'async-runner-harness-job',
    });
    const state = harness.runner.readJobState('async-runner-harness-job');

    assert.equal(result.status, 'completed');
    assert.ok(state);
    assert.match(state.currentContext, /verify ok/);
    assert.match(state.currentContext, /Success evidence required:/);
    assert.ok(state.stageHistory.length >= 3);
  } finally {
    harness.cleanup();
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});
