'use strict';
process.env.THUMBGATE_DISABLE_TELEMETRY = '1';

// A session whose folder was moved to the Trash (macOS keeps the shell's cwd on ~/.Trash/<name>) must never become
// "this project": not in the status line, not in its Dashboard link, not as the saved active project. The status line
// and the dashboard must agree on the numbers and the tier for the same project.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const SCRIPTS = path.join(__dirname, '..', 'scripts');
const STATUSLINE = path.join(SCRIPTS, 'statusline.sh');

function cleanEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, THUMBGATE_OPERATOR_KEY: '', THUMBGATE_API_KEY: '' };
  for (const name of ['THUMBGATE_FEEDBACK_DIR', 'THUMBGATE_PROJECT_DIR', 'CLAUDE_PROJECT_DIR', 'INIT_CWD', 'PWD', 'THUMBGATE_DEV_BYPASS', 'THUMBGATE_DEV_SECRET']) delete env[name];
  return { ...env, ...extra };
}

function humanRows(up, down) {
  const rows = [];
  for (let i = 0; i < up + down; i += 1) {
    rows.push(JSON.stringify({ id: `fb_${i}`, signal: i < up ? 'positive' : 'negative', reviewOrigin: 'human', tags: ['user-prompt-thumbs'], timestamp: new Date(Date.UTC(2026, 10, 25, 15, i)).toISOString(), context: 'a person' }));
  }
  return `${rows.join('\n')}\n`;
}

// home/workspace/orchestrator: a real project with 2 up / 3 down. home/.Trash/iphone: a deleted one with 0 up / 6 down.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-trash-'));
  const home = path.join(root, 'home');
  const real = path.join(home, 'workspace', 'orchestrator');
  const trashed = path.join(home, '.Trash', 'iphone');
  for (const dir of [real, trashed]) {
    fs.mkdirSync(path.join(dir, '.thumbgate'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['remote', 'add', 'origin', `https://github.com/example/${path.basename(dir)}.git`], { cwd: dir });
  }
  fs.writeFileSync(path.join(real, '.thumbgate', 'feedback-log.jsonl'), humanRows(2, 3));
  fs.writeFileSync(path.join(trashed, '.thumbgate', 'feedback-log.jsonl'), humanRows(0, 6));
  return { root, home, real, trashed };
}

