'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'validate-social-post.js');
const {
  charCount,
  extractBlocks,
  evaluateBlock,
  parseArgs,
  previewBody,
  resultMarker,
} = require('../scripts/validate-social-post');

test('charCount uses publish-time UTF-16 code units', () => {
  assert.equal(charCount('agent'), 5);
  assert.equal(charCount('👍'), 2);
});

test('parseArgs accepts inline text, stdin marker, and files', () => {
  assert.deepEqual(parseArgs(['node', SCRIPT, '--text', 'hello', '-', 'draft.md']), {
    files: ['-', 'draft.md'],
    text: 'hello',
  });
});

test('extractBlocks reads fenced markdown posts before fallback body', () => {
  const blocks = extractBlocks({
    name: 'draft.md',
    body: [
      'Context outside the post.',
      '```post',
      'First post',
      '```',
      '```tweet',
      'Second post',
      '```',
    ].join('\n'),
  });

  assert.deepEqual(blocks, [
    { label: 'draft.md block#1', body: 'First post' },
    { label: 'draft.md block#2', body: 'Second post' },
  ]);
});

test('evaluateBlock separates blocking feed limits from awareness-only HN title limits', () => {
  const evaluation = evaluateBlock({
    label: 'long social draft',
    body: 'x'.repeat(600),
  });
  const threads = evaluation.results.find((result) => result.platform === 'threads');
  const hnTitle = evaluation.results.find((result) => result.platform === 'hn_title');

  assert.equal(evaluation.len, 600);
  assert.equal(threads.ok, false);
  assert.equal(threads.blocking, true);
  assert.equal(threads.over, 100);
  assert.equal(hnTitle.ok, false);
  assert.equal(hnTitle.blocking, false);
});

test('previewBody flattens multiline drafts without growing past preview length', () => {
  const preview = previewBody(`${'a'.repeat(60)}\n${'b'.repeat(80)}`);
  assert.equal(preview.includes('\n'), false);
  assert.match(preview, /…$/);
});

test('resultMarker matches pass, blocking fail, and warning states', () => {
  assert.equal(resultMarker({ ok: true, blocking: true }), '✓');
  assert.equal(resultMarker({ ok: false, blocking: true }), '✗');
  assert.equal(resultMarker({ ok: false, blocking: false }), '⚠');
});

test('CLI exits 0 when every feed platform accepts the draft', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--text', 'ThumbGate blocks repeated agent mistakes before action.'], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /All drafts fit every platform limit/);
});

test('CLI exits 1 when a feed platform would reject the draft', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--text', 'x'.repeat(600)], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /platform limit\(s\) exceeded/);
});
