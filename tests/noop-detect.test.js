'use strict';

// tests/noop-detect.test.js
//
// Point THUMBGATE_STATE_DIR at a tmp dir BEFORE requiring gates-engine /
// noop-detect so the attempts JSON lands in a disposable location. gates-engine
// resolves the state dir from this env var (resolveThumbgateStateDir).

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-noop-detect-'));
process.env.THUMBGATE_STATE_DIR = TMP_DIR;

const {
  VOLATILE_PATTERNS,
  normalizeVolatile,
  computeActionStateHash,
  detectNoop,
  recordActionAttempt,
  isRepeatAttempt,
  attemptsPath,
} = require('../scripts/noop-detect');

after(() => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch (e) {
    /* best effort */
  }
});

// (1) detectNoop file kind: identical content -> noop:true; 1-char change -> false.
test('detectNoop file kind: identical before/after content is a no-op', () => {
  const result = detectNoop({
    kind: 'file',
    before: { content: 'line one\nline two\n' },
    after: { content: 'line one\nline two\n' },
  });
  assert.equal(result.noop, true);
  assert.equal(result.reason, 'file-content-unchanged');
});

test('detectNoop file kind: a one-character change is not a no-op', () => {
  const result = detectNoop({
    kind: 'file',
    before: { content: 'line one\nline two\n' },
    after: { content: 'line one\nline tw0\n' },
  });
  assert.equal(result.noop, false);
  assert.equal(result.reason, 'file-content-changed');
});

// (2) Volatile normalization: outputs differing only by timestamp / 40-char sha /
// trailing whitespace must hash-equal.
test('computeActionStateHash ignores ISO-8601 timestamps', () => {
  const a = computeActionStateHash({
    kind: 'command',
    exitCode: 0,
    stdout: 'Build finished at 2026-05-31T12:34:56Z OK',
  });
  const b = computeActionStateHash({
    kind: 'command',
    exitCode: 0,
    stdout: 'Build finished at 2026-01-01T00:00:00Z OK',
  });
  assert.equal(a, b);
});

test('computeActionStateHash ignores a 40-char commit sha', () => {
  const sha1 = 'a'.repeat(40);
  const sha2 = 'f'.repeat(40);
  const a = computeActionStateHash({
    kind: 'file',
    filePath: 'README.md',
    afterContent: `Deployed commit ${sha1}\n`,
  });
  const b = computeActionStateHash({
    kind: 'file',
    filePath: 'README.md',
    afterContent: `Deployed commit ${sha2}\n`,
  });
  assert.equal(a, b);
});

test('computeActionStateHash ignores trailing whitespace differences', () => {
  const a = computeActionStateHash({ kind: 'file', filePath: 'x', afterContent: 'hello   \nworld\t\n' });
  const b = computeActionStateHash({ kind: 'file', filePath: 'x', afterContent: 'hello\nworld\n' });
  assert.equal(a, b);
});

test('normalizeVolatile collapses ANSI codes, epoch ints, and uuids', () => {
  const withNoise = '\x1b[32mok\x1b[0m id=550e8400-e29b-41d4-a716-446655440000 t=1717159996123';
  const cleaned = normalizeVolatile(withNoise);
  assert.ok(!cleaned.includes('\x1b'));
  assert.ok(cleaned.includes('<UUID>'));
  assert.ok(cleaned.includes('<EPOCH>'));
  assert.ok(Array.isArray(VOLATILE_PATTERNS) && VOLATILE_PATTERNS.length > 0);
});

test('detectNoop file kind: two outputs differing only by a timestamp are a no-op', () => {
  const result = detectNoop({
    kind: 'file',
    before: { content: 'snapshot 2026-05-31T01:02:03Z value=42' },
    after: { content: 'snapshot 2026-12-25T09:09:09Z value=42' },
  });
  assert.equal(result.noop, true);
});

// (3) command kind: same exitCode + same normalized stdout -> noop; diff exit -> not.
test('detectNoop command kind: same exit code and output is a no-op', () => {
  const result = detectNoop({
    before: { kind: 'command', exitCode: 0, stdout: 'all good 2026-05-31T00:00:00Z' },
    after: { kind: 'command', exitCode: 0, stdout: 'all good 2026-06-01T00:00:00Z' },
  });
  assert.equal(result.noop, true);
  assert.equal(result.reason, 'command-output-unchanged');
});

test('detectNoop command kind: a different exit code is not a no-op', () => {
  const result = detectNoop({
    before: { kind: 'command', exitCode: 0, stdout: 'same output' },
    after: { kind: 'command', exitCode: 1, stdout: 'same output' },
  });
  assert.equal(result.noop, false);
  assert.equal(result.reason, 'exit-code-changed');
});

// (4) partial-write guard: a truncated afterContent that is a strict prefix is NOT a no-op.
test('detectNoop file kind: a truncated prefix after-state is not a no-op', () => {
  const before = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
  const after = 'const a = 1;\nconst b = 2;\n'; // strict prefix, shorter -> partial write
  const result = detectNoop({
    kind: 'file',
    before: { content: before },
    after: { content: after },
  });
  assert.equal(result.noop, false);
  assert.equal(result.reason, 'partial-write-truncation');
});

// (5) isRepeatAttempt: first record stores; second identical tuple -> true;
// different stateHash -> false.
test('isRepeatAttempt: same (actionId, stateHash) is a repeat; different hash is not', () => {
  const sessionId = 'sess-1';
  const actionId = 'act-42';
  const hashA = 'hash-aaa';
  const hashB = 'hash-bbb';

  // Before any record, not a repeat.
  assert.equal(isRepeatAttempt(sessionId, actionId, hashA), false);

  const first = recordActionAttempt(sessionId, actionId, hashA);
  assert.equal(first.recorded, true);
  assert.equal(first.alreadySeen, false);

  // Second identical tuple -> repeat.
  assert.equal(isRepeatAttempt(sessionId, actionId, hashA), true);
  const second = recordActionAttempt(sessionId, actionId, hashA);
  assert.equal(second.alreadySeen, true);

  // Different stateHash for the same action -> not a repeat.
  assert.equal(isRepeatAttempt(sessionId, actionId, hashB), false);

  // The attempts file lives beside session-actions.json under the tmp state dir.
  assert.ok(attemptsPath().startsWith(TMP_DIR));
  assert.ok(fs.existsSync(attemptsPath()));
});

test('isRepeatAttempt: attempts are scoped per session', () => {
  const actionId = 'act-scope';
  const stateHash = 'hash-scope';
  recordActionAttempt('session-A', actionId, stateHash);
  assert.equal(isRepeatAttempt('session-A', actionId, stateHash), true);
  assert.equal(isRepeatAttempt('session-B', actionId, stateHash), false);
});
