'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  aggregateStatuslineCaches,
  getAggregationCandidates,
  readResolvedStatuslineCache,
} = require('../scripts/statusline-cache-read');

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-statusline-agg-'));
  const home = path.join(root, 'home');
  const projects = path.join(home, '.thumbgate', 'projects');
  fs.mkdirSync(projects, { recursive: true });
  return { root, home, projects };
}

function writeCache(dir, payload) {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'statusline_cache.json');
  fs.writeFileSync(target, JSON.stringify(payload));
  return target;
}

function withHome(home, fn) {
  const prev = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    THUMBGATE_PROJECT_DIR: process.env.THUMBGATE_PROJECT_DIR,
    THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
    THUMBGATE_STATUSLINE_AGGREGATE: process.env.THUMBGATE_STATUSLINE_AGGREGATE,
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.THUMBGATE_PROJECT_DIR;
  delete process.env.THUMBGATE_FEEDBACK_DIR;
  delete process.env.THUMBGATE_STATUSLINE_AGGREGATE;
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('aggregateStatuslineCaches sums per-folder caches and recomputes approval rate', () => {
  const { root, home, projects } = makeSandbox();
  writeCache(path.join(home, '.thumbgate'), {
    thumbs_up: '49',
    thumbs_down: '188',
    lessons: '0',
    total_feedback: '237',
    updated_at: '1780763504',
    trend: 'stable',
  });
  writeCache(path.join(projects, 'demo'), {
    thumbs_up: '23',
    thumbs_down: '40',
    lessons: '1',
    total_feedback: '63',
    updated_at: '1780764139',
    trend: 'up',
    last_lesson: { summary: 'most recent lesson' },
  });
  writeCache(path.join(projects, 'other'), {
    thumbs_up: 8,
    thumbs_down: 0,
    lessons: 0,
    total_feedback: 8,
    updated_at: '1780700000',
    trend: 'flat',
  });

  const result = withHome(home, () => aggregateStatuslineCaches({ cwd: root }));
  assert.ok(result, 'expected aggregated payload');
  assert.equal(result.thumbs_up, '80');
  assert.equal(result.thumbs_down, '228');
  assert.equal(result.lessons, '1');
  assert.equal(result.total_feedback, '308');
  assert.equal(result.approval_rate, '26');
  assert.equal(result.trend, 'up');
  assert.equal(result.updated_at, '1780764139');
  assert.deepEqual(result.last_lesson, { summary: 'most recent lesson' });
  assert.equal(result.aggregated, true);
  assert.equal(result.sources_count, 3);
});

test('aggregateStatuslineCaches skips archive paths', () => {
  const { root, home } = makeSandbox();
  writeCache(path.join(home, '.thumbgate'), { thumbs_up: '10', thumbs_down: '0', updated_at: '1' });
  const archiveDir = path.join(home, '.tg-archive-12345');
  writeCache(archiveDir, { thumbs_up: '999', thumbs_down: '999', updated_at: '2' });
  writeCache(path.join(archiveDir, 'projects', 'demo'), { thumbs_up: '999', thumbs_down: '999', updated_at: '3' });

  const candidates = withHome(home, () => getAggregationCandidates({ cwd: root }));
  for (const candidate of candidates) {
    assert.ok(!candidate.includes('.tg-archive-'), `archive path leaked into candidates: ${candidate}`);
  }
  const result = withHome(home, () => aggregateStatuslineCaches({ cwd: root }));
  assert.equal(result.thumbs_up, '10', 'archive caches must not contribute to totals');
  assert.equal(result.thumbs_down, '0');
});

test('aggregateStatuslineCaches returns null when no caches exist', () => {
  const { root, home } = makeSandbox();
  const result = withHome(home, () => aggregateStatuslineCaches({ cwd: root }));
  assert.equal(result, null);
});

test('aggregateStatuslineCaches handles unparseable files without throwing', () => {
  const { root, home } = makeSandbox();
  const globalDir = path.join(home, '.thumbgate');
  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(path.join(globalDir, 'statusline_cache.json'), '{not json');
  const projDir = path.join(home, '.thumbgate', 'projects', 'demo');
  writeCache(projDir, { thumbs_up: '5', thumbs_down: '5', updated_at: '100' });

  const result = withHome(home, () => aggregateStatuslineCaches({ cwd: root }));
  assert.ok(result, 'should still aggregate from parseable file');
  assert.equal(result.thumbs_up, '5');
  assert.equal(result.approval_rate, '50');
});

test('approval_rate is "0" when no feedback has been captured', () => {
  const { root, home } = makeSandbox();
  writeCache(path.join(home, '.thumbgate'), { thumbs_up: '0', thumbs_down: '0', updated_at: '1' });
  const result = withHome(home, () => aggregateStatuslineCaches({ cwd: root }));
  assert.equal(result.approval_rate, '0');
});

test('readResolvedStatuslineCache prefers aggregation by default', () => {
  const { root, home } = makeSandbox();
  writeCache(path.join(home, '.thumbgate'), { thumbs_up: '10', thumbs_down: '0', updated_at: '1' });
  writeCache(path.join(home, '.thumbgate', 'projects', 'demo'), {
    thumbs_up: '5',
    thumbs_down: '5',
    updated_at: '2',
  });
  const resolved = withHome(home, () => readResolvedStatuslineCache({ cwd: root }));
  assert.equal(resolved.aggregated, true);
  assert.equal(resolved.thumbs_up, '15');
  assert.equal(resolved.thumbs_down, '5');
});

test('readResolvedStatuslineCache honors THUMBGATE_STATUSLINE_AGGREGATE=0', () => {
  const { root, home } = makeSandbox();
  writeCache(path.join(home, '.thumbgate'), { thumbs_up: '10', thumbs_down: '0', updated_at: '1' });
  writeCache(path.join(home, '.thumbgate', 'projects', 'demo'), {
    thumbs_up: '5',
    thumbs_down: '5',
    updated_at: '2',
  });
  // Aggregation-off falls back to the project-scoped candidate set, so we
  // point the project feedback dir at the home cache so something resolves.
  const feedbackDir = path.join(home, '.thumbgate');

  const resolved = withHome(home, () => {
    process.env.THUMBGATE_STATUSLINE_AGGREGATE = '0';
    process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
    return readResolvedStatuslineCache({ cwd: root });
  });
  assert.ok(resolved, 'expected a resolved (non-aggregated) cache');
  assert.equal(resolved.aggregated, false);
  assert.equal(resolved.sources_count, 1);
  assert.equal(resolved.thumbs_up, '10', 'should NOT have summed across folders');
});
