'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Set up temporary environment
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallel-workflow-test-'));
const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

// We need to require launcher and runner first to mock their exports before loading the orchestrator.
const launcher = require('../scripts/hosted-job-launcher');
const runner = require('../scripts/async-job-runner');

// In-memory mock job states
const mockJobStates = new Map();
const launchCalls = [];

// Apply mocks
launcher.launchManagedJob = (task, options) => {
  const jobId = `mock_job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  launchCalls.push({ jobId, task, options });

  // Initially queued / running
  mockJobStates.set(jobId, {
    status: 'running',
    currentContext: JSON.stringify({ message: `Executing ${task.name}` }),
    stageHistory: [],
    lastError: null,
  });

  return { jobId };
};

runner.readJobState = (jobId) => {
  return mockJobStates.get(jobId);
};

// Now require orchestrator, which receives the mocked functions
const {
  planWorkflow,
  executeWorkflow,
  compileWorkflowReport,
} = require('../scripts/parallel-workflow-orchestrator');

test.after(() => {
  // Restore env
  if (previousFeedbackDir === undefined) {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
  } else {
    process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('planWorkflow plans appropriate subtasks based on objective keywords', () => {
  // Security objective
  const secPlan = planWorkflow('Run security audit');
  assert.ok(secPlan.subtasks.length >= 2);
  const secNames = secPlan.subtasks.map(t => t.name);
  assert.ok(secNames.includes('scan_secrets'));
  assert.ok(secNames.includes('audit_dependencies'));

  // Performance objective
  const perfPlan = planWorkflow('Measure performance and run benchmark');
  assert.ok(perfPlan.subtasks.length >= 2);
  const perfNames = perfPlan.subtasks.map(t => t.name);
  assert.ok(perfNames.includes('benchmark_candidates'));
  assert.ok(perfNames.includes('check_budget'));

  // Fallback objective
  const fallPlan = planWorkflow('Explore project codebase');
  assert.ok(fallPlan.subtasks.length >= 2);
  const fallNames = fallPlan.subtasks.map(t => t.name);
  assert.ok(fallNames.includes('code_search'));
  assert.ok(fallNames.includes('check_integrity'));
});

test('executeWorkflow runs tasks concurrently, respects concurrency and compiles report', async () => {
  launchCalls.length = 0;
  mockJobStates.clear();

  // Objective fallback has 2 subtasks. Let's run with concurrency = 1 to test queueing.
  const workflowPromise = executeWorkflow('Explore project codebase', {
    concurrency: 1,
    cwd: tmpDir,
    timeoutMs: 1000,
  });

  // Wait a short tick to let the event loop spin and task queueing start
  await new Promise(resolve => setTimeout(resolve, 50));

  // With concurrency = 1, only the first task should be launched initially
  assert.equal(launchCalls.length, 1);
  const activeJobId = launchCalls[0].jobId;

  // Let the first task complete
  mockJobStates.set(activeJobId, {
    status: 'completed',
    currentContext: JSON.stringify({ integrity: 'passed' }),
  });

  // Wait for the poller to detect completion and schedule the next task
  await new Promise(resolve => setTimeout(resolve, 300));

  // Now the second task should have launched
  assert.equal(launchCalls.length, 2);
  const secondJobId = launchCalls[1].jobId;

  // Let the second task complete
  mockJobStates.set(secondJobId, {
    status: 'completed',
    currentContext: JSON.stringify({ search: 'done' }),
  });

  // Wait for workflow to finish and assert results
  const res = await workflowPromise;

  assert.equal(res.objective, 'Explore project codebase');
  assert.ok(res.workflowId.startsWith('wf_'));
  assert.ok(fs.existsSync(res.reportPath));
  assert.ok(fs.existsSync(path.join(path.dirname(res.reportPath), 'results.json')));

  const report = fs.readFileSync(res.reportPath, 'utf8');
  assert.ok(report.includes('Explore project codebase'));
  assert.ok(report.includes('✅ SUCCESS'));
});

test('executeWorkflow handles task timeouts', async () => {
  launchCalls.length = 0;
  mockJobStates.clear();

  // Running with a very short timeout
  const res = await executeWorkflow('security audit', {
    concurrency: 2,
    cwd: tmpDir,
    timeoutMs: 200,
  });

  // No mockJobStates are updated to 'completed', so they should timeout
  const failedOrTimedOut = res.results.filter(r => r.status === 'timeout');
  assert.ok(failedOrTimedOut.length > 0);

  const report = fs.readFileSync(res.reportPath, 'utf8');
  assert.ok(report.includes('TIMEOUT') || report.includes('timeout'));
  assert.ok(report.includes('COMPLETED WITH FAILURES'));
});
