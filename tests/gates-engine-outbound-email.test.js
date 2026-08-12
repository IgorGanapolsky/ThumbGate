'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gatesEngine = require('../scripts/gates-engine');
const {
  evaluateGates,
  evaluateGatesAsync,
  buildMatchSurfaces,
  actionApprovalDigest,
} = gatesEngine;
const {
  consumeVerifiedApproval,
  decideEscalation,
  listEscalations,
  requestEscalation,
} = require('../scripts/human-escalation');

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
let originalFeedbackDir;
let originalReviewerKey;

beforeEach(() => {
  sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-email-gate-'));
  originalFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  originalReviewerKey = process.env.THUMBGATE_HUMAN_REVIEWER_KEY;
  process.env.THUMBGATE_FEEDBACK_DIR = path.join(sandboxDir, 'feedback');
  process.env.THUMBGATE_HUMAN_REVIEWER_KEY = 'test-independent-admin-key';
  for (const key of Object.keys(ORIGINAL_PATHS)) {
    gatesEngine[key] = path.join(sandboxDir, `${key.toLowerCase()}.json`);
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_PATHS)) {
    gatesEngine[key] = value;
  }
  if (originalFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
  else process.env.THUMBGATE_FEEDBACK_DIR = originalFeedbackDir;
  if (originalReviewerKey === undefined) delete process.env.THUMBGATE_HUMAN_REVIEWER_KEY;
  else process.env.THUMBGATE_HUMAN_REVIEWER_KEY = originalReviewerKey;
  fs.rmSync(sandboxDir, { recursive: true, force: true });
});

test('buildMatchSurfaces includes tool name for MCP calls without command', () => {
  const surfaces = buildMatchSurfaces('mcp__claude_ai_Gmail__send_message', { to: ['a@b.com'] });
  assert.ok(surfaces.some((s) => s.includes('send_message')));
});

test('outbound-email-send hard-blocks Gmail MCP send_message and requests admin override', () => {
  const result = evaluateGates(
    'mcp__claude_ai_Gmail__send_message',
    { to: ['hiring@example.com'], body: 'please find attached' },
    CONFIG,
  );
  assert.ok(result, 'expected a gate hit');
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'outbound-email-send');
  assert.equal(result.requiresAdminOverride, true);
  assert.match(result.message, /Approval request:/);
  assert.match(result.message, /Action digest: sha256:[a-f0-9]{64}/);
});

test('outbound-email-send hard-blocks Gmail API messages/send via Bash curl', () => {
  const result = evaluateGates(
    'Bash',
    { command: 'curl -X POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send -d @payload.json' },
    CONFIG,
  );
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'outbound-email-send');
  assert.equal(result.requiresAdminOverride, true);
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

test('outbound-email-send hard-blocks send_draft pending admin override', () => {
  const result = evaluateGates(
    'mcp__claude_ai_Gmail__send_draft',
    { draftId: 'r123' },
    CONFIG,
  );
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'outbound-email-send');
  assert.equal(result.requiresAdminOverride, true);
});

test('admin override is exact-payload-bound and single-use', () => {
  const toolName = 'mcp__claude_ai_Gmail__send_message';
  const toolInput = { to: ['hiring@example.com'], subject: 'Exact subject', body: 'Exact body' };
  const blocked = evaluateGates(toolName, toolInput, CONFIG);
  assert.equal(blocked.decision, 'deny');
  assert.equal(blocked.adminOverride.approvalContextDigest, actionApprovalDigest(toolName, toolInput));

  decideEscalation({
    escalationId: blocked.adminOverride.escalationId,
    decision: 'approved',
    reason: 'Admin approved this exact recipient, subject, and body once.',
  }, {
    authenticatedActor: { id: 'admin-igor', kind: 'human', role: 'admin' },
    approvalSigningKey: process.env.THUMBGATE_HUMAN_REVIEWER_KEY,
    feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
  });

  const changedPayload = evaluateGates(toolName, { ...toolInput, body: 'Changed body' }, CONFIG);
  assert.equal(changedPayload.decision, 'deny', 'changed payload needs its own approval');
  assert.notEqual(changedPayload.adminOverride.approvalContextDigest, blocked.adminOverride.approvalContextDigest);

  const allowedOnce = evaluateGates(toolName, toolInput, CONFIG);
  assert.equal(allowedOnce.decision, 'allow');
  assert.equal(allowedOnce.adminOverride.authorized, true);
  assert.deepEqual(allowedOnce.adminOverride.approver, { id: 'admin-igor', kind: 'human', role: 'admin' });

  const replay = evaluateGates(toolName, toolInput, CONFIG);
  assert.equal(replay.decision, 'deny', 'consumed approval cannot authorize a replay');
  assert.notEqual(replay.adminOverride.escalationId, blocked.adminOverride.escalationId);
  assert.match(replay.adminOverride.taskId, /:attempt:2$/);
});

