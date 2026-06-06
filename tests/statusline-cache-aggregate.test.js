'use strict';

// This file used to test a cache-layer aggregator that summed thumbs_up/down
// across every per-folder statusline_cache.json. That implementation
// double-counted, because the global aggregate cache at
// ~/.thumbgate/statusline_cache.json is itself written as the cross-store sum
// (by feedback-aggregate.js / hook-thumbgate-cache-updater.js). Summing the
// aggregate plus the per-folder caches produced bogus totals like 1152↑/747↓
// when the true cross-store total was 727/600.
//
// The fix: statusline-cache-read.js now only resolves the highest-priority
// existing cache file and returns its content unchanged. These tests pin that
// non-summing behavior so the double-count bug cannot return.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readResolvedStatuslineCache } = require('../scripts/statusline-cache-read');

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-statusline-cache-read-'));
  const home = path.join(root, 'home');
  const projects = path.join(home, '.thumbgate', 'projects');
  const projectDir = path.join(root, 'project');
  const feedbackDir = path.join(projectDir, '.claude', 'memory', 'feedback');
  fs.mkdirSync(projects, { recursive: true });
  fs.mkdirSync(feedbackDir, { recursive: true });
  return { root, home, projects, projectDir, feedbackDir };
}

function writeCache(dir, payload) {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'statusline_cache.json');
  fs.writeFileSync(target, JSON.stringify(payload));
  return target;
}

function withSandbox(sandbox, fn) {
  const prev = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    THUMBGATE_PROJECT_DIR: process.env.THUMBGATE_PROJECT_DIR,
    CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR,
    THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
    THUMBGATE_FALLBACK_FEEDBACK_DIR: process.env.THUMBGATE_FALLBACK_FEEDBACK_DIR,
    _TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR: process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR,
    THUMBGATE_STATUSLINE_AGGREGATE: process.env.THUMBGATE_STATUSLINE_AGGREGATE,
    THUMBGATE_AGGREGATE_FEEDBACK: process.env.THUMBGATE_AGGREGATE_FEEDBACK,
  };
  process.env.HOME = sandbox.home;
  process.env.USERPROFILE = sandbox.home;
  process.env.THUMBGATE_PROJECT_DIR = sandbox.projectDir;
  process.env.CLAUDE_PROJECT_DIR = sandbox.projectDir;
  process.env.THUMBGATE_FEEDBACK_DIR = sandbox.feedbackDir;
  process.env.THUMBGATE_FALLBACK_FEEDBACK_DIR = sandbox.feedbackDir;
  process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR = sandbox.feedbackDir;
  delete process.env.THUMBGATE_STATUSLINE_AGGREGATE;
  delete process.env.THUMBGATE_AGGREGATE_FEEDBACK;
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('readResolvedStatuslineCache returns the canonical aggregate cache verbatim, never sums', () => {
  const sandbox = makeSandbox();
  const { home, projectDir } = sandbox;
  // The canonical global aggregate — this is what feedback-aggregate.js writes.
  writeCache(path.join(home, '.thumbgate'), {
    thumbs_up: '727',
    thumbs_down: '600',
    approval_rate: '54.8',
    trend: 'degrading',
    total_feedback: '1327',
    updated_at: '1780777800',
  });
  // Per-folder snapshots — must NOT be summed into the result. The 424 here is
  // a subset already included in the 727 above.
  writeCache(path.join(home, '.thumbgate', 'projects', 'demo'), {
    thumbs_up: '424',
    thumbs_down: '146',
    updated_at: '1780766800',
  });
  writeCache(sandbox.feedbackDir, {
    thumbs_up: '50',
    thumbs_down: '50',
    updated_at: '1780760000',
  });

  const resolved = withSandbox(sandbox, () => {
    // The aggregate path is suppressed when THUMBGATE_FEEDBACK_DIR is under
    // os.tmpdir() (test-isolation guard). For THIS test we are exercising
    // production semantics, so unset that env to allow the aggregate to win.
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    delete process.env.THUMBGATE_FALLBACK_FEEDBACK_DIR;
    delete process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR;
    return readResolvedStatuslineCache({ cwd: projectDir });
  });
  assert.ok(resolved, 'expected a resolved cache');
  assert.equal(resolved.thumbs_up, '727', 'must return canonical aggregate value, NOT the sum');
  assert.equal(resolved.thumbs_down, '600');
  assert.equal(resolved.trend, 'degrading');
  assert.equal(resolved.approval_rate, '54.8');
  assert.equal(resolved.source, path.join(home, '.thumbgate', 'statusline_cache.json'));
});

test('readResolvedStatuslineCache falls back to project cache when no canonical aggregate exists', () => {
  const sandbox = makeSandbox();
  const { projectDir, feedbackDir } = sandbox;
  // Only a per-project cache, no global aggregate file.
  writeCache(feedbackDir, {
    thumbs_up: '12',
    thumbs_down: '3',
    trend: 'stable',
    updated_at: '1780760000',
  });

  const resolved = withSandbox(sandbox, () => readResolvedStatuslineCache({ cwd: projectDir }));
  assert.ok(resolved);
  assert.equal(resolved.thumbs_up, '12');
  assert.equal(resolved.thumbs_down, '3');
});

test('readResolvedStatuslineCache returns null when no cache exists', () => {
  const sandbox = makeSandbox();
  const result = withSandbox(sandbox, () => readResolvedStatuslineCache({ cwd: sandbox.projectDir }));
  assert.equal(result, null);
});

test('readResolvedStatuslineCache skips unparseable files and uses next candidate', () => {
  const sandbox = makeSandbox();
  const { home, projectDir, feedbackDir } = sandbox;
  // Broken canonical aggregate cache.
  const broken = path.join(home, '.thumbgate', 'statusline_cache.json');
  fs.mkdirSync(path.dirname(broken), { recursive: true });
  fs.writeFileSync(broken, '{not json');
  // Valid project cache as fallback.
  writeCache(feedbackDir, {
    thumbs_up: '99',
    thumbs_down: '1',
    updated_at: '1780760000',
  });

  const resolved = withSandbox(sandbox, () => readResolvedStatuslineCache({ cwd: projectDir }));
  assert.ok(resolved, 'should fall through to the next valid candidate');
  assert.equal(resolved.thumbs_up, '99');
  assert.equal(resolved.thumbs_down, '1');
});
