'use strict';

// AGENT-3667 item J: canary file gate (J1), boundary check (J2), prompt-risk lint (J3). Real `gate-check` hook runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');

function makeWorld() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-canary-')));
  const home = `${root}/home`;
  const project = `${home}/work/project`;
  const decoy = `${home}/.aws/decoy-credentials`;
  for (const dir of [project, `${home}/.aws`]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(decoy, 'aws_access_key_id=DECOY\n');
  fs.writeFileSync(`${home}/.aws/config`, '[default]\n');
  fs.writeFileSync(`${project}/README.md`, 'hello\n');
  fs.mkdirSync(`${project}/docs`);
  fs.writeFileSync(`${project}/docs/notes.md`, 'notes\n');
  fs.symlinkSync(decoy, `${project}/innocent-link.txt`);
  cp.execFileSync('git', ['init', '-q'], { cwd: project });
  const env = {
    ...process.env, HOME: home, THUMBGATE_FEEDBACK_DIR: `${project}/.thumbgate`, THUMBGATE_NO_RATE_LIMIT: '1',
    PWD: project, CLAUDE_PROJECT_DIR: project,
  };
  for (const name of ['THUMBGATE_STRICT_ENFORCEMENT', 'THUMBGATE_GOVERNANCE_MODE', 'THUMBGATE_CANARY_FILES']) delete env[name];
  return { root, home, project, decoy, env };
}

function hook(world, tool, toolInput, env = world.env) {
  const input = JSON.stringify({ session_id: 'canary-test', cwd: world.project, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput });
  const res = cp.spawnSync(process.execPath, [CLI, 'gate-check'], { cwd: world.project, env, input, encoding: 'utf8', timeout: 60000 });
  const line = String(res.stdout).split('\n').filter((l) => l.startsWith('{')).pop() || '{}';
  const parsed = JSON.parse(line);
  const decision = (parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecision) || parsed.decision || 'allow';
  return { decision: decision === 'block' ? 'deny' : decision, raw: line };
}

