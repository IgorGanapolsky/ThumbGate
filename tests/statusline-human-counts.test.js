'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isCountedHumanFeedback } = require('../scripts/human-feedback');
const { buildLinkState } = require('../scripts/statusline-links');
const { resolveLocalProject } = require('../scripts/project-identity');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'statusline-human-counts.js');

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function entry(projectKey, i, extra) {
  return {
    id: `fb_${projectKey.slice(-6)}_${i}_${extra.signal}`,
    timestamp: new Date(Date.now() - i * 1000).toISOString(),
    projectKey,
    ...extra,
  };
}

test('orchestrator with 1 human negative and 50 automated entries renders 0 up, 1 down', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-statusline-home-'));
  const project = path.join(home, 'orchestrator');
  fs.mkdirSync(project, { recursive: true });
  const { projectKey } = resolveLocalProject(project);
  const otherKey = 'local_' + 'b'.repeat(64);

  const rows = [entry(projectKey, 0, { signal: 'negative', reviewOrigin: 'human', tags: ['statusline', 'quick-capture'] })];
  for (let i = 1; i <= 30; i += 1) rows.push(entry(projectKey, i, { signal: i % 2 ? 'positive' : 'negative', reviewOrigin: 'automated' }));
  for (let i = 31; i <= 50; i += 1) {
    rows.push(entry(projectKey, i, { signal: 'positive', reviewOrigin: 'human', tags: ['claude-history-sync', 'auto-capture-fallback'] }));
  }
  writeJsonl(path.join(project, '.thumbgate', 'feedback-log.jsonl'), rows);

  // Another project's human thumbs in the shared global store must not leak in.
  const globalRows = [];
  for (let i = 0; i < 45; i += 1) globalRows.push(entry(otherKey, i, { signal: 'positive', reviewOrigin: 'human', tags: ['statusline'] }));
  writeJsonl(path.join(home, '.thumbgate', 'feedback-log.jsonl'), globalRows);

  const run = spawnSync(process.execPath, [SCRIPT], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, THUMBGATE_FEEDBACK_DIR: '', THUMBGATE_PROJECT_DIR: '' },
  });
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.equal(out.up, 0);
  assert.equal(out.down, 1);
  assert.equal(out.label, 'this project');
  fs.rmSync(home, { recursive: true, force: true });
});

test('only deliberate human entries count', () => {
  assert.equal(isCountedHumanFeedback({ reviewOrigin: 'human', tags: ['statusline', 'quick-capture'] }), true);
  assert.equal(isCountedHumanFeedback({ reviewOrigin: 'human', tags: [] }), true);
  assert.equal(isCountedHumanFeedback({ reviewOrigin: 'automated', tags: [] }), false);
  assert.equal(isCountedHumanFeedback({ reviewOrigin: 'imported' }), false);
  assert.equal(isCountedHumanFeedback({ reviewOrigin: 'human', tags: ['claude-history-sync'] }), false);
  assert.equal(isCountedHumanFeedback({ reviewOrigin: 'human', tags: ['auto-capture-fallback'] }), false);
  assert.equal(isCountedHumanFeedback({ reviewOrigin: 'human', tags: ['auto-hook'] }), false);
  assert.equal(isCountedHumanFeedback(null), false);
});

test('status line thumb links carry the project so the click is recorded for it', () => {
  const links = buildLinkState({ ready: true, booting: false, origin: 'http://127.0.0.1:9876', canBootstrap: true, projectDir: '/work/orchestrator' });
  assert.match(links.downUrl, /signal=down&projectDir=%2Fwork%2Forchestrator$/);
  assert.match(links.upUrl, /signal=up&projectDir=%2Fwork%2Forchestrator$/);
});
