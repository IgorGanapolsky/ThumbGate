'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AUTONOMOUS_WORKFLOW_PATH = require.resolve('../scripts/autonomous-workflow');
const RUNNER_PATH = require.resolve('../scripts/async-job-runner');
const FEEDBACK_PATH = require.resolve('../scripts/feedback-loop');
const VERIFICATION_PATH = require.resolve('../scripts/verification-loop');
const EXPERIMENT_TRACKER_PATH = require.resolve('../scripts/experiment-tracker');

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function resetRuntimeModules() {
  [
    AUTONOMOUS_WORKFLOW_PATH,
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

function makeVerification(accepted) {
  return {
    accepted,
    attempts: accepted ? 1 : 2,
    finalVerification: {
      score: accepted ? 1 : 0.2,
      violations: accepted
        ? []
        : [{ pattern: 'missing evidence', avoidRule: 'Attach evidence before done' }],
    },
    partnerStrategy: {
      profile: 'strict_reviewer',
      verificationMode: 'evidence_first',
    },
    partnerReward: {
      reward: accepted ? 1 : 0,
    },
  };
}

function loadWorkflowHarness({ feedbackDir, verificationLoopImpl } = {}) {
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  resetRuntimeModules();
  stubModule(VERIFICATION_PATH, {
    runVerificationLoop: verificationLoopImpl || (() => makeVerification(true)),
  });

  const workflow = require('../scripts/autonomous-workflow');
  return {
    workflow,
    cleanup() {
      resetRuntimeModules();
      delete process.env.THUMBGATE_FEEDBACK_DIR;
    },
  };
}

test('runAutonomousWorkflow persists checkpoints, reports, and proof-backed workflow runs', () => {
  const feedbackDir = createTempDir('thumbgate-autonomous-feedback-');
  const cwd = createTempDir('thumbgate-autonomous-cwd-');
  const harness = loadWorkflowHarness({ feedbackDir });

  try {
    const report = harness.workflow.runAutonomousWorkflow({
      workflowId: 'roi-verify',
      name: 'ROI verify',
      intent: 'Run the canonical control-plane flow',
      tags: ['testing', 'verification'],
      stages: [
        { name: 'execute', context: 'execution complete' },
      ],
      proofArtifacts: ['proof/custom-proof.json'],
    }, { cwd, feedbackDir });

    const paths = harness.workflow.getWorkflowPaths('roi-verify', cwd);
    const checkpoint = JSON.parse(fs.readFileSync(paths.checkpointPath, 'utf8'));
    const savedReport = JSON.parse(fs.readFileSync(paths.reportJsonPath, 'utf8'));

    assert.equal(report.status, 'completed');
    assert.equal(report.workflowRun.proofBacked, true);
    assert.equal(savedReport.workflowRun.proofBacked, true);
    assert.equal(checkpoint.phase, 'report');
    assert.equal(checkpoint.status, 'completed');
    assert.match(savedReport.execution.currentContext, /execution complete/);
    assert.ok(savedReport.evidenceArtifacts.includes(paths.planPath));
    assert.ok(savedReport.evidenceArtifacts.includes(paths.reportMdPath));
    assert.ok(savedReport.evidenceArtifacts.includes('proof/custom-proof.json'));
    assert.ok(fs.existsSync(paths.reportMdPath));
  } finally {
    harness.cleanup();
    fs.rmSync(feedbackDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('runAutonomousWorkflow marks failed verification as not proof-backed', () => {
  const feedbackDir = createTempDir('thumbgate-autonomous-failed-feedback-');
  const cwd = createTempDir('thumbgate-autonomous-failed-cwd-');
  const harness = loadWorkflowHarness({
    feedbackDir,
    verificationLoopImpl: () => makeVerification(false),
  });

  try {
    const report = harness.workflow.runAutonomousWorkflow({
      workflowId: 'roi-failed',
      intent: 'Reject unverifiable output',
      tags: ['testing'],
      stages: [{ name: 'execute', context: 'needs more proof' }],
    }, { cwd, feedbackDir });

    assert.equal(report.status, 'failed');
    assert.equal(report.workflowRun.proofBacked, false);
    assert.equal(report.verification.accepted, false);
  } finally {
    harness.cleanup();
    fs.rmSync(feedbackDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('resumeAutonomousWorkflow completes a paused execution from the next stage', () => {
  const feedbackDir = createTempDir('thumbgate-autonomous-resume-feedback-');
  const cwd = createTempDir('thumbgate-autonomous-resume-cwd-');
  const harness = loadWorkflowHarness({ feedbackDir });
  const executedStages = [];

  try {
    const spec = {
      workflowId: 'roi-resume',
      intent: 'Resume from a paused checkpoint',
      tags: ['testing'],
      stages: [
        {
          name: 'draft',
          run({ controller }) {
            executedStages.push('draft');
            controller.requestPause({ reason: 'checkpoint pause' });
            return { context: 'draft complete' };
          },
        },
        {
          name: 'ship',
          run() {
            executedStages.push('ship');
            return { appendContext: 'ship complete' };
          },
        },
      ],
    };

    const paused = harness.workflow.runAutonomousWorkflow(spec, { cwd, feedbackDir });
    const resumed = harness.workflow.resumeAutonomousWorkflow(spec, { cwd, feedbackDir });
    const saved = harness.workflow.readWorkflowReport('roi-resume', { cwd });

    assert.equal(paused.status, 'paused');
    assert.equal(paused.workflowRun.proofBacked, false);
    assert.equal(resumed.status, 'completed');
    assert.deepEqual(executedStages, ['draft', 'ship']);
    assert.match(saved.execution.currentContext, /draft complete\nship complete/);
    assert.equal(saved.workflowRun.proofBacked, true);
  } finally {
    harness.cleanup();
    fs.rmSync(feedbackDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test.test('normalizePlan handles array input', () => {
  resetRuntimeModules();
  const { normalizePlan } = require('../scripts/autonomous-workflow');
  const plan = normalizePlan(['Step one', 'Step two', '', '  '], 'wf-1');
  assert.equal(plan.workflowId, 'wf-1');
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].id, 'step_1');
  assert.equal(plan.steps[0].description, 'Step one');
  assert.equal(plan.steps[1].id, 'step_2');
  assert.match(plan.summary, /Step one \| Step two/);
});

test.test('normalizePlan handles object input with string and object steps', () => {
  resetRuntimeModules();
  const { normalizePlan } = require('../scripts/autonomous-workflow');
  const plan = normalizePlan({
    summary: 'custom summary',
    steps: [
      'string step',
      { id: 'explicit', description: 'object step' },
      { summary: 'fallback-summary' },
      null,
      42,
    ],
  }, 'wf-2');
  assert.equal(plan.workflowId, 'wf-2');
  assert.equal(plan.summary, 'custom summary');
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.steps[0].id, 'step_1');
  assert.equal(plan.steps[0].description, 'string step');
  assert.equal(plan.steps[1].id, 'explicit');
  assert.equal(plan.steps[1].description, 'object step');
  assert.equal(plan.steps[2].id, 'step_3');
  assert.equal(plan.steps[2].description, 'fallback-summary');
});

test.test('normalizePlan falls back to string summary when input is not array/object', () => {
  resetRuntimeModules();
  const { normalizePlan } = require('../scripts/autonomous-workflow');
  const plan = normalizePlan('only a summary', 'wf-3');
  assert.equal(plan.workflowId, 'wf-3');
  assert.equal(plan.summary, 'only a summary');
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].id, 'step_1');
  assert.equal(plan.steps[0].description, 'only a summary');
});

test.test('normalizePlan returns empty steps when summary defaults kick in', () => {
  resetRuntimeModules();
  const { normalizePlan } = require('../scripts/autonomous-workflow');
  const plan = normalizePlan(null, 'wf-4');
  assert.equal(plan.summary, 'Execution plan ready');
  // Default summary is not empty, so one step is generated
  assert.equal(plan.steps.length, 1);
});

test.test('getWorkflowPaths derives sibling artifact paths inside the workflow root', () => {
  resetRuntimeModules();
  const { getWorkflowPaths } = require('../scripts/autonomous-workflow');
  const paths = getWorkflowPaths('demo', '/tmp/proj');
  assert.equal(paths.rootDir, '/tmp/proj/.thumbgate/autonomous-workflows/demo');
  assert.equal(paths.checkpointPath, '/tmp/proj/.thumbgate/autonomous-workflows/demo/checkpoint.json');
  assert.equal(paths.reportJsonPath, '/tmp/proj/.thumbgate/autonomous-workflows/demo/report.json');
  assert.equal(paths.reportMdPath, '/tmp/proj/.thumbgate/autonomous-workflows/demo/report.md');
  assert.equal(paths.planPath, '/tmp/proj/.thumbgate/autonomous-workflows/demo/plan.json');
});

test.test('slugify strips leading and trailing dashes without regex backtracking', () => {
  resetRuntimeModules();
  const { slugify } = require('../scripts/autonomous-workflow');
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify('---foo---bar---'), 'foo-bar');
  assert.equal(slugify(''), 'workflow');
  assert.equal(slugify('', 'my-fallback'), 'my-fallback');
  assert.equal(slugify('---'), 'workflow');
  assert.equal(slugify(null), 'workflow');
  assert.equal(slugify(undefined), 'workflow');
  assert.equal(slugify(42), '42');
});

test.test('parseArgs extracts flags and key=value pairs from argv', () => {
  resetRuntimeModules();
  const { parseArgs } = require('../scripts/autonomous-workflow');
  const args = parseArgs(['--file=workflow.json', '--resume', 'positional', '--key=value=with=equals']);
  assert.equal(args.file, 'workflow.json');
  assert.equal(args.resume, true);
  assert.equal(args.key, 'value=with=equals');
  assert.equal(args.positional, undefined);
});
