'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getFeedbackPaths } = require('./feedback-loop');
const { ensureDir } = require('./fs-utils');
const { loadOptionalModule } = require('./private-core-boundary');

const RUNNER_SCRIPT_PATH = path.join(__dirname, 'async-job-runner.js');

function launchPublicManagedJob(jobSpec, options = {}) {
  const publicRunner = require('./async-job-runner');
  const jobId = options.jobId || jobSpec.id || `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { jobDir } = publicRunner.getJobRuntimePaths(jobId);
  ensureDir(jobDir);
  const jobFilePath = path.join(jobDir, 'job.json');
  const finalSpec = { ...jobSpec, id: jobId };
  fs.writeFileSync(jobFilePath, `${JSON.stringify(finalSpec, null, 2)}\n`, 'utf8');
  publicRunner.queueJob({ ...finalSpec, jobFilePath });
  const child = spawn(process.execPath, [RUNNER_SCRIPT_PATH, `--run-file=${jobFilePath}`], {
    cwd: options.cwd || process.cwd(),
    env: process.env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return {
    jobId,
    jobFilePath,
    launchMode: 'public-background',
    pid: child.pid || null,
  };
}

const launcher = loadOptionalModule(path.join(__dirname, 'hosted-job-launcher'), () => ({
  launchManagedJob: launchPublicManagedJob,
}));

const runner = loadOptionalModule(path.join(__dirname, 'async-job-runner'), () => ({
  readJobState: () => null,
  listJobStates: () => [],
}));

const { launchManagedJob } = launcher;
const { readJobState } = runner;

const DEFAULT_CONCURRENCY = 3;
const POLL_INTERVAL_MS = 200;

function nowIso() {
  return new Date().toISOString();
}

/**
 * Dynamically decompose a high-level objective into parallel, specialized subtasks.
 * Supports rule-based fallback and can be extended to use LLM planning.
 */
function planWorkflow(objective) {
  const obj = (objective || '').toLowerCase().trim();
  const subtasks = [];

  if (obj.includes('security') || obj.includes('audit') || obj.includes('leak') || obj.includes('secret')) {
    subtasks.push({
      name: 'scan_secrets',
      tags: ['security', 'secret-scanner'],
      stages: [
        {
          name: 'secret_scan',
          command: 'node scripts/secret-scanner.js --json',
        }
      ]
    });
    subtasks.push({
      name: 'audit_dependencies',
      tags: ['security', 'dependencies'],
      stages: [
        {
          name: 'npm_audit',
          command: 'npm audit --json',
        }
      ]
    });
    subtasks.push({
      name: 'check_permissions',
      tags: ['security', 'credentials'],
      stages: [
        {
          name: 'credential_gate_check',
          command: 'node scripts/single-use-credential-gate.js plan',
        }
      ]
    });
  } else if (obj.includes('performance') || obj.includes('benchmark') || obj.includes('bench')) {
    subtasks.push({
      name: 'benchmark_candidates',
      tags: ['performance', 'bench'],
      stages: [
        {
          name: 'run_bench',
          command: 'npx thumbgate bench --json --min-score=90',
        }
      ]
    });
    subtasks.push({
      name: 'check_budget',
      tags: ['performance', 'budget'],
      stages: [
        {
          name: 'budget_status',
          command: 'node scripts/budget-guard.js --status',
        }
      ]
    });
  } else {
    // Default general-purpose fallback workflow: code search and check integrity
    subtasks.push({
      name: 'code_search',
      tags: ['exploration'],
      stages: [
        {
          name: 'search_fs',
          command: 'node scripts/filesystem-search.js --query="pretool" --limit=5',
        }
      ]
    });
    subtasks.push({
      name: 'check_integrity',
      tags: ['integrity'],
      stages: [
        {
          name: 'ops_integrity',
          command: 'node scripts/operational-integrity.js --ci',
        }
      ]
    });
  }

  return {
    objective,
    plannedAt: nowIso(),
    subtasks: subtasks.map((task, idx) => ({
      ...task,
      id: `subtask_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      autoImprove: false,
      verificationMode: 'none',
      recordFeedback: false,
    })),
  };
}

/**
 * Execute a list of planned subtasks in parallel, respecting a concurrency limit.
 * Polls active jobs until all complete, then consolidates the results.
 */
