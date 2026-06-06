'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LOCAL_STATS_PATH = path.join(__dirname, '..', 'scripts', 'statusline-local-stats.js');
const {
  getStatuslineCacheCandidates,
} = require('../scripts/statusline-cache-path');
const {
  collectAggregateLogEntries,
  computeAggregateFeedbackStats,
} = require('../scripts/feedback-aggregate');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function feedback(id, signal, daysAgo = 0, extra = {}) {
  const timestamp = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return {
    id,
    signal,
    context: `${signal} feedback ${id}`,
    timestamp,
    ...extra,
  };
}

test('statusline stats aggregate active project, parent workspace, and global stores', () => {
  const root = tmpDir('thumbgate-aggregate-');
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const project = path.join(workspace, 'ThumbGate', 'repo');
  const projectStore = path.join(project, '.thumbgate');
  const parentStore = path.join(workspace, '.thumbgate');
  const globalStore = path.join(home, '.thumbgate', 'projects', 'AnswerGuard');

  writeJsonl(path.join(projectStore, 'feedback-log.jsonl'), [
    feedback('local-up-1', 'positive'),
    feedback('duplicate-down', 'negative'),
  ]);
  writeJsonl(path.join(parentStore, 'feedback-log.jsonl'), [
    feedback('parent-down-1', 'negative'),
    feedback('parent-down-2', 'negative'),
  ]);
  writeJsonl(path.join(globalStore, 'feedback-log.jsonl'), [
    feedback('global-up-1', 'positive'),
    feedback('duplicate-down', 'negative'),
  ]);

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    THUMBGATE_PROJECT_DIR: project,
    THUMBGATE_NO_NUDGE: '1',
  };
  const output = execFileSync(process.execPath, [LOCAL_STATS_PATH], {
    encoding: 'utf8',
    cwd: project,
    env,
  });
  const stats = JSON.parse(output);

  assert.equal(stats.thumbs_up, '2');
  assert.equal(stats.thumbs_down, '3');
  assert.equal(stats.total_feedback, '5');
  assert.equal(stats.aggregate.enabled, true);
  assert.equal(stats.aggregate.stores, 3);

  fs.rmSync(root, { recursive: true, force: true });
});

test('statusline aggregation can be disabled for local-only compatibility', () => {
  const root = tmpDir('thumbgate-local-only-');
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const projectStore = path.join(project, '.thumbgate');
  const globalStore = path.join(home, '.thumbgate', 'projects', 'other-project');

  writeJsonl(path.join(projectStore, 'feedback-log.jsonl'), [
    feedback('local-up-1', 'positive'),
  ]);
  writeJsonl(path.join(globalStore, 'feedback-log.jsonl'), [
    feedback('global-down-1', 'negative'),
    feedback('global-down-2', 'negative'),
  ]);

  const output = execFileSync(process.execPath, [LOCAL_STATS_PATH], {
    encoding: 'utf8',
    cwd: project,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      THUMBGATE_PROJECT_DIR: project,
      THUMBGATE_STATUSLINE_AGGREGATE: '0',
      THUMBGATE_NO_NUDGE: '1',
    },
  });
  const stats = JSON.parse(output);

  assert.equal(stats.thumbs_up, '1');
  assert.equal(stats.thumbs_down, '0');
  assert.equal(stats.total_feedback, '1');
  assert.equal(stats.aggregate.enabled, false);

  fs.rmSync(root, { recursive: true, force: true });
});

test('aggregate statusline cache is preferred over a stale project-local cache', () => {
  const root = tmpDir('thumbgate-cache-pref-');
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const projectStore = path.join(project, '.thumbgate');
  fs.mkdirSync(projectStore, { recursive: true });
  fs.mkdirSync(path.join(home, '.thumbgate'), { recursive: true });

  const candidates = getStatuslineCacheCandidates({
    cwd: project,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      THUMBGATE_PROJECT_DIR: project,
    },
  });

  assert.equal(candidates[0], path.join(home, '.thumbgate', 'statusline_cache.json'));
  assert.ok(candidates.includes(path.join(projectStore, 'statusline_cache.json')));

  fs.rmSync(root, { recursive: true, force: true });
});

test('aggregate entry reader keeps temp feedback dirs isolated unless roots are explicit', () => {
  const root = tmpDir('thumbgate-temp-isolated-');
  const home = path.join(root, 'home');
  const localStore = path.join(root, 'isolated-feedback');
  const globalStore = path.join(home, '.thumbgate', 'projects', 'global-project');

  writeJsonl(path.join(localStore, 'feedback-log.jsonl'), [
    feedback('local-up-1', 'positive'),
  ]);
  writeJsonl(path.join(globalStore, 'feedback-log.jsonl'), [
    feedback('global-down-1', 'negative'),
  ]);

  const stats = computeAggregateFeedbackStats({
    feedbackDir: localStore,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  const rows = collectAggregateLogEntries('feedback-log.jsonl', {
    feedbackDir: localStore,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });

  assert.equal(stats.total, 1);
  assert.equal(stats.totalPositive, 1);
  assert.equal(rows.entries.length, 1);

  fs.rmSync(root, { recursive: true, force: true });
});
