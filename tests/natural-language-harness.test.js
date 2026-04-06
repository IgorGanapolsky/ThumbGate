'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HARNESS_PATH = require.resolve('../scripts/natural-language-harness');
const RUNNER_PATH = require.resolve('../scripts/async-job-runner');
const VERIFICATION_PATH = require.resolve('../scripts/verification-loop');
const FEEDBACK_PATH = require.resolve('../scripts/feedback-loop');
const EXPERIMENT_TRACKER_PATH = require.resolve('../scripts/experiment-tracker');

const {
  buildHarnessJob,
  listHarnesses,
  renderHarnessPlan,
  runHarness,
} = require('../scripts/natural-language-harness');

function resetRuntimeModules() {
  [
    HARNESS_PATH,
    RUNNER_PATH,
    VERIFICATION_PATH,
    FEEDBACK_PATH,
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

test('listHarnesses returns the built-in natural-language harness catalog', () => {
  const harnesses = listHarnesses();
  assert.ok(harnesses.length >= 3);
  assert.ok(harnesses.some((entry) => entry.id === 'repo-full-verification'));
  assert.ok(harnesses.some((entry) => entry.id === 'workflow-hardening-sprint'));
  assert.ok(harnesses.some((entry) => entry.id === 'creator-partnership-review'));
});

test('listHarnesses filters by tag', () => {
  const harnesses = listHarnesses({ tag: 'verification' });
  assert.equal(harnesses.length, 1);
  assert.equal(harnesses[0].id, 'repo-full-verification');
});

test('renderHarnessPlan substitutes declared input overrides into steps and evidence', () => {
  const plan = renderHarnessPlan('creator-partnership-review', {
    creatorHandle: 'agentbuilder',
  });

  assert.equal(plan.resolvedInputs.creatorHandle, 'agentbuilder');
  assert.ok(plan.steps.some((step) => step.includes('agentbuilder')));
  assert.ok(plan.successEvidence.some((line) => line.includes('agentbuilder')));
});

test('buildHarnessJob converts run steps into command stages and appends success evidence', () => {
  const job = buildHarnessJob('repo-full-verification', {
    verificationCommand: 'node -e "process.stdout.write(\'verify ok\')"',
  }, {
    jobId: 'harness-job-test',
  });

  assert.equal(job.id, 'harness-job-test');
  assert.ok(job.tags.includes('natural-language-harness'));
  assert.ok(job.stages.some((stage) => stage.command && stage.command.includes('verify ok')));
  assert.match(job.stages[job.stages.length - 1].appendContext, /Success evidence required:/);
});

test('runHarness executes a natural-language harness through the async runtime', () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-harness-runtime-test-'));
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  resetRuntimeModules();
  stubModule(VERIFICATION_PATH, {
    runVerificationLoop: () => makeAcceptedVerification(),
  });

  try {
    const { runHarness } = require('../scripts/natural-language-harness');
    const runner = require('../scripts/async-job-runner');
    const result = runHarness('repo-full-verification', {
      verificationCommand: 'node -e "process.stdout.write(\'verify ok\')"',
    }, {
      jobId: 'runtime-harness-job',
    });
    const state = runner.readJobState('runtime-harness-job');

    assert.equal(result.status, 'completed');
    assert.ok(state);
    assert.ok(state.stageHistory.length >= 3);
    assert.match(state.currentContext, /verify ok/);
    assert.match(state.currentContext, /Success evidence required:/);
  } finally {
    resetRuntimeModules();
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('runHarness blocks execution when settings disable runtime execution', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-harness-settings-'));
  fs.mkdirSync(path.join(projectRoot, '.thumbgate'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.thumbgate', 'settings.json'),
    JSON.stringify({ harnesses: { allowRuntimeExecution: false } }, null, 2),
  );

  assert.throws(() => {
    runHarness('repo-full-verification', {}, {
      settingsOptions: { projectRoot, homeDir: projectRoot },
    });
  }, /disabled by the settings hierarchy/i);

  fs.rmSync(projectRoot, { recursive: true, force: true });
});
