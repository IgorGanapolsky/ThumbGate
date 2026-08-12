'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gatesEngine = require('../scripts/gates-engine');
const { evaluateGates, buildMatchSurfaces } = gatesEngine;

const CONFIG = path.join(__dirname, '..', 'config', 'gates', 'default.json');
const ORIGINAL_PATHS = {
  STATE_PATH: gatesEngine.STATE_PATH,
  STATS_PATH: gatesEngine.STATS_PATH,
  CONSTRAINTS_PATH: gatesEngine.CONSTRAINTS_PATH,
  SESSION_ACTIONS_PATH: gatesEngine.SESSION_ACTIONS_PATH,
  CUSTOM_CLAIM_GATES_PATH: gatesEngine.CUSTOM_CLAIM_GATES_PATH,
  GOVERNANCE_STATE_PATH: gatesEngine.GOVERNANCE_STATE_PATH,
};

let sandboxDir;

beforeEach(() => {
  sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-email-gate-'));
  for (const key of Object.keys(ORIGINAL_PATHS)) {
    gatesEngine[key] = path.join(sandboxDir, `${key.toLowerCase()}.json`);
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_PATHS)) {
    gatesEngine[key] = value;
  }
  fs.rmSync(sandboxDir, { recursive: true, force: true });
});

test('buildMatchSurfaces includes tool name for MCP calls without command', () => {
  const surfaces = buildMatchSurfaces('mcp__claude_ai_Gmail__send_message', { to: ['a@b.com'] });
  assert.ok(surfaces.some((s) => s.includes('send_message')));
});

test('outbound-email-send requires approval for Gmail MCP send_message', () => {
  const result = evaluateGates(
    'mcp__claude_ai_Gmail__send_message',
    { to: ['hiring@example.com'], body: 'please find attached' },
    CONFIG,
  );
  assert.ok(result, 'expected a gate hit');
  assert.equal(result.decision, 'approve');
  assert.equal(result.gate, 'outbound-email-send');
  assert.equal(result.requiresApproval, true);
});

test('outbound-email-send requires approval for Gmail API messages/send via Bash curl', () => {
  const result = evaluateGates(
    'Bash',
    { command: 'curl -X POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send -d @payload.json' },
    CONFIG,
  );
  assert.ok(result);
  assert.equal(result.decision, 'approve');
  assert.equal(result.gate, 'outbound-email-send');
  assert.equal(result.requiresApproval, true);
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

test('outbound-email-send requires approval for send_draft', () => {
  const result = evaluateGates(
    'mcp__claude_ai_Gmail__send_draft',
    { draftId: 'r123' },
    CONFIG,
  );
  assert.ok(result);
  assert.equal(result.decision, 'approve');
  assert.equal(result.gate, 'outbound-email-send');
  assert.equal(result.requiresApproval, true);
});

test('outbound-email-send fails closed for send_draft in autonomous mode', () => {
  const previousAutonomous = process.env.THUMBGATE_AUTONOMOUS;
  const previousApprovalGates = process.env.THUMBGATE_APPROVAL_GATES;
  try {
    process.env.THUMBGATE_AUTONOMOUS = '1';
    delete process.env.THUMBGATE_APPROVAL_GATES;
    const result = evaluateGates(
      'mcp__claude_ai_Gmail__send_draft',
      { draftId: 'r123' },
      CONFIG,
    );
    assert.ok(result);
    assert.equal(result.decision, 'deny');
    assert.equal(result.gate, 'outbound-email-send');
    assert.equal(result.requiresApproval, true);
    assert.equal(result.failedClosed, true);
  } finally {
    if (previousAutonomous === undefined) delete process.env.THUMBGATE_AUTONOMOUS;
    else process.env.THUMBGATE_AUTONOMOUS = previousAutonomous;
    if (previousApprovalGates === undefined) delete process.env.THUMBGATE_APPROVAL_GATES;
    else process.env.THUMBGATE_APPROVAL_GATES = previousApprovalGates;
  }
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

test('outbound-email-send requires approval for Python googleapiclient messages().send', () => {
  const result = evaluateGates(
    'Bash',
    { command: "python3 -c \"service.users().messages().send(userId='me', body=raw).execute()\"" },
    CONFIG,
  );
  assert.ok(result);
  assert.equal(result.decision, 'approve');
  assert.equal(result.gate, 'outbound-email-send');
  assert.equal(result.requiresApproval, true);
});

test('outbound-email-send approval checkpoint is never downgraded to warn-by-default', () => {
  const { applyEnforcementPosture } = require('../scripts/gates-engine');
  const prev = process.env.THUMBGATE_STRICT_ENFORCEMENT;
  delete process.env.THUMBGATE_STRICT_ENFORCEMENT;
  try {
    const postured = applyEnforcementPosture({
      decision: 'approve',
      gate: 'outbound-email-send',
      message: 'Outbound email SEND requires explicit named-human approval.',
      severity: 'critical',
      requiresApproval: true,
    });
    assert.equal(postured.decision, 'approve', 'must preserve approval without STRICT');
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

test('outbound-email-send requires approval for nodemailer createTransport usage', () => {
  const result = evaluateGates(
    'Bash',
    { command: "node -e \"require('nodemailer').createTransport({})\"" },
    CONFIG,
  );
  assert.ok(result);
  assert.equal(result.decision, 'approve');
  assert.equal(result.gate, 'outbound-email-send');
  assert.equal(result.requiresApproval, true);
});
