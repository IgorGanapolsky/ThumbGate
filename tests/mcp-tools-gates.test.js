const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-mcp-gates-test-'));
process.env.RLHF_FEEDBACK_DIR = tmpFeedbackDir;

const { handleRequest, TOOLS } = require('../adapters/mcp/server-stdio');
const {
  SESSION_ACTIONS_PATH,
  CUSTOM_CLAIM_GATES_PATH,
} = require('../scripts/gates-engine');

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

function backupRuntimeState() {
  return {
    sessionActions: readIfExists(SESSION_ACTIONS_PATH),
    customClaimGates: readIfExists(CUSTOM_CLAIM_GATES_PATH),
  };
}

function restoreRuntimeState(backups) {
  const restoreOne = (filePath, content) => {
    if (content === null) {
      fs.rmSync(filePath, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  };

  restoreOne(SESSION_ACTIONS_PATH, backups.sessionActions);
  restoreOne(CUSTOM_CLAIM_GATES_PATH, backups.customClaimGates);
}

test.after(() => {
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
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
});

test('track_action records evidence for verify_claim over MCP', async () => {
  const backups = backupRuntimeState();
  try {
    fs.rmSync(SESSION_ACTIONS_PATH, { force: true });
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
  } finally {
    restoreRuntimeState(backups);
  }
});

test('register_claim_gate stores runtime-local custom rules over MCP', async () => {
  const backups = backupRuntimeState();
  try {
    fs.rmSync(CUSTOM_CLAIM_GATES_PATH, { force: true });
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
    assert.equal(fs.existsSync(CUSTOM_CLAIM_GATES_PATH), true);
  } finally {
    restoreRuntimeState(backups);
  }
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

test('tools/list includes gate_stats, dashboard, and diagnose_failure', async () => {
  const result = await handleRequest({ jsonrpc: '2.0', id: 105, method: 'tools/list' });
  const names = result.tools.map((t) => t.name);
  assert.ok(names.includes('satisfy_gate'), 'satisfy_gate in tools/list');
  assert.ok(names.includes('track_action'), 'track_action in tools/list');
  assert.ok(names.includes('verify_claim'), 'verify_claim in tools/list');
  assert.ok(names.includes('register_claim_gate'), 'register_claim_gate in tools/list');
  assert.ok(names.includes('gate_stats'), 'gate_stats in tools/list');
  assert.ok(names.includes('dashboard'), 'dashboard in tools/list');
  assert.ok(names.includes('diagnose_failure'), 'diagnose_failure in tools/list');
  assert.ok(names.includes('start_handoff'), 'start_handoff in tools/list');
  assert.ok(names.includes('complete_handoff'), 'complete_handoff in tools/list');
});
