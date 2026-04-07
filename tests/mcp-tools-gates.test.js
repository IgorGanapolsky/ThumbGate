const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-mcp-gates-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;

const { handleRequest, TOOLS } = require('../adapters/mcp/server-stdio');
const gatesEngine = require('../scripts/gates-engine');

const ORIGINAL_PATHS = {
  sessionActions: gatesEngine.SESSION_ACTIONS_PATH,
  customClaimGates: gatesEngine.CUSTOM_CLAIM_GATES_PATH,
  governanceState: gatesEngine.GOVERNANCE_STATE_PATH,
};

let runtimeSandboxDir = null;

test.after(() => {
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
});

beforeEach(() => {
  runtimeSandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-mcp-gates-runtime-'));
  gatesEngine.SESSION_ACTIONS_PATH = path.join(runtimeSandboxDir, 'session-actions.json');
  gatesEngine.CUSTOM_CLAIM_GATES_PATH = path.join(runtimeSandboxDir, 'claim-verification.json');
  gatesEngine.GOVERNANCE_STATE_PATH = path.join(runtimeSandboxDir, 'governance-state.json');
  fs.rmSync(gatesEngine.SESSION_ACTIONS_PATH, { force: true });
  fs.rmSync(gatesEngine.CUSTOM_CLAIM_GATES_PATH, { force: true });
  fs.rmSync(gatesEngine.GOVERNANCE_STATE_PATH, { force: true });
});

afterEach(() => {
  gatesEngine.SESSION_ACTIONS_PATH = ORIGINAL_PATHS.sessionActions;
  gatesEngine.CUSTOM_CLAIM_GATES_PATH = ORIGINAL_PATHS.customClaimGates;
  gatesEngine.GOVERNANCE_STATE_PATH = ORIGINAL_PATHS.governanceState;
  if (runtimeSandboxDir) {
    fs.rmSync(runtimeSandboxDir, { recursive: true, force: true });
    runtimeSandboxDir = null;
  }
});

// ---------------------------------------------------------------------------
// satisfy_gate (existing tool — uses `gate` param)
// ---------------------------------------------------------------------------

test('satisfy_gate tool is registered', () => {
  const tool = TOOLS.find((t) => t.name === 'satisfy_gate');
  assert.ok(tool, 'satisfy_gate should be in TOOLS array');
  assert.ok(tool.inputSchema.required.includes('gate'), 'requires gate param');
});

test('satisfy_gate stores evidence with TTL', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 100,
    method: 'tools/call',
    params: {
      name: 'satisfy_gate',
      arguments: {
        gate: 'pr_threads_checked',
        evidence: 'Verified 0 unresolved threads via gh api graphql',
      },
    },
  });

  assert.ok(result.content);
  const text = result.content[0].text;
  const parsed = JSON.parse(text);
  assert.equal(parsed.satisfied, true);
  assert.equal(parsed.gate, 'pr_threads_checked');
  assert.ok(parsed.timestamp);
});

test('satisfy_gate requires gate param', async () => {
  await assert.rejects(
    handleRequest({
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: {
        name: 'satisfy_gate',
        arguments: {},
      },
    }),
    { message: /gate/i },
  );
});

test('track_action, verify_claim, and register_claim_gate are registered', () => {
  const names = TOOLS.map((tool) => tool.name);
  assert.ok(names.includes('track_action'));
  assert.ok(names.includes('verify_claim'));
  assert.ok(names.includes('register_claim_gate'));
  assert.ok(names.includes('set_task_scope'));
  assert.ok(names.includes('get_scope_state'));
  assert.ok(names.includes('approve_protected_action'));
});

test('set_task_scope and get_scope_state round-trip over MCP', async () => {
  const setResult = await handleRequest({
    jsonrpc: '2.0',
    id: 109,
    method: 'tools/call',
    params: {
      name: 'set_task_scope',
      arguments: {
        taskId: '1733520',
        summary: 'harden ThumbGate',
        allowedPaths: ['scripts/**', 'tests/**'],
        protectedPaths: ['AGENTS.md'],
        localOnly: true,
      },
    },
  });
  const setPayload = JSON.parse(setResult.content[0].text);
  assert.equal(setPayload.scope.taskId, '1733520');
  assert.deepEqual(setPayload.scope.allowedPaths, ['scripts/**', 'tests/**']);

  const getResult = await handleRequest({
    jsonrpc: '2.0',
    id: 110,
    method: 'tools/call',
    params: {
      name: 'get_scope_state',
      arguments: {},
    },
  });
  const getPayload = JSON.parse(getResult.content[0].text);
  assert.equal(getPayload.taskScope.taskId, '1733520');
  assert.equal(getPayload.taskScope.localOnly, true);
});

test('approve_protected_action stores runtime approval over MCP', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 111,
    method: 'tools/call',
    params: {
      name: 'approve_protected_action',
      arguments: {
        pathGlobs: ['AGENTS.md'],
        reason: 'user explicitly approved policy change',
        evidence: 'ticket 1733520',
      },
    },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.approved, true);
  assert.deepEqual(payload.approval.pathGlobs, ['AGENTS.md']);
  assert.equal(fs.existsSync(gatesEngine.GOVERNANCE_STATE_PATH), true);
});