test('admin override authorizes one exact async evaluation', async () => {
  const toolName = 'mcp__claude_ai_Gmail__send_message';
  const toolInput = { to: ['hiring@example.com'], subject: 'Async subject', body: 'Async body' };
  const blocked = await evaluateGatesAsync(toolName, toolInput, CONFIG);
  assert.equal(blocked.decision, 'deny');

  decideEscalation({
    escalationId: blocked.adminOverride.escalationId,
    decision: 'approved',
    reason: 'Admin approved this exact async send once.',
  }, {
    authenticatedActor: { id: 'admin-igor', kind: 'human', role: 'admin' },
    approvalSigningKey: process.env.THUMBGATE_HUMAN_REVIEWER_KEY,
    feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
  });

  const allowed = await evaluateGatesAsync(toolName, toolInput, CONFIG);
  assert.equal(allowed.decision, 'allow');
  assert.equal(allowed.adminOverride.authorized, true);
  assert.equal((await evaluateGatesAsync(toolName, toolInput, CONFIG)).decision, 'deny');
});

test('expired admin approval fails closed before consumption', () => {
  const now = new Date('2026-08-12T00:00:00.000Z');
  const requested = requestEscalation({
    taskId: 'admin-override:outbound-email-send:expired-proof',
    reason: 'Admin override required for expiry proof.',
    severity: 'critical',
    requester: { id: 'thumbgate-gates-engine', kind: 'service' },
    evidence: [`sha256:${'a'.repeat(64)}`],
    ttlMs: 1,
    idempotencyKey: 'admin-override:outbound-email-send:expired-proof',
    approvalContextDigest: 'a'.repeat(64),
    requiredReviewerRole: 'admin',
  }, {
    feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
    now,
  });
  decideEscalation({
    escalationId: requested.escalation.escalationId,
    decision: 'approved',
    reason: 'Approved before expiry.',
  }, {
    authenticatedActor: { id: 'admin-igor', kind: 'human', role: 'admin' },
    approvalSigningKey: process.env.THUMBGATE_HUMAN_REVIEWER_KEY,
    feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
    now,
  });

  const consumption = consumeVerifiedApproval(requested.escalation.escalationId, {
    consumer: { id: 'thumbgate-gates-engine', kind: 'service' },
  }, {
    feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
    now: new Date(now.getTime() + 2),
  });
  assert.deepEqual(consumption, { consumed: false, replayed: false, consumption: null });
});

test('unsigned or caller-authored approval cannot override the hard gate', () => {
  const toolName = 'mcp__claude_ai_Gmail__send_message';
  const toolInput = { to: ['hiring@example.com'], body: 'Exact body' };
  const blocked = evaluateGates(toolName, toolInput, CONFIG);
  decideEscalation({
    escalationId: blocked.adminOverride.escalationId,
    decision: 'approved',
    reason: 'Unsigned row is not an admin authorization.',
  }, {
    authenticatedActor: { id: 'admin-igor', kind: 'human', role: 'admin' },
    feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
  });
  const retried = evaluateGates(toolName, toolInput, CONFIG);
  assert.equal(retried.decision, 'deny');
  assert.equal(retried.requiresAdminOverride, true);
  assert.equal(listEscalations({ feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR }).length, 1);
});

test('authenticated non-admin reviewer cannot grant an admin override', () => {
  const toolName = 'mcp__claude_ai_Gmail__send_message';
  const toolInput = { to: ['hiring@example.com'], body: 'Exact body' };
  const blocked = evaluateGates(toolName, toolInput, CONFIG);
  assert.throws(() => decideEscalation({
    escalationId: blocked.adminOverride.escalationId,
    decision: 'approved',
    reason: 'Reviewer lacks the admin role.',
  }, {
    authenticatedActor: { id: 'ordinary-reviewer', kind: 'human', role: 'reviewer' },
    approvalSigningKey: process.env.THUMBGATE_HUMAN_REVIEWER_KEY,
    feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
  }), /must have role 'admin'/);
  assert.equal(evaluateGates(toolName, toolInput, CONFIG).decision, 'deny');
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

test('outbound-email-send hard-blocks Python googleapiclient messages().send', () => {
  const result = evaluateGates(
    'Bash',
    { command: "python3 -c \"service.users().messages().send(userId='me', body=raw).execute()\"" },
    CONFIG,
  );
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'outbound-email-send');
  assert.equal(result.requiresAdminOverride, true);
});

test('outbound-email-send hard block is never downgraded to warn-by-default', () => {
  const { applyEnforcementPosture } = require('../scripts/gates-engine');
  const prev = process.env.THUMBGATE_STRICT_ENFORCEMENT;
  delete process.env.THUMBGATE_STRICT_ENFORCEMENT;
  try {
    const postured = applyEnforcementPosture({
      decision: 'deny',
      gate: 'outbound-email-send',
      message: 'Outbound email SEND is hard-blocked pending admin override.',
      severity: 'critical',
      requiresAdminOverride: true,
    });
    assert.equal(postured.decision, 'deny', 'must preserve hard block without STRICT');
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

test('outbound-email-send hard-blocks nodemailer createTransport usage', () => {
  const result = evaluateGates(
    'Bash',
    { command: "node -e \"require('nodemailer').createTransport({})\"" },
    CONFIG,
  );
  assert.ok(result);
  assert.equal(result.decision, 'deny');
  assert.equal(result.gate, 'outbound-email-send');
  assert.equal(result.requiresAdminOverride, true);
});
