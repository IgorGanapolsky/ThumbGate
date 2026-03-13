'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('async-job-runner', () => {
  let m;
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ajr-test-'));
    process.env.RLHF_FEEDBACK_DIR = tmpDir;
    delete require.cache[require.resolve('../scripts/async-job-runner')];
    delete require.cache[require.resolve('../scripts/verification-loop')];
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    m = require('../scripts/async-job-runner');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.RLHF_FEEDBACK_DIR;
  });

  it('exports JOB_LOG_FILENAME', () => {
    assert.equal(m.JOB_LOG_FILENAME, 'job-log.jsonl');
  });

  it('recallContext returns analysis structure', () => {
    const ctx = m.recallContext({ tags: ['testing'] });
    assert.equal(typeof ctx.totalFeedback, 'number');
    assert.equal(typeof ctx.approvalRate, 'number');
    assert.equal(typeof ctx.preventionRuleCount, 'number');
    assert.ok(Array.isArray(ctx.riskDomains));
    assert.ok(Array.isArray(ctx.recommendations));
  });

  it('recallContext works with no tags', () => {
    const ctx = m.recallContext({});
    assert.equal(typeof ctx.totalFeedback, 'number');
  });

  it('executeJob runs full pipeline and returns result', () => {
    const result = m.executeJob({
      id: 'test-job-1',
      context: 'output that should pass verification',
      tags: ['testing'],
      skill: 'test-skill',
    });

    assert.equal(result.jobId, 'test-job-1');
    assert.equal(result.status, 'completed');
    assert.ok(result.phases.recall);
    assert.ok(result.phases.verification);
    assert.ok(result.phases.feedback);
    assert.equal(result.phases.verification.accepted, true);
    assert.ok(result.durationMs >= 0);
    assert.ok(result.timestamp);
  });

  it('executeJob generates jobId when not provided', () => {
    const result = m.executeJob({
      context: 'auto id test',
      tags: [],
    });

    assert.ok(result.jobId.startsWith('job_'));
  });

  it('executeJob calls taskFn with recall context', () => {
    let receivedContext = null;
    const result = m.executeJob({
      id: 'taskfn-test',
      tags: ['api'],
      taskFn: (recall) => {
        receivedContext = recall;
        return 'task produced this output';
      },
    });

    assert.ok(receivedContext);
    assert.equal(typeof receivedContext.approvalRate, 'number');
    assert.equal(result.status, 'completed');
  });

  it('executeJob carries partner profile through verification', () => {
    const result = m.executeJob({
      id: 'partner-job',
      context: 'verified output',
      tags: ['testing'],
      partnerProfile: 'strict-reviewer',
    });

    assert.equal(result.phases.verification.partnerProfile, 'strict_reviewer');
    assert.equal(result.phases.verification.verificationMode, 'evidence_first');
    assert.ok(typeof result.phases.verification.reward === 'number');
  });

  it('executeJob writes to job log', () => {
    const before = m.readJobLog();
    m.executeJob({
      id: 'log-test',
      context: 'will be logged',
      tags: [],
    });
    const after = m.readJobLog();

    assert.ok(after.length > before.length);
    const last = after[after.length - 1];
    assert.equal(last.jobId, 'log-test');
  });

  it('readJobLog respects limit', () => {
    for (let i = 0; i < 5; i++) {
      m.executeJob({
        id: `limit-test-${i}`,
        context: `output ${i}`,
        tags: [],
      });
    }

    const limited = m.readJobLog(2);
    assert.ok(limited.length <= 2);
  });

  it('runBatch processes multiple jobs', () => {
    const result = m.runBatch([
      { id: 'batch-1', context: 'first job output', tags: ['testing'] },
      { id: 'batch-2', context: 'second job output', tags: ['api'] },
    ]);

    assert.equal(result.total, 2);
    assert.equal(result.completed, 2);
    assert.equal(result.failed, 0);
    assert.equal(result.results.length, 2);
    assert.ok(result.timestamp);
  });

  it('runBatch handles empty array', () => {
    const result = m.runBatch([]);
    assert.equal(result.total, 0);
    assert.equal(result.completed, 0);
    assert.equal(result.failed, 0);
  });

  it('getJobStats returns correct aggregates', () => {
    const stats = m.getJobStats();
    assert.equal(typeof stats.totalJobs, 'number');
    assert.equal(typeof stats.completed, 'number');
    assert.equal(typeof stats.failed, 'number');
    assert.ok(stats.totalJobs > 0);
    assert.ok(typeof stats.successRate === 'number');
    assert.ok(typeof stats.avgDurationMs === 'number');
    assert.ok(typeof stats.avgAttempts === 'number');
  });

  it('getJobStats handles empty log', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ajr-empty-'));
    process.env.RLHF_FEEDBACK_DIR = emptyDir;

    delete require.cache[require.resolve('../scripts/async-job-runner')];
    delete require.cache[require.resolve('../scripts/verification-loop')];
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const freshM = require('../scripts/async-job-runner');

    const stats = freshM.getJobStats();
    assert.equal(stats.totalJobs, 0);
    assert.equal(stats.completed, 0);
    assert.equal(stats.avgDurationMs, 0);

    process.env.RLHF_FEEDBACK_DIR = tmpDir;
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('appendJobLog creates dir if missing', () => {
    const nestedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ajr-nested-'));
    const deepDir = path.join(nestedDir, 'a', 'b');
    process.env.RLHF_FEEDBACK_DIR = deepDir;

    delete require.cache[require.resolve('../scripts/async-job-runner')];
    delete require.cache[require.resolve('../scripts/verification-loop')];
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const freshM = require('../scripts/async-job-runner');

    freshM.appendJobLog({ test: true });
    const logPath = path.join(deepDir, 'job-log.jsonl');
    assert.ok(fs.existsSync(logPath));

    process.env.RLHF_FEEDBACK_DIR = tmpDir;
    fs.rmSync(nestedDir, { recursive: true, force: true });
  });
});