test('track_action records evidence for verify_claim over MCP', async () => {
  fs.rmSync(gatesEngine.SESSION_ACTIONS_PATH, { force: true });
  const tracked = await handleRequest({
    jsonrpc: '2.0',
    id: 106,
    method: 'tools/call',
    params: {
      name: 'track_action',
      arguments: {
        actionId: 'tests_passed',
        metadata: { source: 'npm test' },
      },
    },
  });
  const trackedPayload = JSON.parse(tracked.content[0].text);
  assert.equal(trackedPayload.tracked, true);
  assert.equal(trackedPayload.actionId, 'tests_passed');

  const verified = await handleRequest({
    jsonrpc: '2.0',
    id: 107,
    method: 'tools/call',
    params: {
      name: 'verify_claim',
      arguments: {
        claim: 'tests pass',
      },
    },
  });
  const verifiedPayload = JSON.parse(verified.content[0].text);
  assert.equal(verifiedPayload.verified, true);
});

test('register_claim_gate stores runtime-local custom rules over MCP', async () => {
  fs.rmSync(gatesEngine.CUSTOM_CLAIM_GATES_PATH, { force: true });
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 108,
    method: 'tools/call',
    params: {
      name: 'register_claim_gate',
      arguments: {
        claimPattern: 'ready to demo',
        requiredActions: ['tests_passed'],
        message: 'Run tests before demo claims',
      },
    },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.pattern, 'ready to demo');
  assert.equal(fs.existsSync(gatesEngine.CUSTOM_CLAIM_GATES_PATH), true);
});

// ---------------------------------------------------------------------------
// gate_stats (new tool)
// ---------------------------------------------------------------------------

test('gate_stats tool is registered', () => {
  const tool = TOOLS.find((t) => t.name === 'gate_stats');
  assert.ok(tool, 'gate_stats should be in TOOLS array');
});

test('gate_stats returns stats object', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 102,
    method: 'tools/call',
    params: {
      name: 'gate_stats',
      arguments: {},
    },
  });

  assert.ok(result.content);
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(typeof parsed.blocked, 'number');
  assert.equal(typeof parsed.warned, 'number');
  assert.equal(typeof parsed.passed, 'number');
});

test('diagnose_failure tool is registered', () => {
  const tool = TOOLS.find((t) => t.name === 'diagnose_failure');
  assert.ok(tool, 'diagnose_failure should be in TOOLS array');
});

// ---------------------------------------------------------------------------
// dashboard (new tool)
// ---------------------------------------------------------------------------

test('dashboard tool is registered', () => {
  const tool = TOOLS.find((t) => t.name === 'dashboard');
  assert.ok(tool, 'dashboard should be in TOOLS array');
});

test('dashboard returns full report', async () => {
  // Seed some feedback data
  const feedbackPath = path.join(tmpFeedbackDir, 'feedback-log.jsonl');
  const entries = [
    { signal: 'positive', timestamp: new Date().toISOString(), tags: [] },
    {
      signal: 'negative',
      timestamp: new Date().toISOString(),
      tags: ['testing'],
      diagnosis: {
        rootCauseCategory: 'tool_output_misread',
        criticalFailureStep: 'verification',
        violations: [{ constraintId: 'workflow:proof_commands' }],
      },
    },
    { signal: 'positive', timestamp: new Date().toISOString(), tags: [] },
  ];
  fs.writeFileSync(feedbackPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 103,
    method: 'tools/call',
    params: {
      name: 'dashboard',
      arguments: {},
    },
  });

  assert.ok(result.content);
  const parsed = JSON.parse(result.content[0].text);
  assert.ok(parsed.approval);
  assert.ok(parsed.gateStats);
  assert.ok(parsed.prevention);
  assert.ok(parsed.trend);
  assert.ok(parsed.health);
  assert.ok(parsed.diagnostics);
  assert.ok(parsed.delegation);
  assert.ok(parsed.analytics);
  assert.ok(parsed.observability);
  assert.equal(parsed.approval.total, 3);
  assert.equal(parsed.approval.positive, 2);
  assert.equal(parsed.approval.negative, 1);
  assert.equal(parsed.diagnostics.totalDiagnosed, 1);
  assert.equal(typeof parsed.delegation.attemptCount, 'number');
});

test('dashboard handles empty state', async () => {
  // Clear feedback file
  const feedbackPath = path.join(tmpFeedbackDir, 'feedback-log.jsonl');
  if (fs.existsSync(feedbackPath)) fs.unlinkSync(feedbackPath);

  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 104,
    method: 'tools/call',
    params: {
      name: 'dashboard',
      arguments: {},
    },
  });

  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.approval.total, 0);
  assert.equal(parsed.health.feedbackCount, 0);
});

// ---------------------------------------------------------------------------
// tools/list includes new tools
// ---------------------------------------------------------------------------

test('tools/list includes gate and scope-control tools', async () => {
  const result = await handleRequest({ jsonrpc: '2.0', id: 105, method: 'tools/list' });
  const names = result.tools.map((t) => t.name);
  assert.ok(names.includes('satisfy_gate'), 'satisfy_gate in tools/list');
  assert.ok(names.includes('set_task_scope'), 'set_task_scope in tools/list');
  assert.ok(names.includes('get_scope_state'), 'get_scope_state in tools/list');
  assert.ok(names.includes('approve_protected_action'), 'approve_protected_action in tools/list');
  assert.ok(names.includes('track_action'), 'track_action in tools/list');
  assert.ok(names.includes('verify_claim'), 'verify_claim in tools/list');
  assert.ok(names.includes('register_claim_gate'), 'register_claim_gate in tools/list');
  assert.ok(names.includes('gate_stats'), 'gate_stats in tools/list');
  assert.ok(names.includes('dashboard'), 'dashboard in tools/list');
  assert.ok(names.includes('diagnose_failure'), 'diagnose_failure in tools/list');
  assert.ok(names.includes('start_handoff'), 'start_handoff in tools/list');
  assert.ok(names.includes('complete_handoff'), 'complete_handoff in tools/list');
});
