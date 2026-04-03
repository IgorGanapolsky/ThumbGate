'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { captureFeedback, analyzeFeedback, getFeedbackPaths, readJSONL } = require('./feedback-loop');
const { runVerificationLoop } = require('./verification-loop');
const { createExperiment } = require('./experiment-tracker');
const { recommendEvolutionTarget } = require('./workspace-evolver');

const JOB_LOG_FILENAME = 'job-log.jsonl';
const JOB_CONTROL_FILENAME = 'job-control.json';
const JOB_STATE_DIRNAME = 'jobs';

const RESUMABLE_STATUSES = new Set(['paused', 'running', 'resume_requested']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const CONTROL_ACTIONS = new Set(['pause', 'cancel', 'resume']);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function nowIso() {
  return new Date().toISOString();
}

function generateJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function appendJSONL(filePath, record) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

function getJobRuntimePaths(jobId) {
  const { FEEDBACK_DIR } = getFeedbackPaths();
  const jobsDir = path.join(FEEDBACK_DIR, JOB_STATE_DIRNAME);
  const jobDir = jobId ? path.join(jobsDir, jobId) : null;
  return {
    feedbackDir: FEEDBACK_DIR,
    jobsDir,
    jobDir,
    statePath: jobDir ? path.join(jobDir, 'state.json') : null,
    controlPath: jobDir ? path.join(jobDir, JOB_CONTROL_FILENAME) : null,
    logPath: path.join(FEEDBACK_DIR, JOB_LOG_FILENAME),
  };
}

/**
 * Recall relevant context before executing a task.
 * Pulls recent feedback analysis and prevention rules for the given domain.
 *
 * @param {object} params
 * @param {string[]} [params.tags] - Domain tags to filter context
 * @returns {object} { approvalRate, riskDomains, recommendations }
 */
function recallContext(params) {
  const analysis = analyzeFeedback();
  const { MEMORY_LOG_PATH } = getFeedbackPaths();
  const memories = readJSONL(MEMORY_LOG_PATH);
  const errorMemories = memories.filter((memory) => memory.category === 'error');

  const tags = Array.isArray(params.tags) ? params.tags : [];
  let riskDomains = [];

  if (analysis.boostedRisk && Array.isArray(analysis.boostedRisk.highRiskDomains)) {
    riskDomains = analysis.boostedRisk.highRiskDomains
      .filter((domain) => !tags.length || tags.some((tag) => domain.key.includes(tag)))
      .map((domain) => ({ domain: domain.key, riskRate: domain.riskRate }));
  }

  return {
    totalFeedback: analysis.total,
    approvalRate: analysis.approvalRate,
    recentRate: analysis.recentRate,
    riskDomains,
    preventionRuleCount: errorMemories.length,
    recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations.slice(0, 5) : [],
  };
}

function normalizeStages(job) {
  if (Array.isArray(job.stages) && job.stages.length > 0) {
    return job.stages.map((stage, index) => ({
      ...(typeof stage === 'object' && stage ? stage : { context: String(stage || '') }),
      name: stage && stage.name ? stage.name : `stage_${index + 1}`,
    }));
  }

  if (typeof job.taskFn === 'function') {
    return [{ name: 'task', taskFn: job.taskFn }];
  }

  return [{
    name: 'task',
    context: typeof job.context === 'string' ? job.context : '',
  }];
}

function serializeStage(stage) {
  const serialized = { name: stage.name };
  if (typeof stage.context === 'string') serialized.context = stage.context;
  if (typeof stage.appendContext === 'string') serialized.appendContext = stage.appendContext;
  if (typeof stage.command === 'string') serialized.command = stage.command;
  if (typeof stage.workingDirectory === 'string') serialized.workingDirectory = stage.workingDirectory;
  return serialized;
}

function serializeJobForState(job) {
  const stages = normalizeStages(job).map(serializeStage);
  return {
    id: job.id || null,
    tags: Array.isArray(job.tags) ? job.tags : [],
    skill: job.skill || null,
    partnerProfile: job.partnerProfile || null,
    autoImprove: job.autoImprove !== false,
    jobFilePath: job.jobFilePath || null,
    stages,
  };
}

function readJobState(jobId) {
  if (!jobId) return null;
  return readJson(getJobRuntimePaths(jobId).statePath);
}

function writeJobState(state) {
  const paths = getJobRuntimePaths(state.jobId);
  ensureDir(paths.jobDir);
  writeJson(paths.statePath, state);
  return state;
}

function listJobStates(options = {}) {
  const { jobsDir } = getJobRuntimePaths();
  if (!fs.existsSync(jobsDir)) return [];

  const statuses = Array.isArray(options.statuses) && options.statuses.length > 0
    ? new Set(options.statuses)
    : null;

  const results = fs.readdirSync(jobsDir)
    .map((entry) => readJson(path.join(jobsDir, entry, 'state.json')))
    .filter(Boolean)
    .filter((entry) => !statuses || statuses.has(entry.status))
    .sort((left, right) => {
      const leftTs = Date.parse(left.updatedAt || left.startedAt || left.createdAt || 0);
      const rightTs = Date.parse(right.updatedAt || right.startedAt || right.createdAt || 0);
      return rightTs - leftTs;
    });

  const limit = Number(options.limit || 0);
  return limit > 0 ? results.slice(0, limit) : results;
}

function readJobControl(jobId) {
  if (!jobId) return null;
  return readJson(getJobRuntimePaths(jobId).controlPath);
}

function clearJobControl(jobId) {
  if (!jobId) return;
  const { controlPath } = getJobRuntimePaths(jobId);
  if (controlPath && fs.existsSync(controlPath)) {
    fs.unlinkSync(controlPath);
  }
}

function requestJobControl(jobId, action, metadata = {}) {
  if (!jobId) throw new Error('requestJobControl requires jobId');
  if (!CONTROL_ACTIONS.has(action)) {
    throw new Error(`Unsupported control action: ${action}`);
  }

  const requestedAt = nowIso();
  const control = {
    jobId,
    action,
    metadata: metadata || {},
    requestedAt,
  };
  const { controlPath } = getJobRuntimePaths(jobId);
  writeJson(controlPath, control);

  if (action === 'resume') {
    const state = readJobState(jobId);
    if (state && !TERMINAL_STATUSES.has(state.status)) {
      writeJobState({
        ...state,
        status: 'resume_requested',
        updatedAt: requestedAt,
      });
    }
  }

  return control;
}

function buildExecutionSummary(state) {
  return {
    totalStages: state.totalStages || 0,
    completedStages: Array.isArray(state.stageHistory) ? state.stageHistory.length : 0,
    nextStageIndex: state.nextStageIndex || 0,
    currentStage: state.currentStage || null,
    checkpointCount: Array.isArray(state.checkpoints) ? state.checkpoints.length : 0,
    jobFilePath: state.jobFilePath || null,
  };
}

function buildResult({ state, recall, verification, feedback, improvementExperiment }) {
  const startedAtMs = Date.parse(state.startedAt || state.createdAt || nowIso());
  const durationMs = Number.isFinite(startedAtMs)
    ? Math.max(0, Date.now() - startedAtMs)
    : 0;

  return {
    jobId: state.jobId,
    status: state.status,
    phases: {
      recall: {
        approvalRate: recall.approvalRate,
        preventionRuleCount: recall.preventionRuleCount,
        riskDomains: recall.riskDomains,
      },
      execution: buildExecutionSummary(state),
      verification: verification ? {
        accepted: verification.accepted,
        attempts: verification.attempts,
        score: verification.finalVerification ? verification.finalVerification.score : 0,
        partnerProfile: verification.partnerStrategy.profile,
        verificationMode: verification.partnerStrategy.verificationMode,
        reward: verification.partnerReward.reward,
      } : null,
      feedback: feedback ? {
        accepted: feedback.accepted,
        status: feedback.status,
      } : null,
      evolution: improvementExperiment ? {
        experimentId: improvementExperiment.id,
        mutationType: improvementExperiment.mutationType,
      } : null,
    },
    durationMs,
    timestamp: nowIso(),
  };
}

function appendJobLog(result) {
  appendJSONL(getJobRuntimePaths(result.jobId).logPath, result);
}

function readJobLog(limit) {
  const entries = readJSONL(getJobRuntimePaths().logPath);
  return limit ? entries.slice(-limit) : entries;
}

function getJobStats() {
  const entries = readJobLog();
  if (entries.length === 0) {
    return {
      totalJobs: 0,
      completed: 0,
      failed: 0,
      paused: 0,
      cancelled: 0,
      avgDurationMs: 0,
      avgAttempts: 0,
    };
  }

  const completed = entries.filter((entry) => entry.status === 'completed').length;
  const failed = entries.filter((entry) => entry.status === 'failed').length;
  const paused = entries.filter((entry) => entry.status === 'paused').length;
  const cancelled = entries.filter((entry) => entry.status === 'cancelled').length;
  const totalDuration = entries.reduce((sum, entry) => sum + (entry.durationMs || 0), 0);
  const totalAttempts = entries.reduce((sum, entry) => {
    return sum + ((entry.phases && entry.phases.verification && entry.phases.verification.attempts) || 0);
  }, 0);

  return {
    totalJobs: entries.length,
    completed,
    failed,
    paused,
    cancelled,
    successRate: Math.round((completed / entries.length) * 1000) / 1000,
    avgDurationMs: Math.round(totalDuration / entries.length),
    avgAttempts: Math.round((totalAttempts / Math.max(entries.length, 1)) * 100) / 100,
  };
}

function shellConfig(command) {
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', command],
    };
  }

  return {
    command: process.env.SHELL || '/bin/sh',
    args: ['-lc', command],
  };
}

