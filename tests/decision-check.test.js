'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const { SAMPLE_CASES, classifyOutput, runDecisionCheck, formatTable } = require('../scripts/decision-check');

test('classifyOutput maps deny, warn and allow hook output', () => {
  const deny = JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: '[GATE:force-push] no' } });
  assert.deepEqual(classifyOutput(deny), { verdict: 'block', gate: 'force-push', reason: '[GATE:force-push] no' });
  const warn = JSON.stringify({ hookSpecificOutput: { additionalContext: 'WARN [GATE:workflow-sentinel] risky' } });
  assert.equal(classifyOutput(warn).verdict, 'warn');
  assert.equal(classifyOutput(warn).gate, 'workflow-sentinel');
  assert.equal(classifyOutput('{}').verdict, 'allow');
  assert.equal(classifyOutput('not json').verdict, 'error');
});

test('decision check never executes the commands it evaluates', async () => {
  const sentinelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-check-sentinel-'));
  const sentinel = path.join(sentinelDir, 'keep.txt');
  fs.writeFileSync(sentinel, 'keep');
  const seen = [];
  const { rows, totals } = await runDecisionCheck({
    cases: [{ kind: 'destructive', command: `rm -rf ${sentinelDir}` }],
    evaluate: (input) => {
      seen.push(input.tool_input.command);
      return JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: '[GATE:x] stop' } });
    },
  });
  assert.deepEqual(seen, [`rm -rf ${sentinelDir}`]);
  assert.equal(rows[0].verdict, 'block');
  assert.equal(totals.block, 1);
  assert.ok(fs.existsSync(sentinel), 'the sample command must not run');
  fs.rmSync(sentinelDir, { recursive: true, force: true });
});

test('the real evaluator does not execute sample commands', async () => {
  const sentinelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-check-real-'));
  const sentinel = path.join(sentinelDir, 'keep.txt');
  const created = path.join(sentinelDir, 'created.txt');
  fs.writeFileSync(sentinel, 'keep');
  const { rows } = await runDecisionCheck({
    cases: [
      { kind: 'destructive', command: `rm -rf ${sentinelDir}` },
      { kind: 'harmless', command: `touch ${created}` },
      { kind: 'harmless', command: `python3 -c "open('${created}', 'w')"` },
    ],
  });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.verdict !== 'error'), JSON.stringify(rows));
  assert.ok(fs.existsSync(sentinel), 'rm -rf must not run');
  assert.ok(!fs.existsSync(created), 'touch and python must not run');
  fs.rmSync(sentinelDir, { recursive: true, force: true });
});

test('an inherited bypass does not change the reported decisions', async () => {
  process.env.THUMBGATE_HOTFIX_BYPASS = '1';
  try {
    const { rows } = await runDecisionCheck({ cases: [{ kind: 'destructive', command: 'git reset --hard' }] });
    assert.equal(rows[0].verdict, 'block');
  } finally {
    delete process.env.THUMBGATE_HOTFIX_BYPASS;
  }
});

test('the published package ships decision-check and its evaluator', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const file of ['scripts/decision-check.js', 'scripts/gate-check-core.js']) {
    assert.ok(pkg.files.includes(file), `${file} must be in package.json files`);
  }
});

test('formatTable states that only decisions are tested', () => {
  const out = formatTable({ rows: [{ kind: 'harmless', command: 'ls', verdict: 'allow', gate: '' }], totals: { allow: 1 } });
  assert.match(out, /nothing executed/);
  assert.match(out, /Totals: 1 allow\./);
  assert.match(out, /tests the decisions only/);
});

test('CLI decision-check --json runs the real gates in an isolated home', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-check-home-'));
  // Inherited state overrides must not receive gate stats or cooldowns from the dry run.
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-check-state-'));
  const xdgState = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-check-xdg-'));
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-check-feedback-'));
  const result = spawnSync(process.execPath, [CLI, 'decision-check', '--json'], {
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      HOME: home,
      THUMBGATE_NO_NUDGE: '1',
      THUMBGATE_STATE_DIR: stateDir,
      XDG_STATE_HOME: xdgState,
      THUMBGATE_FEEDBACK_DIR: feedbackDir,
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
  assert.equal(parsed.rows.length, SAMPLE_CASES.length);
  const byCommand = Object.fromEntries(parsed.rows.map((row) => [row.command, row]));
  assert.equal(byCommand['rm -rf ~'].verdict, 'block');
  assert.equal(byCommand['git reset --hard'].verdict, 'block');
  for (const row of parsed.rows.filter((r) => r.kind === 'harmless')) {
    assert.equal(row.verdict, 'allow', `${row.command} should be allowed`);
  }
  // The CLI's own install id may appear, but no feedback, rules or gate state is written to the real home.
  const written = fs.existsSync(path.join(home, '.thumbgate')) ? fs.readdirSync(path.join(home, '.thumbgate')) : [];
  const allowed = new Set(['install-id', 'activation-recorded.json']);
  assert.deepEqual(written.filter((name) => !allowed.has(name)), []);
  for (const dir of [stateDir, xdgState, feedbackDir]) {
    assert.deepEqual(fs.readdirSync(dir), [], `${dir} must stay untouched`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.rmSync(home, { recursive: true, force: true });
});

test('runDecisionCheck restores the caller environment', async () => {
  const before = { ...process.env };
  await runDecisionCheck({ cases: [{ kind: 'harmless', command: 'ls' }], evaluate: () => '{}' });
  assert.deepEqual({ ...process.env }, before);
});
