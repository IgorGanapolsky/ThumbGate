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

test('withdrawn admin override before execution fails closed at T=0 and cannot be consumed', () => {
  const toolName = 'mcp__claude_ai_Gmail__send_message';
  const toolInput = { to: ['mark@arqua.com.au'], subject: 'Walkthrough', body: 'Exact body' };
  const blocked = evaluateGates(toolName, toolInput, CONFIG);
  assert.equal(blocked.decision, 'deny');

  decideEscalation({
    escalationId: blocked.adminOverride.escalationId,
    decision: 'approved',
    reason: 'Admin approved at T1.',
  }, {
    authenticatedActor: { id: 'admin-igor', kind: 'human', role: 'admin' },
    approvalSigningKey: process.env.THUMBGATE_HUMAN_REVIEWER_KEY,
    feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
  });

  decideEscalation({
    escalationId: blocked.adminOverride.escalationId,
    decision: 'cancelled',
    reason: 'Authority withdrawn before T=0 execution.',
  }, {
    authenticatedActor: { id: 'admin-igor', kind: 'human', role: 'admin' },
    approvalSigningKey: process.env.THUMBGATE_HUMAN_REVIEWER_KEY,
    feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
  });

  const atExecution = evaluateGates(toolName, toolInput, CONFIG);
  assert.equal(atExecution.decision, 'deny', 'withdrawn approval must fail closed at T=0');
  assert.notEqual(atExecution.adminOverride.escalationId, blocked.adminOverride.escalationId);
  assert.match(atExecution.adminOverride.taskId, /:attempt:2$/);
});

const {
  assertNoCorporateLeak,
  classifyThreads,
} = require('../scripts/thumbgate-inbox-sentinel');

test('inbox sentinel enforces ONE-TOUCH lock when Sent Mail already replied after inbound Boardy intro', () => {
  const report = classifyThreads([
    {
      mailbox: 'All Mail',
      date: '2026-10-18T12:00:00.000Z',
      from: 'Boardy Boardman <boardy@boardy.ai>',
      to: ['mark@arqua.com.au', 'igor@igorganapolsky.com'],
      cc: [],
      subject: 'Boardy Intro: Igor + Mark',
      body: 'Mark and Igor, connecting you on execution admissibility.',
    },
    {
      mailbox: 'Sent Mail',
      date: '2026-10-18T14:52:58.000Z',
      from: 'Igor Ganapolsky <igor@igorganapolsky.com>',
      to: ['mark@arqua.com.au'],
      cc: ['boardy@boardy.ai'],
      subject: 'Re: Boardy Intro: Igor + Mark',
      body: 'Hi Mark, As promised, a short walkthrough of how ThumbGate checks a tool call.',
    },
  ]);

  assert.equal(report.threadCount, 1);
  assert.equal(report.actionableCount, 0);
  const markThread = report.threads[0];
  assert.equal(markThread.status, 'REPLIED_IN_SENT');
  assert.equal(markThread.oneTouchLocked, true);
  assert.equal(markThread.actionRequired, false);
  assert.deepEqual(markThread.externalGuests, ['mark@arqua.com.au']);
});

test('inbox sentinel surfaces unsent Boardy intro draft as DRAFT_READY_AWAITING_IGOR_YES and flags missing Boardy CC', () => {
  const report = classifyThreads([
    {
      mailbox: 'INBOX',
      date: '2026-10-18T15:59:24.000Z',
      from: 'Boardy Boardman <boardy@boardy.ai>',
      to: ['keshav@alcoyai.com', 'igor@igorganapolsky.com'],
      cc: [],
      subject: 'Boardy Intro: Keshav + Igor',
      body: 'Keshav is building Alcoy, the human-in-the-loop layer.',
    },
    {
      mailbox: 'Drafts',
      date: '2026-10-18T16:17:41.000Z',
      from: 'Igor Ganapolsky <igor@igorganapolsky.com>',
      to: ['keshav@alcoyai.com'],
      cc: [],
      subject: 'Re: Boardy Intro: Keshav + Igor',
      body: 'Hi Keshav, Thanks, Boardy. As promised, a short walkthrough of how approvals work in ThumbGate.',
    },
    {
      mailbox: 'All Mail',
      date: '2026-10-18T16:17:41.000Z',
      from: 'Igor Ganapolsky <igor@igorganapolsky.com>',
      to: ['keshav@alcoyai.com'],
      cc: [],
      subject: 'Re: Boardy Intro: Keshav + Igor',
      body: 'Hi Keshav, Thanks, Boardy. As promised, a short walkthrough of how approvals work in ThumbGate.',
    },
  ]);

  assert.equal(report.threadCount, 1);
  assert.equal(report.actionableCount, 1);
  const keshavThread = report.threads[0];
  assert.equal(keshavThread.status, 'DRAFT_READY_AWAITING_IGOR_YES');
  assert.equal(keshavThread.actionRequired, true);
  assert.equal(keshavThread.oneTouchLocked, false);
  assert.equal(keshavThread.sentCount, 0);
  assert.ok(keshavThread.warnings.includes('draft_missing_boardy_cc'));
});

