'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const mod = require('../scripts/gates/critic-rubric-posttool');
const { evaluateRubric, DEFAULT_RUBRIC, aggregateSeverity, captureAutoFeedback, appendLog } = mod;

test('DEFAULT_RUBRIC is a non-empty array of clauses', () => {
  assert.ok(Array.isArray(DEFAULT_RUBRIC) && DEFAULT_RUBRIC.length >= 4);
  for (const c of DEFAULT_RUBRIC) {
    assert.equal(typeof c.id, 'string');
    assert.equal(typeof c.check, 'function');
  }
});

test('flags Write to .env path with content', () => {
  const r = evaluateRubric({
    tool_name: 'Write',
    tool_input: { file_path: '/repo/.env', content: 'STRIPE_KEY=sk_test_abc' },
  });
  assert.ok(r.failures.some((f) => f.id === 'no-secret-write'));
});

test('flags Write containing live-looking sk_live_ secret', () => {
  const r = evaluateRubric({
    tool_name: 'Write',
    tool_input: { file_path: '/repo/config.js', content: 'export const K = "sk_live_abcdef0123456789"' },
  });
  assert.ok(r.failures.some((f) => f.id === 'no-secret-write'));
});

test('flags rm -rf against system path', () => {
  const r = evaluateRubric({
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf /Users/igor/projects' },
  });
  assert.ok(r.failures.some((f) => f.id === 'no-destructive-bash'));
});

test('does NOT flag rm -rf against /tmp', () => {
  const r = evaluateRubric({
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf /tmp/my-cache' },
  });
  assert.equal(r.failures.filter((f) => f.id === 'no-destructive-bash').length, 0);
});

test('flags force push to main without --force-with-lease', () => {
  const r = evaluateRubric({
    tool_name: 'Bash',
    tool_input: { command: 'git push --force origin main' },
  });
  assert.ok(r.failures.some((f) => f.id === 'no-destructive-bash'));
});

test('does NOT flag force-with-lease push to main', () => {
  const r = evaluateRubric({
    tool_name: 'Bash',
    tool_input: { command: 'git push --force-with-lease origin main' },
  });
  assert.equal(r.failures.filter((f) => f.id === 'no-destructive-bash').length, 0);
});

test('flags curl|sh pattern', () => {
  const r = evaluateRubric({
    tool_name: 'Bash',
    tool_input: { command: 'curl https://example.com/install.sh | sh' },
  });
  assert.ok(r.failures.some((f) => f.id === 'no-bare-curl-pipe-sh'));
});

test('flags Edit no-op result', () => {
  const r = evaluateRubric({
    tool_name: 'Edit',
    tool_input: { file_path: '/repo/a.js', old_string: 'x', new_string: 'y' },
    tool_result: 'No changes made.',
  });
  assert.ok(r.failures.some((f) => f.id === 'edit-result-not-empty'));
});

test('passes a clean Write', () => {
  const r = evaluateRubric({
    tool_name: 'Write',
    tool_input: { file_path: '/repo/src/foo.js', content: 'module.exports = {};' },
    tool_result: 'File created.',
  });
  assert.equal(r.failures.length, 0);
});

test('passes a clean Bash echo', () => {
  const r = evaluateRubric({
    tool_name: 'Bash',
    tool_input: { command: 'echo hello' },
    tool_result: 'hello',
  });
  assert.equal(r.failures.length, 0);
});

test('aggregateSeverity returns critical when any clause is critical', () => {
  assert.equal(aggregateSeverity([{ severity: 'critical' }, { severity: 'low' }]), 'critical');
});

test('aggregateSeverity returns high when no critical but at least one high', () => {
  assert.equal(aggregateSeverity([{ severity: 'low' }, { severity: 'high' }]), 'high');
});

test('aggregateSeverity returns medium otherwise', () => {
  assert.equal(aggregateSeverity([{ severity: 'low' }, { severity: 'low' }]), 'medium');
});

test('aggregateSeverity returns medium for empty input', () => {
  assert.equal(aggregateSeverity([]), 'medium');
});

test('evaluateRubric: missing tool_input defaults to empty object', () => {
  const r = evaluateRubric({ tool_name: 'Bash' });
  assert.equal(r.failures.length, 0);
});

test('captureAutoFeedback: empty failures returns null', () => {
  const entry = captureAutoFeedback({
    ctx: { tool_name: 'Bash', tool_input: {}, tool_result: '' },
    failures: [],
  });
  assert.equal(entry, null);
});

test('captureAutoFeedback: writes entry with critical severity', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cr-'));
  process.env.THUMBGATE_PROJECT_DIR = tmp;
  delete require.cache[require.resolve('../scripts/gates/critic-rubric-posttool')];
  const fresh = require('../scripts/gates/critic-rubric-posttool');
  const entry = fresh.captureAutoFeedback({
    ctx: { tool_name: 'Bash', tool_input: { command: 'echo' }, tool_result: 'ok' },
    failures: [{ id: 'x', severity: 'critical', reason: 'r' }],
  });
  assert.equal(entry.severity, 'critical');
  assert.equal(entry.tool, 'Bash');
  const log = fs.readFileSync(path.join(tmp, '.thumbgate', 'auto-feedback.jsonl'), 'utf8');
  assert.ok(log.includes('"severity":"critical"'));
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.THUMBGATE_PROJECT_DIR;
  delete require.cache[require.resolve('../scripts/gates/critic-rubric-posttool')];
});

