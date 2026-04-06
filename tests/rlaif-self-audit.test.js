'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

function freshModule(tmpDir) {
  if (tmpDir) process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  delete require.cache[require.resolve('../scripts/rlaif-self-audit')];
  return require('../scripts/rlaif-self-audit');
}

describe('rlaif-self-audit — CONSTRAINTS', () => {
  it('exports 6 constraints with weights summing to 1.0', () => {
    const { CONSTRAINTS } = freshModule();
    assert.strictEqual(CONSTRAINTS.length, 6);
    const total = CONSTRAINTS.reduce((s, c) => s + c.weight, 0);
    assert.ok(Math.abs(total - 1.0) < 0.001, `weights sum to ${total}, expected 1.0`);
  });
});

describe('rlaif-self-audit — selfAudit()', () => {
  it('returns object with score, constraints, timestamp', () => {
    const { selfAudit } = freshModule();
    const result = selfAudit({ signal: 'positive', context: 'ok', tags: ['t'] });
    assert.ok(typeof result.score === 'number', 'score must be number');
    assert.ok(Array.isArray(result.constraints), 'constraints must be array');
    assert.ok(typeof result.timestamp === 'string', 'timestamp must be string');
  });

  it('returns score < 0.5 for vague negative feedback', () => {
    const { selfAudit } = freshModule();
    const event = { signal: 'negative', context: 'bad', tags: [], timestamp: new Date().toISOString() };
    const result = selfAudit(event);
    assert.ok(result.score < 0.5, `expected score < 0.5, got ${result.score}`);
    assert.strictEqual(result.constraints.length, 6, 'always returns 6 constraints');
  });

  it('returns score > 0.7 for well-formed positive feedback with rubric', () => {
    const { selfAudit } = freshModule();
    const event = {
      signal: 'positive',
      context: 'Ran all tests with output, verified before claiming done',
      whatWorked: 'Evidence-first flow prevented premature completion claim',
      tags: ['verification', 'testing'],
      rubric: { promotionEligible: true, failingGuardrails: [] },
      timestamp: new Date().toISOString(),
    };
    const result = selfAudit(event);
    assert.ok(result.score > 0.7, `expected score > 0.7, got ${result.score}`);
  });

  it('score is 0 for null/empty event', () => {
    const { selfAudit } = freshModule();
    const result = selfAudit({});
    assert.ok(result.score >= 0, 'score must be >= 0');
    assert.ok(result.score < 1, 'empty event score must be < 1');
  });

  it('positive feedback missing whatWorked fails has_actionable_detail', () => {
    const { selfAudit } = freshModule();
    const event = {
      signal: 'positive',
      context: 'Did something but did not document what worked here',
      tags: ['testing'],
    };
    const result = selfAudit(event);
    const actionable = result.constraints.find((c) => c.constraint === 'has_actionable_detail');
    assert.strictEqual(actionable.passed, false, 'missing whatWorked must fail has_actionable_detail');
  });

  it('generic thumbs-up context fails no_vague_signal', () => {
    const { selfAudit } = freshModule();
    const event = {
      signal: 'positive',
      context: 'thumbs up',
      tags: ['verification'],
    };
    const result = selfAudit(event);
    const vague = result.constraints.find((c) => c.constraint === 'no_vague_signal');
    assert.strictEqual(vague.passed, false, 'generic praise must fail no_vague_signal');
  });

  it('negative feedback with whatWentWrong and whatToChange passes has_actionable_detail', () => {
    const { selfAudit } = freshModule();
    const event = {
      signal: 'negative',
      context: 'The verification step was skipped before claiming done',
      whatWentWrong: 'Skipped test run',
      whatToChange: 'Always run npm test before claiming done',
      tags: ['verification'],
    };
    const result = selfAudit(event);
    const actionable = result.constraints.find((c) => c.constraint === 'has_actionable_detail');
    assert.strictEqual(actionable.passed, true, 'full negative feedback must pass has_actionable_detail');
  });

  it('budget_compliant fails when failingGuardrails includes budgetCompliant', () => {
    const { selfAudit } = freshModule();
    const event = {
      signal: 'positive',
      context: 'Made an API call that exceeded budget for the month',
      whatWorked: 'The API returned data',
      tags: ['api'],
      rubric: { promotionEligible: false, failingGuardrails: ['budgetCompliant'] },
    };
    const result = selfAudit(event);
    const budget = result.constraints.find((c) => c.constraint === 'budget_compliant');
    assert.strictEqual(budget.passed, false, 'must fail when budgetCompliant in failingGuardrails');
  });
});

describe('rlaif-self-audit — selfAuditAndLog()', () => {
  it('appends to self-score-log.jsonl without throwing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlaif-test-'));
    try {
      const { selfAuditAndLog } = freshModule(tmpDir);
      const event = {
        id: 'fb_test_001',
        signal: 'positive',
        context: 'Test event for audit log verification',
        whatWorked: 'Logging is working',
        tags: ['testing'],
        rubric: { promotionEligible: true, failingGuardrails: [] },
      };
      const result = selfAuditAndLog(event, { FEEDBACK_DIR: tmpDir });
      assert.ok(typeof result.score === 'number', 'returns score');
      const logPath = path.join(tmpDir, 'self-score-log.jsonl');
      assert.ok(fs.existsSync(logPath), 'self-score-log.jsonl must exist after call');
      const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
      assert.strictEqual(lines.length, 1, 'one JSONL line appended');
      const parsed = JSON.parse(lines[0]);
      assert.strictEqual(parsed.feedbackId, 'fb_test_001', 'feedbackId matches');
      assert.ok(typeof parsed.score === 'number', 'score present in log entry');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.THUMBGATE_FEEDBACK_DIR;
    }
  });

  it('does not throw when mlPaths is null', () => {
    const { selfAuditAndLog } = freshModule();
    // Should not throw; returns result
    const result = selfAuditAndLog({ signal: 'positive', context: 'x', tags: [] }, null);
    assert.ok(typeof result.score === 'number');
  });

  it('accumulates multiple log entries', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlaif-test-'));
    try {
      const { selfAuditAndLog } = freshModule(tmpDir);
      const mlPaths = { FEEDBACK_DIR: tmpDir };
      selfAuditAndLog({ id: 'a', signal: 'positive', context: 'First event logged here', whatWorked: 'w', tags: ['t'] }, mlPaths);
      selfAuditAndLog({ id: 'b', signal: 'negative', context: 'Second event logged here', whatWentWrong: 'x', whatToChange: 'y', tags: ['t'] }, mlPaths);
      const logPath = path.join(tmpDir, 'self-score-log.jsonl');
      const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
      assert.strictEqual(lines.length, 2, 'two entries appended');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.THUMBGATE_FEEDBACK_DIR;
    }
  });
});
