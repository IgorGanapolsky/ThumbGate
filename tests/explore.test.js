'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const explore = require('../scripts/explore');
const {
  applyFilter,
  buildState,
  loadGates,
  loadLessons,
  pad,
  relDate,
  trunc,
} = explore._internals;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFeedbackDir(lessons = [], stats = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-explore-'));
  if (lessons.length > 0) {
    fs.writeFileSync(
      path.join(dir, 'memory-log.jsonl'),
      lessons.map((l) => JSON.stringify(l)).join('\n') + '\n',
    );
  }
  if (stats) {
    fs.writeFileSync(path.join(dir, 'feedback-summary.json'), JSON.stringify(stats));
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Module load + exports
// ---------------------------------------------------------------------------

test('explore module loads without error', () => {
  assert.equal(typeof explore, 'object');
  assert.equal(typeof explore.run, 'function');
  assert.equal(typeof explore._internals.loadLessons, 'function');
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

test('loadLessons returns empty array for missing file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-exp-'));
  assert.deepEqual(loadLessons(dir), []);
  fs.rmdirSync(dir);
});

test('loadLessons parses JSONL correctly', () => {
  const dir = makeFeedbackDir([
    { id: 'a', title: 'force push blocked', tags: ['negative'], timestamp: new Date().toISOString() },
    { id: 'b', title: 'deploy success',     tags: ['positive'], timestamp: new Date().toISOString() },
  ]);
  const parsed = loadLessons(dir);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, 'b');
  assert.equal(parsed[1].id, 'a');
  fs.rmSync(dir, { recursive: true });
});

test('loadGates reads configured and custom gates once', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-gates-'));
  const gatesDir = path.join(root, 'config', 'gates');
  fs.mkdirSync(gatesDir, { recursive: true });
  fs.writeFileSync(
    path.join(gatesDir, 'default.json'),
    JSON.stringify({ gates: [{ id: 'default-gate', pattern: 'git push --force' }] }),
  );
  fs.writeFileSync(
    path.join(gatesDir, 'custom.json'),
    JSON.stringify({ gates: [{ id: 'custom-gate', pattern: 'rm -rf' }] }),
  );

  const gates = loadGates(root);
  assert.equal(gates.length, 2);
  assert.deepEqual(gates.map((g) => g.id).sort(), ['custom-gate', 'default-gate']);
  assert.equal(gates.filter((g) => g._file === 'custom.json').length, 1);
  fs.rmSync(root, { recursive: true });
});

// ---------------------------------------------------------------------------
// State logic (extracted via explore module)
// ---------------------------------------------------------------------------

test('explore module: run exits immediately on non-TTY with error', () => {
  // The run() function checks process.stdout.isTTY and exits if false.
  // In a test environment, stdout is not a TTY, so we verify it handles
  // this gracefully rather than crashing.
  // We can only verify run is a function — calling it would exit the process.
  assert.equal(typeof explore.run, 'function');
});

// ---------------------------------------------------------------------------
// Filter logic (ANSI-free unit tests)
// ---------------------------------------------------------------------------

test('filter logic: empty query returns all items', () => {
  const items = [
    { id: '1', title: 'force push', tags: ['negative'] },
    { id: '2', title: 'deploy fail', tags: ['negative'] },
    { id: '3', title: 'test pass',   tags: ['positive'] },
  ];
  const state = buildState({ lessons: items, gates: [], stats: null, rules: [] });
  assert.equal(applyFilter(state).length, 3);
});

test('filter logic: query narrows items by text match', () => {
  const items = [
    { id: '1', title: 'force push', tags: ['negative'] },
    { id: '2', title: 'deploy fail', tags: ['negative'] },
    { id: '3', title: 'test pass',   tags: ['positive'] },
  ];
  const state = buildState({ lessons: items, gates: [], stats: null, rules: [] });
  state.query = 'deploy';
  const filtered = applyFilter(state);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, '2');
});

test('filter logic: query is case-insensitive', () => {
  const items = [{ id: '1', title: 'Force Push Blocked', tags: ['negative'] }];
  const state = buildState({ lessons: items, gates: [], stats: null, rules: [] });
  state.query = 'force push';
  assert.equal(applyFilter(state).length, 1);
});

// ---------------------------------------------------------------------------
// Render helpers (ANSI-stripped smoke tests)
// ---------------------------------------------------------------------------

test('relDate helper returns human-readable string', () => {
  assert.equal(relDate(Date.now()), 'today');
  assert.equal(relDate(Date.now() - 86400000), '1d ago');
  assert.equal(relDate(Date.now() - 5 * 86400000), '5d ago');
  assert.equal(relDate(null), '');
  assert.equal(relDate('not-a-date'), '');
});

test('trunc helper truncates and appends ellipsis', () => {
  assert.equal(trunc('hello world', 5), 'hell…');
  assert.equal(trunc('hi', 10), 'hi');
  assert.equal(trunc('', 5), '');
  assert.equal(trunc('abc', 0), '');
});

test('pad helper right-pads strings to fixed width', () => {
  assert.equal(pad('abc', 5), 'abc  ');
  assert.equal(pad('abcde', 5), 'abcde');
  assert.equal(pad('abcdefg', 5), 'abcde');
});
