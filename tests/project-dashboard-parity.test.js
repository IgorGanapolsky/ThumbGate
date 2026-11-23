'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPTS = path.join(__dirname, '..', 'scripts');

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

// Run a snippet in a clean child whose HOME is the fixture: a local project key hashes a per-HOME identity.
function inChild(home, code, ...args) {
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, TMPDIR: process.env.TMPDIR || os.tmpdir() };
  const run = spawnSync(process.execPath, ['-e', code, ...args], { encoding: 'utf8', env, cwd: home });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-parity-'));
  const projects = { alpha: path.join(home, 'alpha'), beta: path.join(home, 'beta') };
  for (const dir of Object.values(projects)) fs.mkdirSync(dir, { recursive: true });
  const key = (dir) => inChild(home, 'console.log(JSON.stringify(require(process.argv[1]).resolveLocalProject(process.argv[2]).projectKey))', path.join(SCRIPTS, 'project-identity.js'), dir);
  const keys = { alpha: key(projects.alpha), beta: key(projects.beta) };
  const row = (project, i, signal, extra = {}) => ({ id: `fb_${project}_${i}`, timestamp: new Date(Date.now() - i * 1000).toISOString(), projectKey: keys[project], signal, reviewOrigin: 'human', tags: ['statusline', 'quick-capture'], ...extra });
  // alpha: 2 up + 1 down human, plus automated noise. beta: 1 down human, in the shared store.
  writeJsonl(path.join(projects.alpha, '.thumbgate', 'feedback-log.jsonl'), [
    row('alpha', 1, 'positive'), row('alpha', 2, 'positive'), row('alpha', 3, 'negative'),
    row('alpha', 4, 'negative', { reviewOrigin: 'automated', tags: [] }),
  ]);
  writeJsonl(path.join(home, '.thumbgate', 'feedback-log.jsonl'), [row('beta', 5, 'negative')]);
  return { home, projects, keys };
}

test('project view counts what the status line counts and nothing from other projects', () => {
  const { home, projects, keys } = fixture();
  const code = `
    const { projectFeedback } = require(process.argv[1]);
    const { computeHumanCounts } = require(process.argv[2]);
    const [dir, key] = [process.argv[3], process.argv[4]];
    const rows = projectFeedback([], { projectDir: dir, projectKey: key, env: process.env });
    const up = rows.filter((r) => r.signal === 'positive').length;
    const down = rows.filter((r) => r.signal === 'negative').length;
    console.log(JSON.stringify({ up, down, line: computeHumanCounts({ cwd: dir, env: process.env }) }));`;
  for (const name of ['alpha', 'beta']) {
    const out = inChild(home, code, path.join(SCRIPTS, 'project-dashboard.js'), path.join(SCRIPTS, 'statusline-human-counts.js'), projects[name], keys[name]);
    assert.equal(out.up, out.line.up, `${name} up`);
    assert.equal(out.down, out.line.down, `${name} down`);
  }
  const alpha = inChild(home, code, path.join(SCRIPTS, 'project-dashboard.js'), path.join(SCRIPTS, 'statusline-human-counts.js'), projects.alpha, keys.alpha);
  assert.deepEqual([alpha.up, alpha.down], [2, 1]);
  const beta = inChild(home, code, path.join(SCRIPTS, 'project-dashboard.js'), path.join(SCRIPTS, 'statusline-human-counts.js'), projects.beta, keys.beta);
  assert.deepEqual([beta.up, beta.down], [0, 1]);
  fs.rmSync(home, { recursive: true, force: true });
});

test('the requested folder wins over an inherited CLAUDE_PROJECT_DIR or INIT_CWD', () => {
  const { home, projects, keys } = fixture();
  const code = `
    process.env.CLAUDE_PROJECT_DIR = process.argv[2];
    process.env.INIT_CWD = process.argv[2];
    const { projectFeedback } = require(process.argv[1]);
    const rows = projectFeedback([], { projectDir: process.argv[3], projectKey: process.argv[4], env: process.env });
    console.log(JSON.stringify(rows.map((r) => r.signal)));`;
  const out = inChild(home, code, path.join(SCRIPTS, 'project-dashboard.js'), projects.alpha, projects.beta, keys.beta);
  assert.deepEqual(out, ['negative']);
  fs.rmSync(home, { recursive: true, force: true });
});

test('a key that does not belong to the named folder falls back to key-only rows, never another project', () => {
  const { home, projects, keys } = fixture();
  const code = `
    const { projectFeedback } = require(process.argv[1]);
    const rows = projectFeedback([{ id: 'only', signal: 'positive', reviewOrigin: 'human' }], { projectDir: process.argv[2], projectKey: process.argv[3], humanOnly: true, env: process.env });
    console.log(JSON.stringify(rows.map((r) => r.id)));`;
  const out = inChild(home, code, path.join(SCRIPTS, 'project-dashboard.js'), projects.alpha, keys.beta);
  assert.deepEqual(out, ['only']);
  fs.rmSync(home, { recursive: true, force: true });
});

test('status-line Dashboard and Lessons links are pinned to the project', () => {
  const { buildLinkState } = require('../scripts/statusline-links');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-links-'));
  const links = buildLinkState({ ready: true, booting: false, origin: 'http://localhost:3456', canBootstrap: true, projectDir: dir });
  for (const url of [links.dashboardUrl, links.lessonsUrl]) {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('projectDir'), dir);
    assert.ok(parsed.searchParams.get('project'), 'project key present');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyzeFeedback keeps caller-supplied entries when a project is selected', () => {
  const { analyzeFeedback } = require('../scripts/feedback-loop');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-analyze-'));
  const entries = [{ id: 'a', signal: 'positive' }, { id: 'b', signal: 'negative' }, { id: 'c', signal: 'negative' }];
  const out = analyzeFeedback(path.join(dir, 'feedback-log.jsonl'), { projectKey: 'unassigned', entries });
  assert.equal(out.total, 3);
  assert.equal(out.totalNegative, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