test('inbox sentinel marks third-person Fo drafts as STALE_FO_DRAFT_DO_NOT_SEND and blocks corporate domains', () => {
  const report = classifyThreads([
    {
      mailbox: 'Drafts',
      date: '2026-10-18T06:11:29.000Z',
      from: 'Igor Ganapolsky <igor@igorganapolsky.com>',
      to: ['boardy@boardy.ai'],
      cc: [],
      subject: 'Re: a control-plane architect to stress-test your governance model',
      body: 'Hi Boardy, Igor will review and decide on connecting.\n\nBest,\nFo (assistant to Igor Ganapolsky)',
    },
  ]);

  assert.equal(report.threads[0].status, 'STALE_FO_DRAFT_DO_NOT_SEND');
  assert.equal(report.threads[0].actionRequired, false);
  assert.ok(report.threads[0].warnings.includes('stale_third_person_fo_draft_do_not_send'));

  assert.throws(() => assertNoCorporateLeak([
    {
      from: 'iganapolsky@ecisolutions.com',
      to: ['boardy@boardy.ai'],
      subject: 'Boardy Intro',
    },
  ]), { code: 'THUMBGATE_ECI_ISOLATION_BLOCK' });
});

const {
  captureEneyThumbSignal,
  evaluateEneyActionGate,
} = require('../scripts/macpaw-eney-thumbgate-adapter');
const {
  GLOBAL_PARTNER_TARGETS,
  composePartnerOfferDraft,
} = require('../scripts/proactive-partner-discovery-engine');

test('MacPaw Eney adapter: compiles 👎 on "Quit Ollama now?" into a <0.5ms PreToolUse block that overrides "do everything you need"', () => {
  const feedback = captureEneyThumbSignal({
    signal: 'down',
    userPrompt: "why are my Mac's fan's running crazy?",
    eneyProposal: 'Quit Ollama now?',
    proposedAction: { skill: 'quit_app', target: 'Ollama', process: 'llama-server' },
  });
  assert.equal(feedback.promotedToPreToolUseGate, true);
  assert.equal(feedback.preventionRule.id, 'gate:eney:thumb_down:ollama');
  assert.ok(feedback.dpoPair.chosen.includes('Ollama'));

  const blocked = evaluateEneyActionGate({
    skill: 'quit_app',
    target: 'Ollama',
    processName: 'llama-server',
    userDelegationText: 'do everything you need',
    customRules: [feedback.preventionRule],
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.decision, 'deny');
  assert.equal(blocked.blanketDelegationOverridden, true);
  assert.ok(blocked.latencyMs < 5);

  const corpBlocked = evaluateEneyActionGate({
    skill: 'summarize_emails',
    emailDomain: 'iganapolsky@ecisolutions.com',
    userDelegationText: 'do everything you need',
  });
  assert.equal(corpBlocked.allowed, false);
  assert.equal(corpBlocked.gateId, 'gate:eney:eci_corporate_email_isolation');
});

test('proactive partner discovery engine includes MacPaw Eney and enforces hardNoSendEnforced on all offers', () => {
  const eneyTarget = GLOBAL_PARTNER_TARGETS.find((t) => t.id === 'macpaw-eney');
  assert.ok(eneyTarget);
  const draft = composePartnerOfferDraft(eneyTarget);
  assert.equal(draft.hardNoSendEnforced, true);
  assert.match(draft.subject, /MacPaw \(Eney\) × ThumbGate/);
  assert.match(draft.body, /Hi Oleksandr Kosovan,/);
});

const {
  runSalesPromotion24x7Cycle,
  writePartnerOfferMarkdownFiles,
} = require('../scripts/thumbgate-24x7-sales-promotion-job');

test('24/7 sales & promotion job writes partner offer markdown files and enforces hardNoSendEnforced', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-sales-24x7-'));
  try {
    const files = writePartnerOfferMarkdownFiles([
      {
        id: 'macpaw-eney',
        company: 'MacPaw (Eney)',
        domain: 'eney.ai',
        status: 'OFFER_STAGED_AWAITING_IGOR_YES',
        draft: composePartnerOfferDraft(GLOBAL_PARTNER_TARGETS[0]),
      },
    ], tmpDir);
    assert.equal(files.length, 1);
    assert.ok(fs.existsSync(files[0]));

    const statusPath = path.join(tmpDir, 'status.json');
    const receipt = await runSalesPromotion24x7Cycle({
      includeLiveMail: false,
      includeLiveShowHn: false,
      statusPath,
    });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.hardNoSendEnforced, true);
    assert.equal(receipt.oneTouchEnforced, true);
    assert.ok(receipt.partnerOutreach.totalTargets >= 8);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