async function executeWorkflow(objective, options = {}) {
  const plan = options.plan || planWorkflow(objective);
  const concurrency = Number(options.concurrency) || DEFAULT_CONCURRENCY;
  const timeoutMs = Number(options.timeoutMs) || 60000; // 60s timeout safety
  const launchJob = options.launchManagedJob || launchManagedJob;
  const getJobState = options.readJobState || readJobState;

  const { FEEDBACK_DIR } = getFeedbackPaths();
  const workflowId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const workflowDir = path.join(FEEDBACK_DIR, 'workflows', workflowId);
  ensureDir(workflowDir);

  const activeJobs = new Map();
  const queue = [...plan.subtasks];
  const results = [];
  const start = Date.now();
  const statePath = path.join(workflowDir, 'state.json');

  const persistState = (status) => {
    fs.writeFileSync(statePath, `${JSON.stringify({
      workflowId,
      objective,
      status,
      updatedAt: nowIso(),
      queue: queue.map((task) => ({ id: task.id, name: task.name })),
      activeJobs: [...activeJobs.entries()].map(([taskId, info]) => ({ taskId, ...info })),
      results,
    }, null, 2)}\n`, 'utf8');
  };

  const runNext = () => {
    while (activeJobs.size < concurrency && queue.length > 0) {
      const task = queue.shift();
      const launched = launchJob(task, { cwd: options.cwd });
      activeJobs.set(task.id, {
        jobId: launched.jobId,
        taskName: task.name,
        launchedAt: Date.now(),
        pid: launched.pid || null,
        launchMode: launched.launchMode || 'managed',
      });
    }
    persistState('running');
  };

  runNext();

  // Polling loop
  await new Promise((resolve) => {
    const interval = setInterval(() => {
      let allDone = true;

      for (const [taskId, info] of activeJobs.entries()) {
        const jobState = getJobState(info.jobId);
        if (!jobState) {
          allDone = false;
          continue;
        }

        const isTerminal = ['completed', 'failed', 'cancelled'].includes(jobState.status);
        if (isTerminal) {
          results.push({
            taskId,
            taskName: info.taskName,
            jobId: info.jobId,
            status: jobState.status,
            context: jobState.currentContext,
            stageHistory: jobState.stageHistory,
            lastError: jobState.lastError,
          });
          activeJobs.delete(taskId);
          runNext();
        } else {
          allDone = false;
        }
      }

      const elapsed = Date.now() - start;
      if (allDone && queue.length === 0) {
        clearInterval(interval);
        persistState(results.every((result) => result.status === 'completed')
          ? 'completed'
          : 'completed_with_failures');
        resolve();
      } else if (elapsed >= timeoutMs) {
        clearInterval(interval);
        // Timeout remaining active tasks
        for (const [taskId, info] of activeJobs.entries()) {
          if (info.pid) {
            try {
              process.kill(process.platform === 'win32' ? info.pid : -info.pid, 'SIGTERM');
            } catch {
              // The worker may have exited between the last poll and timeout.
            }
          }
          results.push({
            taskId,
            taskName: info.taskName,
            jobId: info.jobId,
            status: 'timeout',
            lastError: { message: `Subtask timed out after ${timeoutMs}ms`, code: 'TIMEOUT' },
          });
        }
        for (const task of queue.splice(0)) {
          results.push({
            taskId: task.id,
            taskName: task.name,
            jobId: null,
            status: 'timeout',
            lastError: { message: `Subtask was not launched before ${timeoutMs}ms`, code: 'TIMEOUT' },
          });
        }
        activeJobs.clear();
        persistState('timed_out');
        resolve();
      }
    }, POLL_INTERVAL_MS);
  });

  const durationMs = Date.now() - start;

  // Compile final markdown report
  const reportPath = path.join(workflowDir, 'report.md');
  const reportContent = compileWorkflowReport(plan, results, durationMs, workflowId);
  fs.writeFileSync(reportPath, reportContent, 'utf8');

  // Also save the raw execution results JSON
  const resultsJsonPath = path.join(workflowDir, 'results.json');
  fs.writeFileSync(resultsJsonPath, JSON.stringify({
    workflowId,
    objective,
    durationMs,
    plan,
    results,
  }, null, 2) + '\n', 'utf8');

  return {
    workflowId,
    objective,
    durationMs,
    reportPath,
    results,
    statePath,
  };
}

function compileWorkflowReport(plan, results, durationMs, workflowId) {
  const timestamp = nowIso();
  const totalSubtasks = plan.subtasks.length;
  const completed = results.filter((r) => r.status === 'completed').length;
  const failed = results.filter((r) => r.status === 'failed' || r.status === 'timeout').length;

  let report = `# Dynamic Workflow Execution Report: ${workflowId}\n\n`;
  report += `**Objective:** ${plan.objective}\n`;
  report += `**Executed At:** ${timestamp}\n`;
  report += `**Duration:** ${(durationMs / 1000).toFixed(2)}s\n`;
  report += `**Status:** ${completed === totalSubtasks ? '✅ SUCCESS' : '⚠️ COMPLETED WITH FAILURES'}\n\n`;

  report += `## Summary\n`;
  report += `- Total planned subtasks: ${totalSubtasks}\n`;
  report += `- Completed successfully: ${completed}\n`;
  report += `- Failed/Timed out: ${failed}\n\n`;

  report += `## Subtask Breakdown\n\n`;

  for (const res of results) {
    const taskPlan = plan.subtasks.find((t) => t.id === res.taskId) || {};
    const commandUsed = taskPlan.stages && taskPlan.stages[0] ? taskPlan.stages[0].command : 'N/A';
    
    report += `### ✦ Subtask: \`${res.taskName}\`\n`;
    report += `- **Job ID:** \`${res.jobId}\`\n`;
    report += `- **Status:** ${res.status === 'completed' ? '✅ COMPLETED' : '❌ ' + res.status.toUpperCase()}\n`;
    report += `- **Command Run:** \`${commandUsed}\`\n`;
    
    if (res.lastError) {
      report += `- **Error:** \`${res.lastError.message}\` (Code: \`${res.lastError.code}\`)\n`;
    }
    
    if (res.context) {
      report += `\n**Output Context Preview:**\n\`\`\`json\n`;
      try {
        // Try parsing output context as JSON for clean formatting
        const parsed = JSON.parse(res.context);
        report += JSON.stringify(parsed, null, 2);
      } catch {
        report += res.context.slice(0, 1000) + (res.context.length > 1000 ? '\n... (truncated)' : '');
      }
      report += `\n\`\`\`\n`;
    }
    report += `\n---\n\n`;
  }

  return report;
}

module.exports = {
  planWorkflow,
  executeWorkflow,
  compileWorkflowReport,
  launchPublicManagedJob,
};
