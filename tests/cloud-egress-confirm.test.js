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