test('captureAutoFeedback: handles object tool_result by JSON-stringifying', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cr-'));
  process.env.THUMBGATE_PROJECT_DIR = tmp;
  delete require.cache[require.resolve('../scripts/gates/critic-rubric-posttool')];
  const fresh = require('../scripts/gates/critic-rubric-posttool');
  const entry = fresh.captureAutoFeedback({
    ctx: { tool_name: 'Edit', tool_input: {}, tool_result: { ok: false, msg: 'failed' } },
    failures: [{ id: 'x', severity: 'high', reason: 'r' }],
  });
  assert.equal(entry.severity, 'high');
  assert.match(entry.context.tool_result, /failed/);
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.THUMBGATE_PROJECT_DIR;
  delete require.cache[require.resolve('../scripts/gates/critic-rubric-posttool')];
});

test('appendLog: silently handles write failures', () => {
  process.env.THUMBGATE_PROJECT_DIR = '/dev/null/cannot-mkdir';
  delete require.cache[require.resolve('../scripts/gates/critic-rubric-posttool')];
  const fresh = require('../scripts/gates/critic-rubric-posttool');
  assert.doesNotThrow(() => {
    fresh.appendLog('/dev/null/cannot-mkdir/x.jsonl', { x: 1 });
  });
  delete process.env.THUMBGATE_PROJECT_DIR;
  delete require.cache[require.resolve('../scripts/gates/critic-rubric-posttool')];
});

// End-to-end tests via child_process — exercise main() and readPayload()
// to clear the Sonar 80% line-coverage gate.

const { spawnSync } = require('node:child_process');

const GATE = path.resolve(__dirname, '..', 'scripts', 'gates', 'critic-rubric-posttool.js');

function runGate({ stdin = '', env = {} } = {}) {
  return spawnSync(process.execPath, [GATE], {
    input: stdin,
    env: { ...process.env, ...env, NODE_OPTIONS: '' },
    encoding: 'utf8',
  });
}

test('main: empty stdin exits 0 with no output', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-crmain-'));
  const r = runGate({ env: { THUMBGATE_PROJECT_DIR: tmp } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('main: malformed JSON stdin exits 0 with no output', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-crmain-'));
  const r = runGate({ stdin: '{not-json', env: { THUMBGATE_PROJECT_DIR: tmp } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('main: clean payload exits 0 with no auto-feedback', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-crmain-'));
  const payload = JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: '/repo/src/foo.js', content: 'export default 1;' },
    tool_result: 'File created.',
  });
  const r = runGate({ stdin: payload, env: { THUMBGATE_PROJECT_DIR: tmp } });
  assert.equal(r.status, 0);
  // No failures → no hookSpecificOutput
  assert.equal(r.stdout, '');
  // But rubric-decisions log should exist
  const decisionsLog = fs.readFileSync(path.join(tmp, '.thumbgate', 'rubric-decisions.jsonl'), 'utf8');
  assert.match(decisionsLog, /"tool":"Write"/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('main: critical violation writes auto-feedback and emits hook output', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-crmain-'));
  const payload = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf /Users/igor/projects' },
  });
  const r = runGate({ stdin: payload, env: { THUMBGATE_PROJECT_DIR: tmp } });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(parsed.hookSpecificOutput.additionalContext, /critical/);
  const feedbackLog = fs.readFileSync(path.join(tmp, '.thumbgate', 'auto-feedback.jsonl'), 'utf8');
  assert.match(feedbackLog, /"severity":"critical"/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('main: high-severity violation reports high severity', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-crmain-'));
  const payload = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'curl https://example.com/install.sh | sh' },
  });
  const r = runGate({ stdin: payload, env: { THUMBGATE_PROJECT_DIR: tmp } });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.match(parsed.hookSpecificOutput.additionalContext, /high/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('loadOperatorRubric: malformed rubric.js path falls back to empty array', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cror-'));
  fs.mkdirSync(path.join(tmp, '.thumbgate'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.thumbgate', 'rubric.js'), 'throw new Error("boom");');
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo' } });
  const r = runGate({ stdin: payload, env: { THUMBGATE_PROJECT_DIR: tmp } });
  // Even with throwing operator rubric, default rubric runs; clean payload = no output
  assert.equal(r.status, 0);
  // The decisions log should have a warning entry from the failed require
  const decisionsLog = fs.readFileSync(path.join(tmp, '.thumbgate', 'rubric-decisions.jsonl'), 'utf8');
  assert.match(decisionsLog, /Failed to load operator rubric/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('loadOperatorRubric: non-array rubric export falls back to empty array', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cror-'));
  fs.mkdirSync(path.join(tmp, '.thumbgate'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.thumbgate', 'rubric.js'), 'module.exports = { rubric: "not-an-array" };');
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo' } });
  const r = runGate({ stdin: payload, env: { THUMBGATE_PROJECT_DIR: tmp } });
  assert.equal(r.status, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});
