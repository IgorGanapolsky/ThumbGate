'use strict';
process.env.THUMBGATE_DISABLE_TELEMETRY = '1';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', 'scripts');
const COUNTER = path.join(SCRIPTS, 'statusline-human-counts.js');
const STATUSLINE = path.join(SCRIPTS, 'statusline.sh');

// A project whose own feedback log holds `up` thumbs-up and `down` thumbs-down by a person.
function makeProject(up, down) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-human-counts-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'proj');
  fs.mkdirSync(path.join(home, '.thumbgate'), { recursive: true });
  fs.mkdirSync(path.join(project, '.thumbgate'), { recursive: true });
  const rows = [];
  for (let i = 0; i < up + down; i += 1) {
    rows.push(JSON.stringify({
      id: `fb_${i}`,
      signal: i < up ? 'positive' : 'negative',
      reviewOrigin: 'human',
      timestamp: new Date(Date.UTC(2026, 10, 23, 15, i)).toISOString(),
      context: 'logged by a person',
    }));
  }
  fs.writeFileSync(path.join(project, '.thumbgate', 'feedback-log.jsonl'), `${rows.join('\n')}\n`);
  return { root, home, project };
}

function countsFor({ home, project }, extraEnv = {}) {
  const env = { ...process.env, HOME: home, ...extraEnv };
  delete env.THUMBGATE_FEEDBACK_DIR;
  delete env.THUMBGATE_PROJECT_DIR;
  delete env.CLAUDE_PROJECT_DIR;
  Object.assign(env, extraEnv);
  return JSON.parse(execFileSync('node', [COUNTER], { cwd: project, env, encoding: 'utf8' }));
}

test('a project with N logged thumbs shows N of them', () => {
  const fixture = makeProject(3, 5);
  try {
    const out = countsFor(fixture);
    assert.deepStrictEqual([out.up, out.down], [3, 5]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a feedback-dir override that points at the shared store does not hide the project log', () => {
  const fixture = makeProject(3, 5);
  try {
    const out = countsFor(fixture, { THUMBGATE_FEEDBACK_DIR: path.join(fixture.home, '.thumbgate') });
    assert.deepStrictEqual([out.up, out.down], [3, 5]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('the rendered segment shows the counts, even with the override', () => {
  const fixture = makeProject(2, 4);
  try {
    const out = execFileSync('bash', [STATUSLINE], {
      cwd: fixture.project,
      encoding: 'utf8',
      input: JSON.stringify({ cwd: fixture.project, context_window: { used_percentage: 5 } }),
      env: {
        ...process.env,
        HOME: fixture.home,
        THUMBGATE_FEEDBACK_DIR: path.join(fixture.home, '.thumbgate'),
        THUMBGATE_OPERATOR_KEY: '',
        THUMBGATE_API_KEY: '',
      },
      timeout: 20000,
    }).replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;]*m/g, '');
    assert.doesNotMatch(out, /no human feedback/);
    assert.match(out, /\b2\S*\s+4\S*\s+this project/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

function renderFrom(fixture, sessionJson) {
  fs.mkdirSync(path.join(fixture.project, 'state'), { recursive: true });
  return execFileSync('bash', [STATUSLINE], {
    cwd: fixture.project,
    encoding: 'utf8',
    input: JSON.stringify(sessionJson),
    env: {
      ...process.env,
      HOME: fixture.home,
      THUMBGATE_OPERATOR_KEY: '',
      THUMBGATE_API_KEY: '',
    },
    timeout: 20000,
  }).replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;]*m/g, '');
}

test('a session whose cwd is a subfolder shows the project counts when Claude names the project dir', () => {
  const fixture = makeProject(2, 4);
  try {
    const sub = path.join(fixture.project, 'state');
    const out = renderFrom(fixture, { cwd: sub, workspace: { current_dir: sub, project_dir: fixture.project } });
    assert.doesNotMatch(out, /no human feedback/);
    assert.match(out, /\b2\S*\s+4\S*\s+this project/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a session whose cwd is a subfolder of a git repo shows the repo counts', () => {
  const fixture = makeProject(2, 4);
  try {
    execFileSync('git', ['init', '-q'], { cwd: fixture.project });
    const sub = path.join(fixture.project, 'state');
    const out = renderFrom(fixture, { cwd: sub });
    assert.doesNotMatch(out, /no human feedback/);
    assert.match(out, /\b2\S*\s+4\S*\s+this project/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a project with no logged thumbs still says so', () => {
  const fixture = makeProject(0, 0);
  try {
    const out = renderFrom(fixture, { cwd: fixture.project });
    assert.match(out, /no human feedback/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a counter that produces nothing is shown as unavailable, never as no feedback', () => {
  const fixture = makeProject(2, 4);
  try {
    const bin = path.join(fixture.root, 'bin');
    fs.mkdirSync(bin);
    const scripts = path.join(fixture.root, 'scripts');
    fs.cpSync(SCRIPTS, scripts, { recursive: true });
    fs.writeFileSync(path.join(scripts, 'statusline-human-counts.js'), 'process.exit(1);\n');
    const out = execFileSync('bash', [path.join(scripts, 'statusline.sh')], {
      cwd: fixture.project,
      encoding: 'utf8',
      input: JSON.stringify({ cwd: fixture.project }),
      env: { ...process.env, HOME: fixture.home, THUMBGATE_OPERATOR_KEY: '', THUMBGATE_API_KEY: '' },
      timeout: 20000,
    }).replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;]*m/g, '');
    assert.doesNotMatch(out, /no human feedback/);
    assert.match(out, /feedback count unavailable/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
