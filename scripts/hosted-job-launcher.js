'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const runner = require('./async-job-runner');
const { buildHarnessJob } = require('./natural-language-harness');
const { ensureDir } = require('./fs-utils');

const RUNNER_SCRIPT_PATH = path.join(__dirname, 'async-job-runner.js');
const MANAGED_DPO_EXPORT_SCRIPT_PATH = path.join(__dirname, 'managed-dpo-export.js');
const BACKGROUND_LAUNCH_MODE = 'background';
const INLINE_LAUNCH_MODE = 'inline';
const IDLE_JOB_STATUSES = new Set(['queued', 'paused', 'resume_requested']);

function nowIso() {
  return new Date().toISOString();
}


function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function createHostedJobId(prefix = 'job') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getStatePath(jobId) {
  return runner.getJobRuntimePaths(jobId).statePath;
}

function writeStateFile(jobId, state) {
  const statePath = getStatePath(jobId);
  ensureDir(path.dirname(statePath));
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return state;
}

function updateIdleJobState(jobId, updater) {
  const state = runner.readJobState(jobId);
  if (!state) {
    const error = new Error(`No persisted state found for job ${jobId}`);
    error.statusCode = 404;
    throw error;
  }

  if (!IDLE_JOB_STATUSES.has(state.status)) {
    const error = new Error(`Job ${jobId} is not idle; current status is ${state.status}`);
    error.statusCode = 409;
    throw error;
  }

  return writeStateFile(jobId, updater({ ...state }));
}

function writeJobFile(jobId, jobSpec) {
  const { jobDir } = runner.getJobRuntimePaths(jobId);
  ensureDir(jobDir);
  const jobFilePath = path.join(jobDir, 'job.json');
  fs.writeFileSync(jobFilePath, JSON.stringify(jobSpec, null, 2) + '\n', 'utf8');
  return jobFilePath;
}

function runInlineJob(args) {
  if (args.runFile) {
    runner.runJobFromFile(args.runFile);
    return;
  }

  if (args.resumeJobId) {
    runner.resumeJob(args.resumeJobId);
    return;
  }

  throw new Error('Unsupported inline hosted job launch');
}

function launchRunner(args, options = {}) {
  const launchMode = options.launchMode || process.env.THUMBGATE_HOSTED_JOB_LAUNCH_MODE || BACKGROUND_LAUNCH_MODE;
  if (launchMode === INLINE_LAUNCH_MODE) {
    runInlineJob(args);
    return {
      launchMode,
      pid: process.pid,
    };
  }

  const runnerArgs = [];
  if (args.runFile) {
    runnerArgs.push(`--run-file=${args.runFile}`);
  } else if (args.resumeJobId) {
    runnerArgs.push(`--resume=${args.resumeJobId}`);
  } else {
    throw new Error('Hosted job launch requires runFile or resumeJobId');
  }

  const child = spawn(process.execPath, [RUNNER_SCRIPT_PATH, ...runnerArgs], {
    cwd: options.cwd || process.cwd(),
    env: process.env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return {
    launchMode,
    pid: child.pid,
  };
}

function prepareManagedJob(jobSpec, options = {}) {
  const jobId = options.jobId || jobSpec.id || createHostedJobId(options.jobPrefix || 'job');
  const finalSpec = {
    ...jobSpec,
    id: jobId,
  };
  const jobFilePath = writeJobFile(jobId, finalSpec);
  const queuedState = runner.queueJob({
    ...finalSpec,
    jobFilePath,
  });
  return {
    jobId,
    jobFilePath,
    state: queuedState,
    jobSpec: {
      ...finalSpec,
      jobFilePath,
    },
  };
}

function launchManagedJob(jobSpec, options = {}) {
  const prepared = prepareManagedJob(jobSpec, options);
  const launch = launchRunner({ runFile: prepared.jobFilePath }, options);
  return {
    jobId: prepared.jobId,
    jobFilePath: prepared.jobFilePath,
    launchMode: launch.launchMode,
    pid: launch.pid || null,
    state: runner.readJobState(prepared.jobId) || prepared.state,
  };
}

function buildManagedDpoExportJob(params = {}) {
  const command = [
    shellQuote(process.execPath),
    shellQuote(MANAGED_DPO_EXPORT_SCRIPT_PATH),
  ];

  if (params.inputPath) {
    command.push('--inputPath', shellQuote(params.inputPath));
  } else if (params.memoryLogPath) {
    command.push('--memoryLogPath', shellQuote(params.memoryLogPath));
  }

  if (params.outputPath) {
    command.push('--outputPath', shellQuote(params.outputPath));
  }

  return {
    tags: ['hosted-job', 'dpo-export'],
    skill: 'hosted-dpo-export',
    autoImprove: false,
    verificationMode: 'none',
    recordFeedback: false,
    stages: [
      {
        name: 'export_dpo_pairs',
        command: command.join(' '),
      },
    ],
  };
}

function launchDpoExportJob(params = {}, options = {}) {
  return launchManagedJob(buildManagedDpoExportJob(params), {
    ...options,
    jobPrefix: 'dpo_export',
  });
}

function launchHarnessJob(identifier, inputs = {}, options = {}) {
  const jobId = options.jobId || createHostedJobId('harness');
  const jobSpec = buildHarnessJob(identifier, inputs, {
    jobId,
    skill: options.skill,
    partnerProfile: options.partnerProfile,
    autoImprove: options.autoImprove,
  });
  return launchManagedJob(jobSpec, {
    ...options,
    jobId,
    jobPrefix: 'harness',
  });
}

function resumeHostedJob(jobId, options = {}) {
  const state = runner.readJobState(jobId);
  if (!state) {
    const error = new Error(`No persisted state found for job ${jobId}`);
    error.statusCode = 404;
    throw error;
  }

  if (['completed', 'failed', 'cancelled'].includes(state.status)) {
    const error = new Error(`Job ${jobId} is already ${state.status}`);
    error.statusCode = 409;
    throw error;
  }

  const launch = launchRunner({ resumeJobId: jobId }, options);
  return {
    jobId,
    launchMode: launch.launchMode,
    pid: launch.pid || null,
    state: runner.readJobState(jobId) || state,
  };
}

function pauseQueuedJob(jobId, metadata = {}) {
  runner.clearJobControl(jobId);
  return updateIdleJobState(jobId, (state) => ({
    ...state,
    status: 'paused',
    updatedAt: nowIso(),
    pausedAt: nowIso(),
    stopReason: metadata && metadata.reason ? metadata.reason : 'pause_requested',
  }));
}

function cancelQueuedJob(jobId, metadata = {}) {
  runner.clearJobControl(jobId);
  return updateIdleJobState(jobId, (state) => ({
    ...state,
    status: 'cancelled',
    updatedAt: nowIso(),
    endedAt: nowIso(),
    stopReason: metadata && metadata.reason ? metadata.reason : 'cancel_requested',
  }));
}

module.exports = {
  BACKGROUND_LAUNCH_MODE,
  INLINE_LAUNCH_MODE,
  buildManagedDpoExportJob,
  cancelQueuedJob,
  createHostedJobId,
  launchDpoExportJob,
  launchHarnessJob,
  launchManagedJob,
  pauseQueuedJob,
  prepareManagedJob,
  resumeHostedJob,
};