function inChild(home, cwd, code, ...args) {
  const run = spawnSync(process.execPath, ['-e', code, ...args], { encoding: 'utf8', env: cleanEnv(home), cwd });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('a folder in the Trash is never resolved as the project, even as the saved active project', () => {
  const f = fixture();
  try {
    const code = `
      const p = require(process.argv[1]);
      const viaCwd = p.resolveProjectDir({ cwd: process.argv[2], env: process.env, includeStored: false });
      const saved = p.writeActiveProjectState(process.argv[2], { env: process.env });
      console.log(JSON.stringify({ viaCwd, saved, trashed: p.isTrashedDir(process.argv[2]), real: p.isTrashedDir(process.argv[3]) }));`;
    const out = inChild(f.home, f.trashed, code, path.join(SCRIPTS, 'feedback-paths.js'), f.trashed, f.real);
    assert.equal(out.trashed, true);
    assert.equal(out.real, false);
    assert.notEqual(out.viaCwd, f.trashed);
    assert.equal(out.viaCwd, f.home, 'falls back to the home folder, which reads as "not a project"');
    assert.equal(out.saved, null, 'a trashed folder is never saved as the active project');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a session in a trashed folder falls back to the last real project the person used', () => {
  const f = fixture();
  try {
    const code = `
      require(process.argv[1]).writeActiveProjectState(process.argv[3], { env: process.env });
      const { computeHumanCounts } = require(process.argv[2]);
      console.log(JSON.stringify(computeHumanCounts({ cwd: process.argv[4], env: process.env })));`;
    const out = inChild(f.home, f.trashed, code, path.join(SCRIPTS, 'feedback-paths.js'), path.join(SCRIPTS, 'statusline-human-counts.js'), f.real, f.trashed);
    assert.equal(out.project, 'orchestrator');
    assert.equal(out.projectDir, f.real);
    assert.deepEqual([out.up, out.down], [2, 3]);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('with no real project to fall back to, the counter says so instead of naming the trashed folder', () => {
  const f = fixture();
  try {
    const code = `console.log(JSON.stringify(require(process.argv[2]).computeHumanCounts({ cwd: process.argv[3], env: process.env })));`;
    // argv[1] is a placeholder so the counter module does not also run its own CLI and print twice.
    const out = inChild(f.home, f.trashed, code, '-', path.join(SCRIPTS, 'statusline-human-counts.js'), f.trashed);
    assert.equal(out.label, 'not in a project folder');
    assert.equal(out.project, null);
    assert.notEqual(out.down, 6, 'the deleted folder\'s thumbs are not shown as this project\'s');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('the rendered status line names the project and where it lives, and never the trashed folder', () => {
  const f = fixture();
  try {
    const render = (sessionDir) => execFileSync('bash', [STATUSLINE], {
      cwd: sessionDir,
      encoding: 'utf8',
      input: JSON.stringify({ cwd: sessionDir, workspace: { current_dir: sessionDir, project_dir: sessionDir }, context_window: { used_percentage: 5 } }),
      env: cleanEnv(f.home),
      timeout: 20000,
    }).replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;]*m/g, '');
    const realLine = render(f.real);
    assert.match(realLine, /\b2\S*\s+3\S*\s+this project \(orchestrator · ~\/workspace\)/);
    const trashLine = render(f.trashed);
    assert.doesNotMatch(trashLine, /iphone|\.Trash/);
    assert.doesNotMatch(trashLine, /\b0\S*\s+6\S*\s+this project/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('the Dashboard link for a trashed folder opens All projects; a trashed repo is not a project folder', () => {
  const f = fixture();
  try {
    const code = `
      const { buildLinkState } = require(process.argv[1]);
      const { isProjectFolder, dashboardProjectParam } = require(process.argv[2]);
      const trash = buildLinkState({ ready: true, booting: false, origin: 'http://localhost:3456', canBootstrap: true, projectDir: process.argv[3] });
      const real = buildLinkState({ ready: true, booting: false, origin: 'http://localhost:3456', canBootstrap: true, projectDir: process.argv[4] });
      console.log(JSON.stringify({ trash: trash.dashboardUrl, real: real.dashboardUrl, trashIsProject: isProjectFolder(process.argv[3]), realIsProject: isProjectFolder(process.argv[4]), param: dashboardProjectParam(process.argv[3]) }));`;
    const out = inChild(f.home, f.real, code, path.join(SCRIPTS, 'statusline-links.js'), path.join(SCRIPTS, 'project-identity.js'), f.trashed, f.real);
    assert.equal(new URL(out.trash).searchParams.get('project'), 'all');
    assert.equal(new URL(out.trash).searchParams.get('projectDir'), null);
    assert.equal(new URL(out.real).searchParams.get('projectDir'), f.real);
    assert.equal(out.trashIsProject, false);
    assert.equal(out.realIsProject, true);
    assert.equal(out.param, 'all');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('status line and local dashboard name the same tier for the same machine', () => {
  const f = fixture();
  try {
    const code = `
      const { getStatuslineMeta } = require(process.argv[2]);
      const { resolveProKey } = require(process.argv[3]);
      console.log(JSON.stringify({ line: getStatuslineMeta({ env: process.env }).tier, dashboardPlan: resolveProKey({ env: process.env, homeDir: process.env.HOME }).plan }));`;
    // Creator machine: the local dashboard launches on the enterprise creator key, so the line says Enterprise too.
    fs.mkdirSync(path.join(f.home, '.config', 'thumbgate'), { recursive: true });
    fs.writeFileSync(path.join(f.home, '.config', 'thumbgate', 'dev.json'), JSON.stringify({ bypass: 'fixture-secret' }));
    const run = spawnSync(process.execPath, ['-e', code, '-', path.join(SCRIPTS, 'statusline-meta.js'), path.join(SCRIPTS, 'pro-local-dashboard.js')], { encoding: 'utf8', cwd: f.real, env: cleanEnv(f.home, { THUMBGATE_DEV_SECRET: 'fixture-secret' }) });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.equal(out.dashboardPlan, 'enterprise');
    assert.equal(out.line, 'Enterprise');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
