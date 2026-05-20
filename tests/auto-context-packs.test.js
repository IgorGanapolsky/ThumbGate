// tests/auto-context-packs.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  generateAutoContextPacks,
  getTopBlockedGateIds,
  getTopFailureTags,
} = require('../scripts/auto-context-packs');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-ctxpacks-test-'));
}

// -- getTopBlockedGateIds --

test('getTopBlockedGateIds: returns empty array when no gates', () => {
  const result = getTopBlockedGateIds({ gates: [] });
  assert.deepStrictEqual(result, []);
});

test('getTopBlockedGateIds: returns top 5 by occurrences', () => {
  const stats = {
    gates: [
      { id: 'gate-a', action: 'block', occurrences: 10 },
      { id: 'gate-b', action: 'block', occurrences: 5 },
      { id: 'gate-c', action: 'block', occurrences: 3 },
      { id: 'gate-d', action: 'block', occurrences: 2 },
      { id: 'gate-e', action: 'block', occurrences: 1 },
      { id: 'gate-f', action: 'block', occurrences: 8 },
      { id: 'gate-warn', action: 'warn', occurrences: 99 },
    ],
  };
  const result = getTopBlockedGateIds(stats);
  assert.strictEqual(result.length, 5);
  assert.strictEqual(result[0], 'gate-a');
  assert.strictEqual(result[1], 'gate-f');
  assert.ok(!result.includes('gate-warn'), 'warn gates should not appear');
});

test('getTopBlockedGateIds: excludes gates with zero occurrences', () => {
  const stats = {
    gates: [
      { id: 'gate-x', action: 'block', occurrences: 0 },
      { id: 'gate-y', action: 'block', occurrences: 4 },
    ],
  };
  const result = getTopBlockedGateIds(stats);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0], 'gate-y');
});

// -- getTopFailureTags --

test('getTopFailureTags: returns empty array when no tags', () => {
  const result = getTopFailureTags({ tags: {} });
  assert.deepStrictEqual(result, []);
});

test('getTopFailureTags: returns top 5 by negative count', () => {
  const analysis = {
    tags: {
      'security':    { positive: 0, negative: 10, total: 10 },
      'git-workflow': { positive: 1, negative: 8, total: 9 },
      'testing':     { positive: 5, negative: 6, total: 11 },
      'deployment':  { positive: 0, negative: 4, total: 4 },
      'api':         { positive: 2, negative: 3, total: 5 },
      'docs':        { positive: 3, negative: 2, total: 5 },
      'no-failures': { positive: 5, negative: 0, total: 5 },
    },
  };
  const result = getTopFailureTags(analysis);
  assert.strictEqual(result.length, 5);
  assert.strictEqual(result[0], 'security');
  assert.ok(!result.includes('no-failures'), 'zero-negative tags should not appear');
});

// -- generateAutoContextPacks --

test('generateAutoContextPacks: returns object with expected shape', () => {
  const tmpDir = makeTmpDir();
  const result = generateAutoContextPacks({ outputDir: tmpDir });
  assert.ok(typeof result === 'object', 'result is an object');
  assert.ok(typeof result.packCount === 'number', 'packCount is a number');
  assert.ok(Array.isArray(result.packs), 'packs is an array');
  assert.strictEqual(result.packs.length, result.packCount, 'packCount matches packs length');
});

test('generateAutoContextPacks: does not throw when feedback log is empty', () => {
  const tmpDir = makeTmpDir();
  const emptyLog = path.join(tmpDir, 'feedback-log.jsonl');
  fs.writeFileSync(emptyLog, '');
  assert.doesNotThrow(() => {
    generateAutoContextPacks({ feedbackLogPath: emptyLog, outputDir: tmpDir });
  });
});

test('generateAutoContextPacks: does not throw when feedback log is missing', () => {
  const tmpDir = makeTmpDir();
  assert.doesNotThrow(() => {
    generateAutoContextPacks({
      feedbackLogPath: path.join(tmpDir, 'nonexistent.jsonl'),
      outputDir: tmpDir,
    });
  });
});

test('generateAutoContextPacks: writes JSON files for packs', () => {
  const tmpDir = makeTmpDir();
  // Write a minimal feedback log with some negative entries
  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  const entries = [
    { signal: 'negative', tags: ['security', 'git-workflow'], context: 'bad git push', whatWentWrong: 'force pushed main', timestamp: new Date().toISOString() },
    { signal: 'negative', tags: ['security'], context: 'leaked key', whatWentWrong: 'secret committed', whatToChange: 'use env vars', timestamp: new Date().toISOString() },
    { signal: 'positive', tags: ['testing'], context: 'tests passed', timestamp: new Date().toISOString() },
  ];
  fs.writeFileSync(logPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

  const result = generateAutoContextPacks({ feedbackLogPath: logPath, outputDir: tmpDir });

  // Any packs that were generated should be valid JSON files on disk
  for (const p of result.packs) {
    assert.ok(fs.existsSync(p.filePath), `pack file exists: ${p.filePath}`);
    const content = JSON.parse(fs.readFileSync(p.filePath, 'utf-8'));
    assert.ok(typeof content.type === 'string', 'pack has type field');
    assert.ok(typeof content.generatedAt === 'string', 'pack has generatedAt field');
    assert.ok(Array.isArray(content.recentFeedback), 'pack has recentFeedback array');
    assert.ok(Array.isArray(content.correctiveActions), 'pack has correctiveActions array');
  }
});