function normalizeStageResult(result, currentContext) {
  if (typeof result === 'string') {
    return { context: result };
  }

  if (result == null) {
    return { context: currentContext };
  }

  if (typeof result !== 'object') {
    return { context: String(result) };
  }

  return {
    ...result,
    context: typeof result.context === 'string' ? result.context : undefined,
    appendContext: typeof result.appendContext === 'string' ? result.appendContext : undefined,
  };
}

function applyStageContext(currentContext, stageResult) {
  if (typeof stageResult.context === 'string') {
    return stageResult.context;
  }

  if (typeof stageResult.appendContext === 'string') {
    return [currentContext, stageResult.appendContext].filter(Boolean).join('\n');
  }

  return currentContext;
}

function runCommandStage(stage) {
  const shell = shellConfig(stage.command);
  const result = spawnSync(shell.command, shell.args, {
    cwd: stage.workingDirectory || process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const error = new Error([
      `Stage "${stage.name}" command failed`,
      stderr || stdout || `exit ${result.status}`,
    ].join(': '));
    error.code = 'JOB_STAGE_FAILED';
    error.stdout = result.stdout || '';
    error.stderr = result.stderr || '';
    throw error;
  }

  const stdout = (result.stdout || '').trim();
  return stdout ? { context: stdout } : {};
}

function createExecutionController(jobId, recall, sharedState) {
  return {
    jobId,
    recall,
    checkpoint(label, data = {}) {
      const latest = readJobState(jobId) || sharedState;
      const timestamp = nowIso();
      const checkpoint = {
        label: label || `checkpoint_${(latest.checkpoints || []).length + 1}`,
        stageIndex: latest.nextStageIndex || 0,
        timestamp,
        ...data,
      };
      const updated = {
        ...latest,
        checkpoints: [...(latest.checkpoints || []), checkpoint],
        updatedAt: timestamp,
      };
      if (typeof data.context === 'string') {
        updated.currentContext = data.context;
      }
      writeJobState(updated);
      Object.assign(sharedState, updated);
      return checkpoint;
    },
    getState() {
      return readJobState(jobId) || sharedState;
    },
    readControl() {
      return readJobControl(jobId);
    },
    requestPause(metadata = {}) {
      return requestJobControl(jobId, 'pause', metadata);
    },
    requestCancel(metadata = {}) {
      return requestJobControl(jobId, 'cancel', metadata);
    },
    shouldPause() {
      const control = readJobControl(jobId);
      return Boolean(control && control.action === 'pause');
    },
    throwIfCancelled() {
      const control = readJobControl(jobId);
      if (control && control.action === 'cancel') {
        const error = new Error('Job cancelled');
        error.code = 'JOB_CANCELLED';
        throw error;
      }
    },
  };
}

function maybeFinishFromControl(jobId, state, recall) {
  const control = readJobControl(jobId);
  if (!control) return null;

  if (control.action === 'resume') {
    clearJobControl(jobId);
    const resumed = writeJobState({
      ...state,
      status: 'running',
      updatedAt: nowIso(),
      resumedAt: nowIso(),
    });
    Object.assign(state, resumed);
    return null;
  }

  if (control.action === 'pause') {
    const pausedState = writeJobState({
      ...state,
      status: 'paused',
      updatedAt: nowIso(),
      pausedAt: nowIso(),
      stopReason: 'pause_requested',
    });
    clearJobControl(jobId);
    const result = buildResult({
      state: pausedState,
      recall,
      verification: null,
      feedback: null,
      improvementExperiment: null,
    });
    appendJobLog(result);
    return result;
  }

  if (control.action === 'cancel') {
    const cancelledState = writeJobState({
      ...state,
      status: 'cancelled',
      updatedAt: nowIso(),
      endedAt: nowIso(),
      stopReason: 'cancel_requested',
    });
    clearJobControl(jobId);
    const result = buildResult({
      state: cancelledState,
      recall,
      verification: null,
      feedback: null,
      improvementExperiment: null,
    });
    appendJobLog(result);
    return result;
  }

  return null;
}

function maybeQueueImprovementExperiment(job, state, recall, failure) {
  if (job.autoImprove === false) return null;

  const recommendations = Array.isArray(recall.recommendations) ? recall.recommendations.slice(0, 2) : [];
  const recommendedTarget = recommendEvolutionTarget({
    failureType: failure ? failure.type : null,
    tags: Array.isArray(job.tags) ? job.tags : [],
  });
  let summary = 'Improve the job prompt or stage plan to reduce runtime failures.';
  let mutation = {
    source: 'async-job-runner',
    jobId: state.jobId,
    jobFilePath: state.jobFilePath || null,
    stage: state.currentStage || null,
    recommendations,
    recommendedTarget,
    evolutionCommand: `node scripts/workspace-evolver.js --run --target=${recommendedTarget} --primary="npm test" --holdout="npm run self-heal:check"`,
  };

  if (failure && failure.type === 'verification') {
    const firstViolation = failure.verification.finalVerification
      && Array.isArray(failure.verification.finalVerification.violations)
      ? failure.verification.finalVerification.violations[0]
      : null;
    summary = firstViolation && firstViolation.avoidRule
      ? firstViolation.avoidRule
      : 'Improve the output so it avoids known mistake patterns.';
    mutation = {
      ...mutation,
      failureType: 'verification',
      attempts: failure.verification.attempts,
      violationPattern: firstViolation ? firstViolation.pattern : null,
      avoidRule: firstViolation ? firstViolation.avoidRule : null,
    };
  } else if (failure && failure.type === 'execution') {
    summary = failure.error && failure.error.message
      ? failure.error.message
      : 'A stage failed before verification.';
    mutation = {
      ...mutation,
      failureType: 'execution',
      errorCode: failure.error && failure.error.code ? failure.error.code : null,
      errorMessage: failure.error && failure.error.message ? failure.error.message : 'unknown execution error',
    };
  }

  try {
    return createExperiment({
      name: `job:${state.jobId}:${failure ? failure.type : 'followup'}`,
      hypothesis: [summary, ...recommendations].filter(Boolean).join(' '),
      mutationType: 'prompt',
      mutation,
    });
  } catch {
    return null;
  }
}

function runStage(stage, recall, currentContext, controller) {
  if (typeof stage.taskFn === 'function') {
    return normalizeStageResult(stage.taskFn({
      recall,
      currentContext,
      controller,
      stage,
      state: controller.getState(),
    }), currentContext);
  }

  if (typeof stage.run === 'function') {
    return normalizeStageResult(stage.run({
      recall,
      currentContext,
      controller,
      stage,
      state: controller.getState(),
    }), currentContext);
  }

  if (typeof stage.command === 'string') {
    return normalizeStageResult(runCommandStage(stage), currentContext);
  }

  if (typeof stage.context === 'string') {
    return { context: stage.context };
  }

  if (typeof stage.appendContext === 'string') {
    return { appendContext: stage.appendContext };
  }

  return { context: currentContext };
}

function resumeJob(jobId, job = null, options = {}) {
  const state = readJobState(jobId);
  if (!state) {
    throw new Error(`No persisted state found for job ${jobId}`);
  }

  if (state.jobFilePath) {
    return runJobFromFile(state.jobFilePath, { ...options, resume: true });
  }

  if (job) {
    return executeJob({ ...job, id: jobId }, { ...options, resume: true, previousState: state });
  }

  if (state.jobSpec && Array.isArray(state.jobSpec.stages) && state.jobSpec.stages.length > 0) {
    return executeJob({ ...state.jobSpec, id: jobId }, { ...options, resume: true, previousState: state });
  }

  throw new Error(`Job ${jobId} cannot be resumed automatically without a job file or serializable stages`);
}

/**
 * Execute a single job through the full pipeline: recall → stages → verify → feedback.
 *
 * @param {object} job
 * @returns {object} Job execution result
 */
function executeJob(job, options = {}) {
  const started = Date.now();
  const normalizedJob = {
    ...job,
    id: job.id || generateJobId(),
    tags: Array.isArray(job.tags) ? job.tags : [],
    autoImprove: job.autoImprove !== false,
    stages: normalizeStages(job),
  };
  const previousState = options.previousState || readJobState(normalizedJob.id);
  const shouldResume = Boolean(
    previousState
    && RESUMABLE_STATUSES.has(previousState.status)
    && (options.resume === true || normalizedJob.autoResume !== false)
  );

  const recall = recallContext({ tags: normalizedJob.tags });
  let currentContext = shouldResume ? (previousState.currentContext || '') : '';
  let nextStageIndex = shouldResume ? (previousState.nextStageIndex || 0) : 0;

  const state = writeJobState({
    jobId: normalizedJob.id,
    status: 'running',
    createdAt: previousState && previousState.createdAt ? previousState.createdAt : nowIso(),
    startedAt: previousState && previousState.startedAt ? previousState.startedAt : nowIso(),
    resumedAt: shouldResume ? nowIso() : null,
    updatedAt: nowIso(),
    endedAt: null,
    tags: normalizedJob.tags,
    skill: normalizedJob.skill || null,
    partnerProfile: normalizedJob.partnerProfile || null,
    autoImprove: normalizedJob.autoImprove,
    totalStages: normalizedJob.stages.length,
    nextStageIndex,
    currentStage: normalizedJob.stages[nextStageIndex] ? normalizedJob.stages[nextStageIndex].name : 'verification',
    currentContext,
    checkpoints: previousState && Array.isArray(previousState.checkpoints) ? previousState.checkpoints : [],
    stageHistory: previousState && Array.isArray(previousState.stageHistory) ? previousState.stageHistory : [],
    jobFilePath: normalizedJob.jobFilePath || (previousState ? previousState.jobFilePath : null) || null,
    jobSpec: previousState && previousState.jobSpec ? previousState.jobSpec : serializeJobForState(normalizedJob),
    lastError: null,
    stopReason: null,
    improvementExperimentId: previousState ? previousState.improvementExperimentId || null : null,
  });
  const controller = createExecutionController(normalizedJob.id, recall, state);

  const preRunResult = maybeFinishFromControl(normalizedJob.id, state, recall);
  if (preRunResult) return preRunResult;

  for (let index = nextStageIndex; index < normalizedJob.stages.length; index += 1) {
    const stage = normalizedJob.stages[index];
    writeJobState({
      ...state,
      status: 'running',
      updatedAt: nowIso(),
      nextStageIndex: index,
      currentStage: stage.name,
      currentContext,
    });

    const stageControlResult = maybeFinishFromControl(normalizedJob.id, readJobState(normalizedJob.id), recall);
    if (stageControlResult) return stageControlResult;

    try {
      controller.throwIfCancelled();
      const stageResult = runStage(stage, recall, currentContext, controller);
      currentContext = applyStageContext(currentContext, stageResult);

      const updatedState = writeJobState({
        ...(readJobState(normalizedJob.id) || state),
        status: 'running',
        updatedAt: nowIso(),
        nextStageIndex: index + 1,
        currentStage: normalizedJob.stages[index + 1] ? normalizedJob.stages[index + 1].name : 'verification',
        currentContext,
        stageHistory: [
          ...((readJobState(normalizedJob.id) || state).stageHistory || []),
          {
            name: stage.name,
            index,
            completedAt: nowIso(),
            metadata: stageResult.metadata || null,
          },
        ],
      });
      Object.assign(state, updatedState);

      controller.checkpoint(stageResult.checkpointLabel || `stage:${stage.name}`, {
        stageIndex: index,
        context: currentContext,
        metadata: stageResult.metadata || null,
      });

      const postStageResult = maybeFinishFromControl(normalizedJob.id, readJobState(normalizedJob.id), recall);
      if (postStageResult) return postStageResult;
    } catch (error) {
      const failedState = writeJobState({
        ...(readJobState(normalizedJob.id) || state),
        status: error && error.code === 'JOB_CANCELLED' ? 'cancelled' : 'failed',
        updatedAt: nowIso(),
        endedAt: nowIso(),
        currentContext,
        lastError: {
          message: error && error.message ? error.message : 'unknown execution error',
          code: error && error.code ? error.code : 'JOB_STAGE_FAILED',
        },
      });

      const improvementExperiment = error && error.code === 'JOB_CANCELLED'
        ? null
        : maybeQueueImprovementExperiment(normalizedJob, failedState, recall, {
          type: 'execution',
          error,
        });

      if (improvementExperiment) {
        failedState.improvementExperimentId = improvementExperiment.id;
        writeJobState(failedState);
      }

      clearJobControl(normalizedJob.id);

      const feedback = error && error.code === 'JOB_CANCELLED'
        ? null
        : captureFeedback({
          signal: 'down',
          context: `Job ${normalizedJob.id} failed during stage "${failedState.currentStage || 'unknown'}"`,
          whatWentWrong: error && error.message ? error.message : 'Stage execution failed',
          whatToChange: 'Resume from the last checkpoint after updating the failed stage or command',
          tags: [...normalizedJob.tags, 'async-job-runner', 'execution-loop'],
          skill: normalizedJob.skill || 'async-job-runner',
        });

      const result = buildResult({
        state: failedState,
        recall,
        verification: null,
        feedback,
        improvementExperiment,
      });
      appendJobLog(result);
      return result;
    }
  }

  const verification = runVerificationLoop({
    context: currentContext,
    tags: normalizedJob.tags,
    skill: normalizedJob.skill,
    partnerProfile: normalizedJob.partnerProfile,
    onRetry: normalizedJob.onRetry,
    maxRetries: normalizedJob.maxRetries,
  });

  const improvementExperiment = verification.accepted
    ? null
    : maybeQueueImprovementExperiment(normalizedJob, state, recall, {
      type: 'verification',
      verification,
    });

  const feedback = captureFeedback({
    signal: verification.accepted ? 'up' : 'down',
    context: verification.accepted
      ? `Job ${normalizedJob.id} passed verification after ${verification.attempts} attempt(s)`
      : `Job ${normalizedJob.id} failed verification after ${verification.attempts} attempt(s): ${(verification.finalVerification.violations || []).map((violation) => violation.pattern).join('; ')}`,
    whatWorked: verification.accepted ? 'Verification loop accepted output' : undefined,
    whatWentWrong: !verification.accepted ? `Failed ${verification.attempts} verification attempts` : undefined,
    whatToChange: !verification.accepted ? 'Improve output to avoid known mistake patterns' : undefined,
    tags: [...normalizedJob.tags, 'verification-loop'],
    skill: normalizedJob.skill || 'async-job-runner',
  });

  const terminalState = writeJobState({
    ...(readJobState(normalizedJob.id) || state),
    status: verification.accepted ? 'completed' : 'failed',
    updatedAt: nowIso(),
    endedAt: nowIso(),
    currentStage: null,
    nextStageIndex: normalizedJob.stages.length,
    currentContext,
    improvementExperimentId: improvementExperiment ? improvementExperiment.id : null,
    verification: {
      accepted: verification.accepted,
      attempts: verification.attempts,
      score: verification.finalVerification ? verification.finalVerification.score : 0,
    },
  });

  clearJobControl(normalizedJob.id);
  const result = buildResult({
    state: terminalState,
    recall,
    verification,
    feedback,
    improvementExperiment,
  });
  appendJobLog(result);
  return result;
}

function runJobFromFile(jobFilePath, options = {}) {
  const resolvedPath = path.resolve(jobFilePath);
  const spec = readJson(resolvedPath);
  if (!spec) {
    throw new Error(`Unable to read job file: ${resolvedPath}`);
  }

  const derivedId = spec.id || path.basename(resolvedPath, path.extname(resolvedPath));
  return executeJob({
    ...spec,
    id: derivedId,
    jobFilePath: resolvedPath,
    autoResume: options.autoResume !== false,
  }, options);
}

function runHarness(harnessId, inputs = {}, options = {}) {
  const { runHarness: executeHarness } = require('./natural-language-harness');
  return executeHarness(harnessId, inputs, options);
}

function resumeManagedJobs(options = {}) {
  const states = listJobStates({
    statuses: ['paused', 'running', 'resume_requested'],
  }).filter((state) => Boolean(state.jobFilePath));

  const limit = Number(options.limit || 0);
  const selected = limit > 0 ? states.slice(0, limit) : states;
  const results = selected.map((state) => runJobFromFile(state.jobFilePath, { ...options, resume: true }));

  return {
    total: results.length,
    completed: results.filter((result) => result.status === 'completed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    paused: results.filter((result) => result.status === 'paused').length,
    cancelled: results.filter((result) => result.status === 'cancelled').length,
    results,
    timestamp: nowIso(),
  };
}

/**
 * Run multiple jobs sequentially through the pipeline.
 *
 * @param {object[]} jobs
 * @returns {object}
 */
function runBatch(jobs) {
  const results = [];

  for (const job of jobs) {
    results.push(executeJob(job));
  }

  return {
    completed: results.filter((result) => result.status === 'completed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    paused: results.filter((result) => result.status === 'paused').length,
    cancelled: results.filter((result) => result.status === 'cancelled').length,
    total: results.length,
    results,
    timestamp: nowIso(),
  };
}

module.exports = {
  recallContext,
  executeJob,
  runBatch,
  appendJobLog,
  readJobLog,
  getJobStats,
  readJobState,
  listJobStates,
  readJobControl,
  requestJobControl,
  clearJobControl,
  runJobFromFile,
  runHarness,
  resumeJob,
  resumeManagedJobs,
  getJobRuntimePaths,
  JOB_LOG_FILENAME,
  JOB_CONTROL_FILENAME,
  JOB_STATE_DIRNAME,
};

if (require.main === module) {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length > 0 ? rest.join('=') : true;
  });

  if (args.pause) {
    console.log(JSON.stringify(requestJobControl(args.pause, 'pause'), null, 2));
    process.exit(0);
  }

  if (args.cancel) {
    console.log(JSON.stringify(requestJobControl(args.cancel, 'cancel'), null, 2));
    process.exit(0);
  }

  if (args.resume) {
    const result = resumeJob(args.resume);
    console.log(JSON.stringify(result, null, 2));
    process.exit(['failed', 'cancelled'].includes(result.status) ? 1 : 0);
  }

  if (args['resume-managed']) {
    const result = resumeManagedJobs({ limit: Number(args.limit || 0) });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.failed > 0 || result.cancelled > 0 ? 1 : 0);
  }

  if (args['list-harnesses']) {
    const { listHarnesses } = require('./natural-language-harness');
    console.log(JSON.stringify({ harnesses: listHarnesses({ tag: args.tag }) }, null, 2));
    process.exit(0);
  }

  if (args['run-harness']) {
    let inputs = {};
    if (args['harness-inputs']) {
      try {
        inputs = JSON.parse(args['harness-inputs']);
      } catch (error) {
        console.error(`Invalid --harness-inputs JSON: ${error.message}`);
        process.exit(1);
      }
    }

    const result = runHarness(args['run-harness'], inputs, {
      jobId: args['job-id'],
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(['failed', 'cancelled'].includes(result.status) ? 1 : 0);
  }

  if (args['run-file']) {
    const result = runJobFromFile(args['run-file']);
    console.log(JSON.stringify(result, null, 2));
    process.exit(['failed', 'cancelled'].includes(result.status) ? 1 : 0);
  }

  if (args.run) {
    const result = executeJob({
      context: args.context || '',
      tags: (args.tags || '').split(',').filter(Boolean),
      skill: args.skill,
      maxRetries: Number(args.retries || 3),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(['failed', 'cancelled'].includes(result.status) ? 1 : 0);
  }

  if (args.jobs) {
    console.log(JSON.stringify(listJobStates({ limit: Number(args.limit || 20) }), null, 2));
    process.exit(0);
  }

  if (args.stats) {
    console.log(JSON.stringify(getJobStats(), null, 2));
    process.exit(0);
  }

  if (args.log) {
    const limit = Number(args.limit || 20);
    console.log(JSON.stringify(readJobLog(limit), null, 2));
    process.exit(0);
  }

  console.log(`Usage:
  node scripts/async-job-runner.js --run --context="..." --tags=testing --skill=executor
  node scripts/async-job-runner.js --run-file=./job.json
  node scripts/async-job-runner.js --list-harnesses [--tag=verification]
  node scripts/async-job-runner.js --run-harness=repo-full-verification --harness-inputs='{"verificationCommand":"npm run verify:full"}' [--job-id=verify-job]
  node scripts/async-job-runner.js --resume=<jobId>
  node scripts/async-job-runner.js --resume-managed [--limit=5]
  node scripts/async-job-runner.js --pause=<jobId>
  node scripts/async-job-runner.js --cancel=<jobId>
  node scripts/async-job-runner.js --jobs [--limit=10]
  node scripts/async-job-runner.js --stats
  node scripts/async-job-runner.js --log --limit=10`);
}
