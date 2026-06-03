'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  decide,
  isEgress,
  referencesLocalFile,
} = require('../scripts/gates/cloud-egress-confirm');

test('isEgress flags WebFetch', () => {
  assert.equal(isEgress('WebFetch', { url: 'https://x.com' }), true);
});

test('isEgress flags MCP upload tools', () => {
  assert.equal(isEgress('mcp__claude_ai_Gmail__send', {}), true);
  assert.equal(isEgress('mcp__store__upload_file', {}), true);
});

test('isEgress does NOT flag Bash echo', () => {
  assert.equal(isEgress('Bash', { command: 'echo hello' }), false);
});

test('isEgress flags Bash curl with URL', () => {
  assert.equal(isEgress('Bash', { command: 'curl https://api.example.com/u' }), true);
});

test('isEgress flags Bash wget with URL', () => {
  assert.equal(isEgress('Bash', { command: 'wget https://api.example.com/u' }), true);
});

test('isEgress does NOT flag Read/Edit/Write', () => {
  assert.equal(isEgress('Read', { file_path: '/x.js' }), false);
  assert.equal(isEgress('Edit', {}), false);
  assert.equal(isEgress('Write', {}), false);
});

test('referencesLocalFile flags Users path', () => {
  assert.equal(referencesLocalFile({ body: '"/Users/igor/secret.env"' }), true);
});

test('referencesLocalFile flags src/ path', () => {
  assert.equal(referencesLocalFile({ body: '"src/auth.js"' }), true);
});

test('referencesLocalFile does NOT flag plain URL payload', () => {
  assert.equal(referencesLocalFile({ url: 'https://example.com/api' }), false);
});

test('decide: env override allows', () => {
  const r = decide({ env: { THUMBGATE_CLOUD_EGRESS_OK: '1' }, payload: null });
  assert.equal(r.decision, 'allow');
  assert.match(r.reason, /Pre-approved/);
});

test('decide: missing payload allows', () => {
  const r = decide({ env: {}, payload: null });
  assert.equal(r.decision, 'allow');
});

test('decide: payload with read error allows', () => {
  const r = decide({ env: {}, payload: { _readError: 'EAGAIN' } });
  assert.equal(r.decision, 'allow');
});

test('decide: non-egress tool allows', () => {
  const r = decide({
    env: {},
    payload: { tool_name: 'Read', tool_input: { file_path: '/x' } },
  });
  assert.equal(r.decision, 'allow');
});

test('decide: cloud egress with no local-file ref allows', () => {
  const r = decide({
    env: {},
    payload: { tool_name: 'WebFetch', tool_input: { url: 'https://api.example.com/health' } },
  });
  assert.equal(r.decision, 'allow');
});

test('decide: cloud egress carrying a local file path asks', () => {
  const r = decide({
    env: {},
    payload: {
      tool_name: 'WebFetch',
      tool_input: { url: 'https://api.example.com/u', body: '"/Users/igor/.env"' },
    },
  });
  assert.equal(r.decision, 'ask');
  assert.match(r.reason, /cloud egress/i);
});

test('decide: returns a valid PreToolUse hook output shape', () => {
  const r = decide({
    env: {},
    payload: { tool_name: 'Read', tool_input: {} },
  });
  assert.equal(r.output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.ok(['allow', 'ask', 'deny'].includes(r.output.hookSpecificOutput.permissionDecision));
});

// End-to-end tests via child_process: exercise main(), readToolUse(), and
// logDecision() which are not reachable from the pure decide() surface. These
// lift coverage on the gate file above the Sonar 80% threshold.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const GATE = path.resolve(__dirname, '..', 'scripts', 'gates', 'cloud-egress-confirm.js');

function runGate({ stdin = '', env = {} } = {}) {
  return spawnSync(process.execPath, [GATE], {
    input: stdin,
    env: { ...process.env, ...env, NODE_OPTIONS: '' },
    encoding: 'utf8',
  });
}

test('main: env override returns allow output on stdout', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ce-'));
  const r = runGate({
    env: { THUMBGATE_PROJECT_DIR: tmp, THUMBGATE_CLOUD_EGRESS_OK: '1' },
  });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'allow');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('main: empty stdin allows pass-through', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ce-'));
  const r = runGate({ env: { THUMBGATE_PROJECT_DIR: tmp } });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'allow');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('main: malformed JSON stdin still allows (with parse error swallowed)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ce-'));
  const r = runGate({
    stdin: '{not-json',
    env: { THUMBGATE_PROJECT_DIR: tmp },
  });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'allow');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('main: cloud egress with local file ref → asks, writes log entry', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ce-'));
  const payload = JSON.stringify({
    tool_name: 'WebFetch',
    tool_input: { url: 'https://api.example.com/u', body: '"/Users/igor/.env"' },
  });
  const r = runGate({ stdin: payload, env: { THUMBGATE_PROJECT_DIR: tmp } });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'ask');
  const log = fs.readFileSync(path.join(tmp, '.thumbgate', 'cloud-egress.jsonl'), 'utf8');
  assert.match(log, /"decision":"ask"/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('main: non-egress tool allows without writing log', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ce-'));
  const payload = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/x' } });
  const r = runGate({ stdin: payload, env: { THUMBGATE_PROJECT_DIR: tmp } });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'allow');
  // No log because decide() doesn't emit log for plain non-egress
  const logPath = path.join(tmp, '.thumbgate', 'cloud-egress.jsonl');
  assert.equal(fs.existsSync(logPath), false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('main: cloud egress without local file ref allows, writes log', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ce-'));
  const payload = JSON.stringify({
    tool_name: 'WebFetch',
    tool_input: { url: 'https://api.example.com/health' },
  });
  const r = runGate({ stdin: payload, env: { THUMBGATE_PROJECT_DIR: tmp } });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'allow');
  const log = fs.readFileSync(path.join(tmp, '.thumbgate', 'cloud-egress.jsonl'), 'utf8');
  assert.match(log, /"decision":"allow"/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
