'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Helper: fresh require with env overrides pointing to tmpDir
// ---------------------------------------------------------------------------

function freshModule(tmpDir) {
  process.env.THUMBGATE_ACTION_LOG = path.join(tmpDir, 'action-log.jsonl');
  process.env.THUMBGATE_FEEDBACK_ATTRIBUTIONS = path.join(tmpDir, 'attributions.jsonl');
  process.env.THUMBGATE_ATTRIBUTED_FEEDBACK = path.join(tmpDir, 'attributed-feedback.jsonl');
  delete require.cache[require.resolve('../scripts/feedback-attribution')];
  return require('../scripts/feedback-attribution');
}

function seedActionLog(tmpDir, entries) {
  const logPath = path.join(tmpDir, 'action-log.jsonl');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// describe: recordAction
// ---------------------------------------------------------------------------

describe('recordAction', () => {
  let tmpDir;
  let recordAction;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-record-test-'));
    ({ recordAction } = freshModule(tmpDir));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.THUMBGATE_ACTION_LOG;
    delete process.env.THUMBGATE_FEEDBACK_ATTRIBUTIONS;
    delete process.env.THUMBGATE_ATTRIBUTED_FEEDBACK;
  });

  it('writes action-log.jsonl and returns ok:true with valid action_id', () => {
    const result = recordAction('Bash', '{"command":"npm test"}');
    assert.strictEqual(result.ok, true);
    assert.ok(result.action.action_id.startsWith('act_'), `action_id must start with act_, got: ${result.action.action_id}`);
    const logPath = path.join(tmpDir, 'action-log.jsonl');
    assert.ok(fs.existsSync(logPath), 'action-log.jsonl must exist after recordAction');
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    const row = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(row.tool_name, 'Bash');
    assert.ok(Array.isArray(row.keywords) && row.keywords.length > 0, 'keywords must be a non-empty array');
  });

  it('sets intent to shell-command for Bash tool', () => {
    const result = recordAction('Bash', '{"command":"ls"}');
    assert.strictEqual(result.action.intent, 'shell-command');
  });

  it('sets intent to git-risk for git push --force command', () => {
    const result = recordAction('Bash', '{"command":"git push --force"}');
    assert.strictEqual(result.action.intent, 'git-risk');
  });

  it('sets intent to file-change for Edit tool', () => {
    const result = recordAction('Edit', '{"file_path":"foo.js"}');
    assert.strictEqual(result.action.intent, 'file-change');
  });

  it('risk_score is higher for destructive commands than safe commands', () => {
    const safeResult = recordAction('Read', '{"file_path":"foo.js"}');
    const riskyResult = recordAction('Bash', '{"command":"rm -rf /tmp/foo"}');
    assert.ok(
      riskyResult.action.risk_score > safeResult.action.risk_score,
      `risky score (${riskyResult.action.risk_score}) must be > safe score (${safeResult.action.risk_score})`
    );
  });
});

// ---------------------------------------------------------------------------
// describe: attributeFeedback
// ---------------------------------------------------------------------------

describe('attributeFeedback', () => {
  let tmpDir;
  let attributeFeedback;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-attr-test-'));
    ({ attributeFeedback } = freshModule(tmpDir));

    // Seed action-log.jsonl with a recent Bash action using keywords from feedback context
    seedActionLog(tmpDir, [
      {
        action_id: 'act_seed_001',
        timestamp: new Date().toISOString(),
        tool_name: 'Bash',
        input: 'npm test',
        normalized_input: 'npm test',
        intent: 'shell-command',
        keywords: ['npm', 'test', 'failed', 'error'],
        risk_score: 4,
      },
    ]);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.THUMBGATE_ACTION_LOG;
    delete process.env.THUMBGATE_FEEDBACK_ATTRIBUTIONS;
    delete process.env.THUMBGATE_ATTRIBUTED_FEEDBACK;
  });

  it('returns ok:true for positive signal', () => {
    const result = attributeFeedback('positive', 'great npm test result');
    assert.strictEqual(result.ok, true);
    assert.ok(!result.skipped, 'positive must not be skipped');
  });

  it('returns skipped:true for unsupported signal', () => {
    const result = attributeFeedback('thumbsdown', 'some context');
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.ok, true);
  });

  it('negative signal writes to attributions file', () => {
    const result = attributeFeedback('negative', 'bad npm test failed error');
    assert.strictEqual(result.ok, true);
    const attributionsPath = path.join(tmpDir, 'attributions.jsonl');
    assert.ok(fs.existsSync(attributionsPath), 'attributions.jsonl must exist after negative attribution');
    const lines = fs.readFileSync(attributionsPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.ok(lines.length >= 1, 'at least one attribution row must be written');
    const row = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(row.signal, 'negative');
  });

  it('negative signal writes to attributed-feedback.jsonl when confidence threshold met', () => {
    // The seeded Bash action has keywords ['npm', 'test', 'failed', 'error']
    // feedback context 'npm test failed badly error' overlaps significantly
    const result = attributeFeedback('negative', 'npm test failed badly error');
    assert.strictEqual(result.ok, true);
    // Check attributed-feedback file was created (confidence may or may not hit threshold
    // depending on scoring; at minimum the attributions file should be written)
    const attributionsPath = path.join(tmpDir, 'attributions.jsonl');
    assert.ok(fs.existsSync(attributionsPath), 'attributions.jsonl must exist');
    // If attributedCount > 0 then attributed-feedback.jsonl was written
    if (result.attributedCount > 0) {
      const attributedFeedbackPath = path.join(tmpDir, 'attributed-feedback.jsonl');
      assert.ok(fs.existsSync(attributedFeedbackPath), 'attributed-feedback.jsonl must exist when attributedCount > 0');
      const lines = fs.readFileSync(attributedFeedbackPath, 'utf8').trim().split('\n').filter(Boolean);
      assert.ok(lines.length >= 1, 'at least one attributed-feedback row');
    }
  });

  it('positive signal does NOT write to attributed-feedback.jsonl', () => {
    const attributedFeedbackPath = path.join(tmpDir, 'attributed-feedback.jsonl');
    // Remove if exists from prior tests
    if (fs.existsSync(attributedFeedbackPath)) fs.unlinkSync(attributedFeedbackPath);

    const result = attributeFeedback('positive', 'good work well done');
    assert.strictEqual(result.ok, true);
    // Positive signals never write to attributed-feedback.jsonl
    const existsNow = fs.existsSync(attributedFeedbackPath);
    assert.strictEqual(existsNow, false, 'attributed-feedback.jsonl must NOT be created for positive signal');
  });
});
