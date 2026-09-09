'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-public-workflow-'));
const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const runner = require('../scripts/async-job-runner');
const {
  executeWorkflow,
  launchPublicManagedJob,
} = require('../scripts/parallel-workflow-orchestrator');

test.after(() => {
  if (previousFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
  else process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
  // launchPublicManagedJob spawns detached+unref workers that can recreate files
  // while rimraf walks tmpDir (Trunk queue #3836: ENOTEMPTY hookFailed).
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  } catch {
    // leftover unref'd writers after retries must not fail the file
  }
});

test('public-package workflow launcher runs durable jobs and preserves failures', async () => {
  const plan = {
    objective: 'public workflow regression',
    plannedAt: new Date().toISOString(),
    subtasks: [
      {
        id: 'public-success',
        name: 'public_success',
        tags: ['test'],
        autoImprove: false,
        verificationMode: 'none',
        recordFeedback: false,
        stages: [{ name: 'complete', context: 'durable public worker completed' }],
      },
      {
        id: 'public-failure',
        name: 'public_failure',
        tags: ['test'],
        autoImprove: false,
        verificationMode: 'none',
        recordFeedback: false,
        stages: [{ name: 'fail', command: `${process.execPath} -e "process.exit(7)"` }],
      },
    ],
  };

  const result = await executeWorkflow(plan.objective, {
    plan,
    concurrency: 2,
    timeoutMs: 5000,
    cwd: path.resolve(__dirname, '..'),
    launchManagedJob: launchPublicManagedJob,
    readJobState: runner.readJobState,
  });

  assert.equal(result.results.length, 2);
  assert.equal(result.results.find((entry) => entry.taskId === 'public-success').status, 'completed');
  const failure = result.results.find((entry) => entry.taskId === 'public-failure');
  assert.equal(failure.status, 'failed');
  assert.equal(failure.lastError.code, 'JOB_STAGE_FAILED');
  assert.ok(fs.existsSync(result.statePath));
  assert.ok(fs.existsSync(result.reportPath));
  const state = JSON.parse(fs.readFileSync(result.statePath, 'utf8'));
  assert.equal(state.status, 'completed_with_failures');
  assert.equal(state.activeJobs.length, 0);
});
