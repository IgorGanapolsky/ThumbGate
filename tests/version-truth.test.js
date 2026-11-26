const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, parseChangelogTop } = require('../scripts/check-version-truth');

test('all sources agree: no problems', () => {
  const r = compareVersions({ package: '1.44.0', tag: '1.44.0', npmLatest: '1.44.0', health: '1.44.0', changelog: '1.44.0' });
  assert.deepEqual(r.problems, []);
});

test('a disagreeing source is named with both values', () => {
  const r = compareVersions({ package: '1.44.0', npmLatest: '1.44.0', health: '1.42.0' });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /health 1\.42\.0 != package 1\.44\.0/);
});

test('missing sources are skipped, not treated as agreement or failure', () => {
  const r = compareVersions({ package: '1.44.0', npmLatest: null, health: undefined });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.checked, ['package']);
});

test('PR mode lets package.json be ahead of npm latest and health, never behind', () => {
  const ahead = compareVersions({ package: '1.45.0', npmLatest: '1.44.0', health: '1.42.0' }, { allowAhead: true });
  assert.deepEqual(ahead.problems, []);
  const behind = compareVersions({ package: '1.43.0', npmLatest: '1.44.0' }, { allowAhead: true });
  assert.equal(behind.problems.length, 1);
});

test('changelog top heading is parsed', () => {
  assert.equal(parseChangelogTop('# Changelog\n\n## 1.45.0\n\nx\n\n## 1.44.0\n'), '1.45.0');
  assert.equal(parseChangelogTop('nothing here'), null);
});
