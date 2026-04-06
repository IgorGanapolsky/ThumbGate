'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

function freshModule(tmpDir) {
  if (tmpDir) process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  // Invalidate all relevant cached modules so env var change takes effect
  for (const key of Object.keys(require.cache)) {
    if (key.includes('meta-policy') || key.includes('feedback-loop') || key.includes('thompson-sampling')) {
      delete require.cache[key];
    }
  }
  return require('../scripts/meta-policy');
}

describe('meta-policy — extractMetaPolicyRules()', () => {
  it('returns empty rules array when memory-log.jsonl is missing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-policy-test-'));
    try {
      const { extractMetaPolicyRules } = freshModule(tmpDir);
      const result = extractMetaPolicyRules(tmpDir);
      // extractMetaPolicyRules returns an array directly
      assert.ok(Array.isArray(result), 'result must be array');
      assert.strictEqual(result.length, 0, 'empty when no memories');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.THUMBGATE_FEEDBACK_DIR;
    }
  });

  it('returns rules array with correct structure for repeated errors', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-policy-test-'));
    try {
      const memoryLog = path.join(tmpDir, 'memory-log.jsonl');
      const now = new Date().toISOString();
      const memories = [
        {
          id: 'err_1',
          category: 'error',
          title: 'MISTAKE: skipped tests',
          content: 'How to avoid: Always run tests before claiming done.',
          tags: ['verification', 'testing'],
          timestamp: now,
        },
        {
          id: 'err_2',
          category: 'error',
          title: 'MISTAKE: skipped tests again',
          content: 'How to avoid: Run npm test and include output.',
          tags: ['verification', 'testing'],
          timestamp: now,
        },
      ];
      fs.writeFileSync(memoryLog, memories.map((m) => JSON.stringify(m)).join('\n') + '\n');

      const { extractMetaPolicyRules } = freshModule(tmpDir);
      const result = extractMetaPolicyRules(tmpDir);
      assert.ok(Array.isArray(result), 'result must be array');
      if (result.length > 0) {
        const rule = result[0];
        assert.ok('category' in rule, 'rule must have category');
        assert.ok('confidence' in rule, 'rule must have confidence');
        assert.ok('trend' in rule, 'rule must have trend');
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.THUMBGATE_FEEDBACK_DIR;
    }
  });
});

describe('meta-policy — run()', () => {
  it('writes meta-policy-rules.json to feedbackDir', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-policy-test-'));
    try {
      const { run } = freshModule(tmpDir);
      const result = run({ feedbackDir: tmpDir });
      assert.ok(typeof result === 'object', 'run returns object');
      const outPath = path.join(tmpDir, 'meta-policy-rules.json');
      assert.ok(fs.existsSync(outPath), 'meta-policy-rules.json must be written');
      const parsed = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      assert.ok('generated' in parsed, 'output has generated field');
      assert.ok(Array.isArray(parsed.rules), 'output has rules array');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.THUMBGATE_FEEDBACK_DIR;
    }
  });
});
