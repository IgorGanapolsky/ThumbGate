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
