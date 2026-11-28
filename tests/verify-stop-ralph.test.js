'use strict';

// Verification Stop hook (scripts/verify-stop.js) and the Ralph loop starter (scripts/ralph-init.js).
// Everything happens in throwaway git repos under the OS temp dir; the verify commands are `node -e` one-liners.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const verifyStop = require('../scripts/verify-stop');
const ralph = require('../scripts/ralph-init');

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-verify-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return { dir, git, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function writeConfig(dir, command, extra = {}) {
  fs.mkdirSync(path.join(dir, '.thumbgate'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.thumbgate', 'verify.json'), JSON.stringify({ command, ...extra }));
}

const FAIL = `node -e "console.error('1 test failed: adds numbers'); process.exit(1)"`;
const PASS = 'node -e "process.exit(0)"';

test('no config means the hook does nothing', () => {
  const repo = tempRepo();
  try {
    assert.equal(verifyStop.evaluateStop({ cwd: repo.dir, session_id: 's' }, { env: {} }), null);
  } finally { repo.cleanup(); }
});

test('a failing check blocks the stop and quotes the failure', () => {
  const repo = tempRepo();
  try {
    writeConfig(repo.dir, FAIL);
    const out = verifyStop.evaluateStop({ cwd: repo.dir, session_id: 's' }, { env: {} });
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /exited 1/);
    assert.match(out.reason, /1 test failed: adds numbers/);
    assert.match(out.reason, /round 1 of 3/);
  } finally { repo.cleanup(); }
});

test('after maxRounds failures it lets the agent stop and says the work is not verified', () => {
  const repo = tempRepo();
  try {
    writeConfig(repo.dir, FAIL, { maxRounds: 2 });
    const env = { env: {} };
    assert.equal(verifyStop.evaluateStop({ cwd: repo.dir, session_id: 's' }, env).decision, 'block');
    assert.equal(verifyStop.evaluateStop({ cwd: repo.dir, session_id: 's' }, env).decision, 'block');
    const third = verifyStop.evaluateStop({ cwd: repo.dir, session_id: 's' }, env);
    assert.equal(third.decision, undefined);
    assert.match(third.systemMessage, /not verified/);
  } finally { repo.cleanup(); }
});

test('a passing check lets the agent stop, and the same tree is not checked twice', () => {
  const repo = tempRepo();
  try {
    writeConfig(repo.dir, PASS);
    let runs = 0;
    const runCheck = (config, cwd) => { runs += 1; return verifyStop.runCheck(config, cwd); };
    assert.equal(verifyStop.evaluateStop({ cwd: repo.dir, session_id: 's' }, { env: {}, runCheck }), null);
    assert.equal(verifyStop.evaluateStop({ cwd: repo.dir, session_id: 's2' }, { env: {}, runCheck }), null);
    assert.equal(runs, 1, 'unchanged tree reuses the pass');
    fs.writeFileSync(path.join(repo.dir, 'a.txt'), 'two\n');
    verifyStop.evaluateStop({ cwd: repo.dir, session_id: 's' }, { env: {}, runCheck });
    assert.equal(runs, 2, 'changed tree runs again');
  } finally { repo.cleanup(); }
});

test('the Stop hook script prints a block decision on stdin input', () => {
  const repo = tempRepo();
  try {
    writeConfig(repo.dir, FAIL);
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'verify-stop.js')], {
      cwd: repo.dir, input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'x', cwd: repo.dir }), encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).decision, 'block');
  } finally { repo.cleanup(); }
});

test('ralph init writes the starter, finds the test command and adds the Stop hook without touching others', () => {
  const repo = tempRepo();
  try {
    fs.writeFileSync(path.join(repo.dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test', lint: 'eslint .' } }));
    fs.mkdirSync(path.join(repo.dir, '.claude'));
    const existing = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] }, model: 'x' };
    fs.writeFileSync(path.join(repo.dir, '.claude', 'settings.json'), JSON.stringify(existing));
    const result = ralph.ralphInit({ cwd: repo.dir, hookCommand: 'thumbgate verify-stop' });
    assert.equal(result.verifyCommand, 'npm run lint && npm test');
    for (const f of ['PROMPT.md', 'prd.json', 'progress.txt', 'ralph.sh', '.thumbgate/verify.json']) {
      assert.ok(fs.existsSync(path.join(repo.dir, f)), f);
    }
    const settings = JSON.parse(fs.readFileSync(path.join(repo.dir, '.claude', 'settings.json'), 'utf8'));
    assert.equal(settings.model, 'x');
    assert.equal(settings.hooks.Stop.length, 2);
    assert.equal(settings.hooks.Stop[0].hooks[0].command, 'echo mine');
    assert.equal(settings.hooks.Stop[1].hooks[0].command, 'thumbgate verify-stop');
    const again = ralph.ralphInit({ cwd: repo.dir, hookCommand: 'thumbgate verify-stop' });
    assert.equal(again.written.length, 0, 'never overwrites');
    assert.equal(again.hook.reason, 'already wired');
    assert.match(fs.readFileSync(path.join(repo.dir, 'PROMPT.md'), 'utf8'), /<promise>COMPLETE<\/promise>/);
    assert.equal(spawnSync('bash', ['-n', path.join(repo.dir, 'ralph.sh')]).status, 0, 'ralph.sh parses');
  } finally { repo.cleanup(); }
});

test('detectVerifyCommand covers common stacks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-detect-'));
  try {
    assert.equal(ralph.detectVerifyCommand(dir), '');
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module x\n');
    assert.equal(ralph.detectVerifyCommand(dir), 'go test ./...');
    fs.writeFileSync(path.join(dir, 'pyproject.toml'), '');
    assert.equal(ralph.detectVerifyCommand(dir), 'python -m pytest -q');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an untracked file with a non-ASCII name still changes the fingerprint when its content changes', () => {
  const repo = tempRepo();
  try {
    const file = path.join(repo.dir, 'é.js');
    fs.writeFileSync(file, 'module.exports = 1;\n');
    const before = verifyStop.treeFingerprint(repo.dir);
    fs.writeFileSync(file, 'module.exports = 2;\n');
    assert.notEqual(verifyStop.treeFingerprint(repo.dir), before);
  } finally { repo.cleanup(); }
});

test('ralph.sh does not accept the completion marker from a run that failed', () => {
  const repo = tempRepo();
  try {
    ralph.ralphInit({ cwd: repo.dir, verifyCommand: PASS, wire: false });
    const agent = path.join(repo.dir, 'stub-agent.sh');
    fs.writeFileSync(agent, '#!/usr/bin/env bash\necho "<promise>COMPLETE</promise>"\nexit 1\n', { mode: 0o755 });
    const r = spawnSync('bash', ['ralph.sh'], { cwd: repo.dir, encoding: 'utf8', env: { ...process.env, AGENT: agent, MAX_RUNS: '2' } });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /All tasks pass/);
  } finally { repo.cleanup(); }
});
