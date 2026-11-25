'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gate = require('../scripts/three-strikes-gate');

function tmpEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'three-strikes-'));
  return { THUMBGATE_PR_LEDGER_DIR: dir, HOME: dir };
}

function fail(command, error = 'Error: 3 tests failed') {
  return { session_id: 's1', tool_name: 'Bash', hook_event_name: 'PostToolUseFailure', tool_input: { command }, error };
}

function ok(command) {
  return { session_id: 's1', tool_name: 'Bash', hook_event_name: 'PostToolUse', tool_input: { command }, tool_response: { stdout: 'pass', stderr: '' } };
}

function pre(command) {
  return { session_id: 's1', tool_name: 'Bash', hook_event_name: 'PreToolUse', tool_input: { command } };
}

test('normalizeCommand drops output plumbing and leading cd', () => {
  assert.equal(gate.normalizeCommand('cd /repo && npm test 2>&1 | tail -20'), 'npm test');
  assert.equal(gate.normalizeCommand('npm   test | tail -n 5'), 'npm test');
  assert.equal(gate.normalizeCommand('node --test tests/a.test.js >/dev/null 2>&1'), 'node --test tests/a.test.js');
});

test('a fourth identical try after three failures is denied, with the errors', () => {
  const env = tmpEnv();
  const now = Date.now();
  for (let i = 0; i < 3; i++) {
    assert.equal(gate.evaluatePre(pre('npm test'), { env, now }).deny, false);
    gate.recordResult(fail('npm test 2>&1 | tail -30', `boom ${i}`), { env, now });
  }
  const r = gate.evaluatePre(pre('cd /x && npm test'), { env, now });
  assert.equal(r.deny, true);
  assert.equal(r.rule, 'three-strikes');
  assert.match(r.reason, /failed 3 times/);
  assert.match(r.reason, /boom 2/);
  assert.match(r.reason, /Change the approach/);
});

test('a different command is allowed, so narrowing the retry works', () => {
  const env = tmpEnv();
  for (let i = 0; i < 3; i++) gate.recordResult(fail('npm test'), { env });
  assert.equal(gate.evaluatePre(pre('node --test tests/only-the-failing.test.js'), { env }).deny, false);
});

test('a success clears the streak', () => {
  const env = tmpEnv();
  gate.recordResult(fail('npm run lint'), { env });
  gate.recordResult(fail('npm run lint'), { env });
  gate.recordResult(ok('npm run lint'), { env });
  gate.recordResult(fail('npm run lint'), { env });
  assert.equal(gate.evaluatePre(pre('npm run lint'), { env }).deny, false);
});

test('the block expires after the strike window', () => {
  const env = tmpEnv();
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) gate.recordResult(fail('npm run build'), { env, now: t0 });
  assert.equal(gate.evaluatePre(pre('npm run build'), { env, now: t0 + 60_000 }).deny, true);
  assert.equal(gate.evaluatePre(pre('npm run build'), { env, now: t0 + 31 * 60_000 }).deny, false);
});

test('read-only probes such as grep never count as strikes', () => {
  const env = tmpEnv();
  for (let i = 0; i < 5; i++) gate.recordResult(fail('grep -rn needle src', ''), { env });
  assert.equal(gate.evaluatePre(pre('grep -rn needle src'), { env }).deny, false);
  assert.equal(gate.isProbe('ls missing'), true);
  assert.equal(gate.isProbe('npm test'), false);
});

test('an interrupted command is not a strike; an explicit exit code is honored', () => {
  assert.equal(gate.failed({ tool_response: { interrupted: true } }), false);
  assert.equal(gate.failed({ tool_response: { exit_code: 2 } }), true);
  assert.equal(gate.failed({ tool_response: { exit_code: 0 } }), false);
  assert.equal(gate.failed({ hook_event_name: 'PostToolUse', tool_response: { stdout: 'x' } }), false);
});

test('sessions are independent', () => {
  const env = tmpEnv();
  for (let i = 0; i < 3; i++) gate.recordResult(fail('npm test'), { env });
  assert.equal(gate.evaluatePre({ ...pre('npm test'), session_id: 'other' }, { env }).deny, false);
});

test('main is off by default and fails open on bad input', async () => {
  const env = { ...tmpEnv(), CLAUDE_PROJECT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'ts-proj-')) };
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { chunks.push(String(s)); return true; };
  try {
    await gate.main('pre', { stdin: '{not json', env });
    await gate.main('pre', { stdin: JSON.stringify(pre('npm test')), env: { ...env, THUMBGATE_PR_DISCIPLINE: '1' } });
  } finally {
    process.stdout.write = orig;
  }
  assert.deepEqual(chunks.map((c) => JSON.parse(c)), [{}, {}]);
});

test('main denies through the hook contract when enabled', async () => {
  const env = { ...tmpEnv(), THUMBGATE_PR_DISCIPLINE: '1', CLAUDE_PROJECT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'ts-proj-')) };
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { chunks.push(String(s)); return true; };
  try {
    for (let i = 0; i < 3; i++) await gate.main('post', { stdin: JSON.stringify(fail('npm test')), env });
    await gate.main('pre', { stdin: JSON.stringify(pre('npm test')), env });
  } finally {
    process.stdout.write = orig;
  }
  const last = JSON.parse(chunks[chunks.length - 1]);
  assert.equal(last.hookSpecificOutput.permissionDecision, 'deny');
});
