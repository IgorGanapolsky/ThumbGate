'use strict';

const fs = require('fs');
const path = require('path');
const { captureFeedback, analyzeFeedback, getFeedbackPaths, readJSONL } = require('./feedback-loop');
const { runVerificationLoop } = require('./verification-loop');

const JOB_LOG_FILENAME = 'job-log.jsonl';

/**
 * Recall relevant context before executing a task.
 * Pulls recent feedback analysis and prevention rules for the given domain.
 *
 * @param {object} params
 * @param {string[]} [params.tags] - Domain tags to filter context
 * @returns {object} { analysis, riskDomains, preventionRuleCount }
 */
function recallContext(params) {
  const analysis = analyzeFeedback();
  const { MEMORY_LOG_PATH } = getFeedbackPaths();
  const memories = readJSONL(MEMORY_LOG_PATH);
  const errorMemories = memories.filter(m => m.category === 'error');

  const tags = Array.isArray(params.tags) ? params.tags : [];
  let riskDomains = [];

  if (analysis.boostedRisk && Array.isArray(analysis.boostedRisk.highRiskDomains)) {
    riskDomains = analysis.boostedRisk.highRiskDomains
      .filter(d => !tags.length || tags.some(t => d.key.includes(t)))
      .map(d => ({ domain: d.key, riskRate: d.riskRate }));
  }

  return {
    totalFeedback: analysis.total,
    approvalRate: analysis.approvalRate,
    recentRate: analysis.recentRate,
    riskDomains,
    preventionRuleCount: errorMemories.length,
    recommendations: analysis.recommendations.slice(0, 5),
  };
}

/**
 * Execute a single job through the full pipeline: recall → task → verify → feedback.
 *
 * @param {object} job
 * @param {string} job.id - Unique job identifier
 * @param {string} job.context - The task output to verify
 * @param {string[]} [job.tags] - Domain tags
 * @param {string} [job.skill] - Originating skill
 * @param {string} [job.partnerProfile] - Counterpart behavior profile used for orchestration
 * @param {function} [job.taskFn] - Optional function that produces output (called with recall context)
 * @param {function} [job.onRetry] - Retry handler passed to verification loop
 * @param {number} [job.maxRetries] - Max retries for verification (default 3)
 * @returns {object} Job execution result
 */
function executeJob(job) {
  const started = Date.now();
  const jobId = job.id || `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tags = Array.isArray(job.tags) ? job.tags : [];

  const recall = recallContext({ tags });

  let taskOutput = job.context || '';
  if (typeof job.taskFn === 'function') {
    taskOutput = job.taskFn(recall);
    if (typeof taskOutput !== 'string') {
      taskOutput = String(taskOutput || '');
    }
  }

  const verification = runVerificationLoop({
    context: taskOutput,
    tags,
    skill: job.skill,
    partnerProfile: job.partnerProfile,
    onRetry: job.onRetry,
    maxRetries: job.maxRetries,
  });

  const feedbackResult = captureFeedback({
    signal: verification.accepted ? 'up' : 'down',
    context: verification.accepted
      ? `Job ${jobId} passed verification after ${verification.attempts} attempt(s)`
      : `Job ${jobId} failed verification after ${verification.attempts} attempt(s): ${(verification.finalVerification.violations || []).map(v => v.pattern).join('; ')}`,
    whatWorked: verification.accepted ? 'Verification loop accepted output' : undefined,
    whatWentWrong: !verification.accepted ? `Failed ${verification.attempts} verification attempts` : undefined,
    whatToChange: !verification.accepted ? 'Improve output to avoid known mistake patterns' : undefined,
    tags: [...tags, 'verification-loop'],
    skill: job.skill || 'async-job-runner',
  });

  const result = {
    jobId,
    status: verification.accepted ? 'completed' : 'failed',
    phases: {
      recall: {
        approvalRate: recall.approvalRate,
        preventionRuleCount: recall.preventionRuleCount,
        riskDomains: recall.riskDomains,
      },
      verification: {
        accepted: verification.accepted,
        attempts: verification.attempts,
        score: verification.finalVerification.score,
        partnerProfile: verification.partnerStrategy.profile,
        verificationMode: verification.partnerStrategy.verificationMode,
        reward: verification.partnerReward.reward,
      },
      feedback: {
        accepted: feedbackResult.accepted,
        status: feedbackResult.status,
      },
    },
    durationMs: Date.now() - started,
    timestamp: new Date().toISOString(),
  };

  appendJobLog(result);

  return result;
}

/**
 * Run multiple jobs sequentially through the pipeline.
 *
 * @param {object[]} jobs - Array of job definitions
 * @returns {object} { completed, failed, total, results }
 */
function runBatch(jobs) {
  const results = [];

  for (const job of jobs) {
    const result = executeJob(job);
    results.push(result);
  }

  const completed = results.filter(r => r.status === 'completed').length;

  return {
    completed,
    failed: results.length - completed,
    total: results.length,
    results,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Append a job result to the job log (JSONL).
 */
function appendJobLog(result) {
  const { FEEDBACK_DIR } = getFeedbackPaths();
  const logPath = path.join(FEEDBACK_DIR, JOB_LOG_FILENAME);
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(logPath, JSON.stringify(result) + '\n');
}

/**
 * Read the job log.
 * @param {number} [limit] - Max entries to return (from end)
 * @returns {object[]}
 */
function readJobLog(limit) {
  const { FEEDBACK_DIR } = getFeedbackPaths();
  const logPath = path.join(FEEDBACK_DIR, JOB_LOG_FILENAME);
  const entries = readJSONL(logPath);
  return limit ? entries.slice(-limit) : entries;
}

/**
 * Get job pipeline stats.
 * @returns {object} { totalJobs, completed, failed, avgDurationMs, avgAttempts }
 */
function getJobStats() {
  const entries = readJobLog();
  if (entries.length === 0) {
    return { totalJobs: 0, completed: 0, failed: 0, avgDurationMs: 0, avgAttempts: 0 };
  }

  const completed = entries.filter(e => e.status === 'completed').length;
  const totalDuration = entries.reduce((sum, e) => sum + (e.durationMs || 0), 0);
  const totalAttempts = entries.reduce((sum, e) => {
    return sum + ((e.phases && e.phases.verification && e.phases.verification.attempts) || 1);
  }, 0);

  return {
    totalJobs: entries.length,
    completed,
    failed: entries.length - completed,
    successRate: Math.round((completed / entries.length) * 1000) / 1000,
    avgDurationMs: Math.round(totalDuration / entries.length),
    avgAttempts: Math.round((totalAttempts / entries.length) * 100) / 100,
  };
}

module.exports = {
  recallContext,
  executeJob,
  runBatch,
  appendJobLog,
  readJobLog,
  getJobStats,
  JOB_LOG_FILENAME,
};

if (require.main === module) {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length > 0 ? rest.join('=') : true;
  });

  if (args.run) {
    const result = executeJob({
      context: args.context || '',
      tags: (args.tags || '').split(',').filter(Boolean),
      skill: args.skill,
      maxRetries: Number(args.retries || 3),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === 'completed' ? 0 : 1);
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
  node scripts/async-job-runner.js --stats
  node scripts/async-job-runner.js --log --limit=10`);
}
