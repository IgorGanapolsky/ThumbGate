'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { evaluateGates, buildMatchSurfaces } = require('../scripts/gates-engine');

const CONFIG = path.join(__dirname, '..', 'config', 'gates', 'default.json');

test('buildMatchSurfaces includes tool name for MCP calls without command', () => {
  const surfaces = buildMatchSurfaces('mcp__claude_ai_Gmail__send_message', { to: ['a@b.com'] });
  assert.ok(surfaces.some((s) => s.includes('send_message')));
});

test('outbound-email-send blocks Gmail MCP send_message', () => {
  const result = evaluateGates(
    'mcp__claude_ai_Gmail__send_message',
    { to: ['hiring@example.com'], body: 'please find attached' },
    CONFIG,
  );
  assert.ok(result, 'expected a gate hit');
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'outbound-email-send');
});

test('outbound-email-send blocks Gmail API messages/send via Bash curl', () => {
  const result = evaluateGates(
    'Bash',
    { command: 'curl -X POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send -d @payload.json' },
    CONFIG,
  );
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'outbound-email-send');
});

test('outbound-email-send allows create_draft', () => {
  const result = evaluateGates(
    'mcp__claude_ai_Gmail__create_draft',
    { to: ['hiring@example.com'], body: 'draft only' },
    CONFIG,
  );
  // create_draft must not match the send pattern
  if (result && result.gate === 'outbound-email-send') {
    assert.fail(`create_draft should not hit outbound-email-send, got ${JSON.stringify(result)}`);
  }
});

test('outbound-email-send blocks send_draft', () => {
  const result = evaluateGates(
    'mcp__claude_ai_Gmail__send_draft',
    { draftId: 'r123' },
    CONFIG,
  );
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'outbound-email-send');
});

test('force-push still blocks after multi-surface match change', () => {
  const result = evaluateGates(
    'Bash',
    { command: 'git push --force origin main' },
    CONFIG,
  );
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'force-push');
});

test('outbound-email-send blocks Python googleapiclient messages().send', () => {
  const result = evaluateGates(
    'Bash',
    { command: "python3 -c \"service.users().messages().send(userId='me', body=raw).execute()\"" },
    CONFIG,
  );
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'outbound-email-send');
});

test('outbound-email-send is unconditional hard floor (never warn-by-default)', () => {
  const { applyEnforcementPosture } = require('../scripts/gates-engine');
  const prev = process.env.THUMBGATE_STRICT_ENFORCEMENT;
  delete process.env.THUMBGATE_STRICT_ENFORCEMENT;
  try {
    const postured = applyEnforcementPosture({
      decision: 'deny',
      gate: 'outbound-email-send',
      message: 'Outbound email SEND is blocked.',
      severity: 'critical',
    });
    assert.equal(postured.decision, 'deny', 'must stay deny without STRICT');
    assert.notEqual(postured.warnByDefault, true);
  } finally {
    if (prev !== undefined) process.env.THUMBGATE_STRICT_ENFORCEMENT = prev;
    else delete process.env.THUMBGATE_STRICT_ENFORCEMENT;
  }
});

test('outbound-email-send allows code search that mentions nodemailer', () => {
  const result = evaluateGates(
    'Bash',
    { command: 'rg -n nodemailer src/' },
    CONFIG,
  );
  if (result && result.gate === 'outbound-email-send') {
    assert.fail(`false positive: ${JSON.stringify(result)}`);
  }
});

test('outbound-email-send blocks nodemailer createTransport usage', () => {
  const result = evaluateGates(
    'Bash',
    { command: "node -e \"require('nodemailer').createTransport({})\"" },
    CONFIG,
  );
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'outbound-email-send');
});