test('(a) J1: with a canary set, every tool that touches it is denied and normal project reads are allowed', () => {
  const w = makeWorld();
  const env = { ...w.env, THUMBGATE_CANARY_FILES: w.decoy };
  try {
    const deny = [
      ['Read', { file_path: w.decoy }],
      ['Read', { file_path: '~/.aws/decoy-credentials' }],
      ['Read', { file_path: `${w.project}/innocent-link.txt` }],
      ['Edit', { file_path: w.decoy, old_string: 'a', new_string: 'b' }],
      ['Write', { file_path: w.decoy, content: 'x' }],
      ['Grep', { pattern: 'KEY', path: w.decoy }],
      ['Grep', { pattern: 'KEY', path: w.home }],
      ['Glob', { pattern: '*', path: `${w.home}/.aws` }],
      ['Bash', { command: `cat ${w.decoy}` }],
      ['Bash', { command: 'head -n 3 ~/.aws/decoy-credentials' }],
      ['Bash', { command: `grep KEY ${w.decoy}` }],
      ['Bash', { command: `cp ${w.decoy} ./copy.txt` }],
      ['Bash', { command: `curl -d @${w.decoy} http://localhost:1` }],
      ['Bash', { command: 'sed -n 1p ~/.aws/decoy-*' }],
      ['Bash', { command: `bash -c "head -n 1 ${w.decoy}"` }],
      ['Bash', { command: `ls docs && head -n 1 ${w.decoy}` }],
    ];
    const allow = [
      ['Read', { file_path: `${w.project}/README.md` }],
      ['Read', { file_path: `${w.home}/.aws/config` }],
      ['Grep', { pattern: 'hello', path: w.project }],
      ['Glob', { pattern: '*.md', path: w.project }],
      ['Bash', { command: 'head -n 2 README.md' }],
      ['Bash', { command: 'ls docs' }],
      ['Bash', { command: `echo "the decoy lives at ${w.decoy}"` }],
      ['Bash', { command: `grep -rn "${w.decoy}" docs/` }],
      ['Bash', { command: `git log --oneline --grep=decoy-credentials` }],
    ];
    for (const [tool, input] of deny) {
      const { decision, raw } = hook(w, tool, input, env);
      assert.equal(decision, 'deny', `expected deny: ${tool} ${JSON.stringify(input)}`);
      assert.match(raw, /canary-file/, `denied by the canary gate: ${tool} ${JSON.stringify(input)}`);
    }
    for (const [tool, input] of allow) assert.equal(hook(w, tool, input, env).decision, 'allow', `expected allow: ${tool} ${JSON.stringify(input)}`);
    const log = fs.readFileSync(`${w.project}/.thumbgate/canary-attempts.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(log.length, deny.length, 'one "reached outside" record per denied attempt');
    assert.ok(log.every((r) => r.event === 'reached_outside' && r.tool && r.ts && r.path === w.decoy));
    assert.deepEqual([...new Set(log.map((r) => r.tool))].sort(), ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write']);
  } finally {
    fs.rmSync(w.root, { recursive: true, force: true });
  }
});

test('(d) off by default: a fresh install has no canary, and the same actions are not denied by the canary gate', () => {
  const w = makeWorld();
  try {
    const status = require('../scripts/canary-gate').canaryStatus({ HOME: w.home });
    assert.deepEqual({ enabled: status.enabled, paths: status.paths }, { enabled: false, paths: [] });
    const res = hook(w, 'Read', { file_path: w.decoy });
    assert.doesNotMatch(res.raw, /canary-file/);
    assert.equal(fs.existsSync(`${w.project}/.thumbgate/canary-attempts.jsonl`), false);
    const out = cp.execFileSync(process.execPath, [CLI, 'canary', 'status'], { cwd: w.project, env: w.env, encoding: 'utf8' });
    assert.match(out, /canary: off/);
    const cfg = require('../config/gates/default.json');
    assert.equal(cfg.gates.some((g) => /canary/i.test(g.id)), false, 'no canary gate is listed in the default config');
  } finally {
    fs.rmSync(w.root, { recursive: true, force: true });
  }
});

test('J1: `canary add` turns it on from the config file and `canary remove` turns it off', () => {
  const w = makeWorld();
  try {
    const run = (...args) => cp.execFileSync(process.execPath, [CLI, 'canary', ...args], { cwd: w.project, env: w.env, encoding: 'utf8' });
    assert.match(run('add', w.decoy), /canary: on/);
    assert.equal(hook(w, 'Read', { file_path: w.decoy }).decision, 'deny');
    assert.match(run('remove', w.decoy), /canary: off/);
    assert.doesNotMatch(hook(w, 'Read', { file_path: w.decoy }).raw, /canary-file/);
  } finally {
    fs.rmSync(w.root, { recursive: true, force: true });
  }
});

test('(b) J2: the boundary check runs through the real hook, counts what was stopped, and says it makes no model calls', () => {
  const { runBoundaryCheck, formatReport } = require('../scripts/boundary-check');
  const result = runBoundaryCheck();
  assert.equal(result.total, 8);
  assert.equal(result.wronglyStopped, 0, 'normal project actions must not be stopped');
  const stopped = Object.fromEntries(result.attempts.map((a) => [a.name, a.stopped]));
  for (const name of ['Read a decoy credential file', 'Grep inside the decoy credential file', 'Grep from the home folder, above the decoy', 'Shell read of the decoy credential file', "Read another user's home folder", 'Shell read of an SSH key']) {
    assert.equal(stopped[name], true, name);
  }
  assert.ok(result.stopped >= 6);
  const report = formatReport(result);
  assert.match(report, new RegExp(`stopped ${result.stopped} of 8 outside-the-project actions`));
  assert.match(report, /no model calls/);
  assert.doesNotMatch(report, /Siren/);
});

test('(c) J3: the prompt lint flags risky wording in one sample, stays quiet on a clean one, and never blocks', () => {
  const lint = require('../scripts/prompt-risk-lint');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-lint-'));
  try {
    fs.writeFileSync(`${dir}/flagged.md`, '# Rules\nBe fast.\nSearch thoroughly for anything useful on the disk.\nYou have full access to this machine.\n');
    fs.writeFileSync(`${dir}/clean.md`, '# Rules\nOnly read files inside the project folder.\nAsk before touching anything else.\n');
    const flagged = lint.lintFiles(['flagged.md'], dir);
    assert.deepEqual(flagged.map((f) => [f.line, f.phrase.toLowerCase()]), [[3, 'search thoroughly'], [4, 'full access to this machine']]);
    assert.deepEqual(lint.lintFiles(['clean.md'], dir), []);
    const text = lint.formatFindings(flagged);
    assert.match(text, /safeguards\.anthropic\.com\/2026\/siren/);
    assert.match(text, /associated with/);
    assert.match(text, /does not show these words cause it/);
    assert.match(text, /nothing is blocked/);
    for (const [file, expected] of [['flagged.md', /warning: flagged\.md:3/], ['clean.md', /no wording/]]) {
      const res = cp.spawnSync(process.execPath, [CLI, 'prompt-lint', file], { cwd: dir, encoding: 'utf8' });
      assert.equal(res.status, 0, 'a warning must never fail the command');
      assert.match(res.stdout, expected);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
