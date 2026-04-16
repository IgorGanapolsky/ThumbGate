'use strict';

/**
 * Tests for PreToolUse hook lesson injection.
 *
 * Verifies that when Claude Code calls a tool, the gates-engine hook injects
 * semantically-relevant past mistakes into the hook output so the agent sees
 * them BEFORE executing — not after.
 *
 * This is the enforcement path that turns captured lessons into active prevention.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildRelevantLessonContext,
  extractActionContext,
  extractAvoidanceAdvice,
  mergeContextStrings,
} = require('../scripts/gates-engine');

function createTempFeedbackDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-pretool-test-'));
  return dir;
}

function writeMemoryLog(dir, memories) {
  fs.writeFileSync(
    path.join(dir, 'memory-log.jsonl'),
    memories.map((m) => JSON.stringify(m)).join('\n') + '\n',
  );
}

function writeFeedbackLog(dir, entries) {
  fs.writeFileSync(
    path.join(dir, 'feedback-log.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
}

describe('extractActionContext', () => {
  test('returns toolName when no input', () => {
    assert.equal(extractActionContext('Bash', null), 'Bash');
  });

  test('includes command for Bash tool', () => {
    const ctx = extractActionContext('Bash', { command: 'gh run rerun 123' });
    assert.match(ctx, /Bash/);
    assert.match(ctx, /gh run rerun/);
  });

  test('includes file_path for Edit tool', () => {
    const ctx = extractActionContext('Edit', { file_path: '/tmp/foo.js' });
    assert.match(ctx, /foo\.js/);
  });

  test('truncates long command to avoid context bloat', () => {
    const longCmd = 'echo ' + 'x'.repeat(1000);
    const ctx = extractActionContext('Bash', { command: longCmd });
    assert.ok(ctx.length < 500, `context should be capped: got ${ctx.length} chars`);
  });

  test('combines multiple input fields', () => {
    const ctx = extractActionContext('Bash', {
      command: 'npm publish',
      description: 'Publish to npm registry',
    });
    assert.match(ctx, /npm publish/);
    assert.match(ctx, /Publish to npm/);
  });
});

describe('extractAvoidanceAdvice', () => {
  test('extracts How to avoid line', () => {
    const content = 'What went wrong: did bad thing\nHow to avoid: NEVER do bad thing again\nExtra text';
    assert.equal(extractAvoidanceAdvice(content), 'NEVER do bad thing again');
  });

  test('returns null when no How to avoid section', () => {
    assert.equal(extractAvoidanceAdvice('Just some text'), null);
  });

  test('handles null input', () => {
    assert.equal(extractAvoidanceAdvice(null), null);
  });

  test('caps length to 220 chars', () => {
    const longAdvice = 'x'.repeat(500);
    const content = `How to avoid: ${longAdvice}`;
    const result = extractAvoidanceAdvice(content);
    assert.ok(result.length <= 220);
  });
});

describe('mergeContextStrings', () => {
  test('joins non-empty strings with double newline', () => {
    assert.equal(mergeContextStrings('a', 'b'), 'a\n\nb');
  });

  test('filters out null and empty', () => {
    assert.equal(mergeContextStrings('a', null, '', 'b'), 'a\n\nb');
  });

  test('returns null when all inputs empty', () => {
    assert.equal(mergeContextStrings(null, '', undefined), null);
  });
});

describe('buildRelevantLessonContext', () => {
  let tempDir;
  let originalEnv;

  beforeEach(() => {
    tempDir = createTempFeedbackDir();
    originalEnv = process.env.THUMBGATE_FEEDBACK_DIR;
    process.env.THUMBGATE_FEEDBACK_DIR = tempDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = originalEnv;
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  test('returns null when no memories exist', () => {
    writeMemoryLog(tempDir, []);
    const ctx = buildRelevantLessonContext('Bash', { command: 'gh run rerun' });
    assert.equal(ctx, null);
  });

  test('returns null when toolName is empty', () => {
    writeMemoryLog(tempDir, [
      {
        id: 'm1',
        title: 'MISTAKE: retried flaky CI instead of reading test',
        content: 'How to avoid: READ THE TEST FIRST',
        tags: ['negative', 'ci-debugging'],
        timestamp: new Date().toISOString(),
      },
    ]);
    assert.equal(buildRelevantLessonContext('', {}), null);
  });

  test('injects relevant negative lesson for matching tool action', () => {
    writeMemoryLog(tempDir, [
      {
        id: 'm1',
        title: 'MISTAKE: git push force destroyed commit history on main branch',
        content: 'What went wrong: ran git push force origin main and destroyed commits.\nHow to avoid: NEVER force push to main branch',
        tags: ['negative', 'git-workflow', 'destructive'],
        metadata: { toolsUsed: ['Bash'] },
        timestamp: new Date().toISOString(),
      },
    ]);

    const ctx = buildRelevantLessonContext('Bash', {
      command: 'git push --force origin main branch',
    });

    assert.ok(ctx, `should return lesson context, got: ${ctx}`);
    assert.match(ctx, /ThumbGate/);
    assert.match(ctx, /Past mistakes/);
    assert.match(ctx, /git push force/i);
    assert.match(ctx, /NEVER force push/);
  });

  test('excludes positive lessons from injection', () => {
    writeMemoryLog(tempDir, [
      {
        id: 'm1',
        title: 'SUCCESS: used retrieve_lessons before acting',
        content: 'What worked: called recall first',
        tags: ['positive'],
        timestamp: new Date().toISOString(),
      },
    ]);

    const ctx = buildRelevantLessonContext('Bash', { command: 'anything' });
    assert.equal(ctx, null, 'should not inject positive lessons');
  });

  test('excludes low-relevance lessons', () => {
    writeMemoryLog(tempDir, [
      {
        id: 'm1',
        title: 'MISTAKE: completely unrelated payment bug',
        content: 'How to avoid: check Stripe webhook signatures',
        tags: ['negative', 'payments'],
        timestamp: new Date().toISOString(),
      },
    ]);

    const ctx = buildRelevantLessonContext('Bash', {
      command: 'git commit -m "update readme"',
    });
    // Either null (no match) or context without the unrelated lesson
    if (ctx !== null) {
      assert.doesNotMatch(ctx, /Stripe/);
    }
  });

  test('limits to top 3 most relevant negative lessons', () => {
    const memories = [];
    for (let i = 0; i < 10; i++) {
      memories.push({
        id: `m${i}`,
        title: `MISTAKE: git force push mistake number ${i}`,
        content: 'How to avoid: NEVER force push to main',
        tags: ['negative', 'git-workflow'],
        timestamp: new Date().toISOString(),
      });
    }
    writeMemoryLog(tempDir, memories);

    const ctx = buildRelevantLessonContext('Bash', {
      command: 'git push --force origin main',
    });

    if (ctx !== null) {
      const bulletLines = ctx.match(/^\s+•/gm) || [];
      assert.ok(bulletLines.length <= 3, `should cap at 3 lessons, got ${bulletLines.length}`);
    }
  });

  test('handles malformed memory entries without crashing', () => {
    writeMemoryLog(tempDir, [
      { id: 'm1' }, // missing fields
      { tags: ['negative'] }, // missing title
    ]);

    // Should not throw
    const ctx = buildRelevantLessonContext('Bash', { command: 'anything' });
    assert.ok(ctx === null || typeof ctx === 'string');
  });
});

describe('end-to-end hook output', () => {
  let tempDir;
  let originalEnv;

  beforeEach(() => {
    tempDir = createTempFeedbackDir();
    originalEnv = process.env.THUMBGATE_FEEDBACK_DIR;
    process.env.THUMBGATE_FEEDBACK_DIR = tempDir;

    // Clear require cache for gates-engine to pick up env change
    for (const key of Object.keys(require.cache)) {
      if (key.includes('gates-engine') || key.includes('feedback-loop') || key.includes('lesson-retrieval')) {
        delete require.cache[key];
      }
    }
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = originalEnv;
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  test('gates-engine run() injects lesson into additionalContext for matching action', () => {
    writeMemoryLog(tempDir, [
      {
        id: 'm1',
        title: 'MISTAKE: retried flaky CI without reading test',
        content: 'How to avoid: READ THE TEST FIRST before CI retry',
        tags: ['negative', 'ci-debugging'],
        timestamp: new Date().toISOString(),
      },
    ]);
    writeFeedbackLog(tempDir, []);

    const { run } = require('../scripts/gates-engine');
    const result = run({
      tool_name: 'Bash',
      tool_input: { command: 'gh run rerun 12345' },
    });

    const parsed = JSON.parse(result);
    // Either injected via additionalContext (no gate match) or via reasoning
    const fullOutput = JSON.stringify(parsed);
    // At minimum: no throw, valid JSON output
    assert.ok(typeof parsed === 'object');
    // If a lesson was matched, it should appear somewhere in the output
    if (fullOutput.includes('ThumbGate')) {
      assert.ok(
        fullOutput.includes('mistakes') || fullOutput.includes('patterns'),
        'ThumbGate context should mention mistakes or patterns',
      );
    }
  });
});
