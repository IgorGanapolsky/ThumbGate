const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-evidence-gate-test-'));
const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-evidence-gate-proof-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
process.env.THUMBGATE_PROOF_DIR = tmpProofDir;
process.env.THUMBGATE_NO_RATE_LIMIT = '1';
// This suite intentionally exercises the expanded coordination/reporting tools.
process.env.THUMBGATE_MCP_PROFILE = 'default';

const { handleRequest, TOOLS } = require('../adapters/mcp/server-stdio');
const { clearSessionActions, trackAction } = require('../scripts/gates-engine');

async function callTool(name, args) {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1_000_000),
    method: 'tools/call',
    params: { name, arguments: args },
  });
  return JSON.parse(result.content[0].text);
}

test('require_evidence_for_claim tool is registered with the expected shape', () => {
  const tool = TOOLS.find((t) => t.name === 'require_evidence_for_claim');
  assert.ok(tool, 'require_evidence_for_claim must be registered');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.ok(tool.inputSchema.required.includes('claim'));
  assert.deepEqual(tool.inputSchema.properties.mode.enum, ['blocking', 'advisory']);
  assert.equal(tool.inputSchema.properties.goalContract.type, 'object');
  assert.equal(tool.inputSchema.properties.goalContract.properties.proveBy.items.type, 'string');
});

test('distribute_context_to_agents tool is registered with the expected shape', () => {
  const tool = TOOLS.find((t) => t.name === 'distribute_context_to_agents');
  assert.ok(tool, 'distribute_context_to_agents must be registered');
  assert.equal(tool.annotations.destructiveHint, true);
  assert.ok(tool.inputSchema.required.includes('agents'));
  assert.equal(tool.inputSchema.properties.agents.items.type, 'string');
});

test('session_report tool is registered with the expected shape', () => {
  const tool = TOOLS.find((t) => t.name === 'session_report');
  assert.ok(tool, 'session_report must be registered');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.inputSchema.properties.windowHours.type, 'number');
});

test('require_evidence_for_claim blocks completion claim when evidence missing', async () => {
  clearSessionActions();
  const response = await callTool('require_evidence_for_claim', {
    claim: 'all tests pass and CI is green',
  });
  assert.equal(response.mode, 'blocking');
  assert.equal(response.verified, false);
  assert.equal(response.matchedChecks, true);
  assert.equal(response.blocking, true);
  assert.ok(response.missingActions.includes('tests_passed'));
});

test('require_evidence_for_claim unblocks once tracked evidence exists', async () => {
  clearSessionActions();
  trackAction('tests_passed', { source: 'npm test' });

  const response = await callTool('require_evidence_for_claim', {
    claim: 'all tests pass',
  });
  assert.equal(response.verified, true);
  assert.equal(response.blocking, false);
  assert.deepEqual(response.missingActions, []);
  clearSessionActions();
});

test('require_evidence_for_claim advisory mode never blocks', async () => {
  clearSessionActions();
  const response = await callTool('require_evidence_for_claim', {
    claim: 'all tests pass',
    mode: 'advisory',
  });
  assert.equal(response.mode, 'advisory');
  assert.equal(response.verified, false);
  assert.equal(response.blocking, false);
});

test('require_evidence_for_claim returns blocking=false when no claim pattern matches', async () => {
  clearSessionActions();
  const response = await callTool('require_evidence_for_claim', {
    claim: 'this is a random sentence with nothing to verify',
  });
  assert.equal(response.matchedChecks, false);
  assert.equal(response.blocking, false);
  assert.deepEqual(response.checks, []);
});

test('require_evidence_for_claim blocks goal contract until handoff evidence exists', async () => {
  clearSessionActions();
  const response = await callTool('require_evidence_for_claim', {
    claim: 'ready for handoff',
    goalContract: {
      goal: 'Ship the checkout fix',
      doneWhen: ['Focused tests pass', 'Independent review is complete'],
      proveBy: ['tests_passed', 'review_completed'],
      mustNotChange: ['Stripe product ids', 'public package exports'],
      workerAgent: 'codex-worker',
      reviewerAgent: 'codex-reviewer',
      orchestratorAgent: 'leader-agent',
    },
  });

  assert.equal(response.blocking, true);
  assert.equal(response.verified, false);
  assert.equal(response.matchedChecks, true);
  assert.deepEqual(response.missingActions.sort(), ['review_completed', 'tests_passed']);
  assert.equal(response.goalContract.matched, true);
  assert.equal(response.goalContract.goal, 'Ship the checkout fix');
  assert.equal(response.goalContract.handoff.workerAgent, 'codex-worker');
  assert.deepEqual(response.goalContract.mustNotChange, ['Stripe product ids', 'public package exports']);
  const contractCheck = response.checks.find((check) => check.claim === 'goal_contract');
  assert.ok(contractCheck);
  assert.equal(contractCheck.passed, false);
});

test('require_evidence_for_claim unblocks goal contract after required evidence is tracked', async () => {
  clearSessionActions();
  trackAction('tests_passed', { source: 'node --test tests/checkout.test.js' });
  trackAction('review_completed', { source: 'codex-reviewer' });

  const response = await callTool('require_evidence_for_claim', {
    claim: 'ready for handoff',
    goalContract: {
      goal: 'Ship the checkout fix',
      proveBy: ['tests_passed', 'review_completed'],
      workerAgent: 'codex-worker',
      reviewerAgent: 'codex-reviewer',
      orchestratorAgent: 'leader-agent',
    },
  });

  assert.equal(response.blocking, false);
  assert.equal(response.verified, true);
  assert.deepEqual(response.missingActions, []);
  assert.equal(response.goalContract.passed, true);
  clearSessionActions();
});

test('distribute_context_to_agents returns one pack shared across workers', async () => {
  const response = await callTool('distribute_context_to_agents', {
    query: 'auth failure on checkout',
    agents: ['perplexity-bug-resolver', 'codex-reviewer', 'grok-x-intelligence'],
    maxItems: 4,
    maxChars: 1500,
  });
  assert.ok(response.packId);
  assert.equal(response.totalAgents, 3);
  const packs = new Set(response.distributions.map((d) => d.packId));
  assert.equal(packs.size, 1);
  const names = response.distributions.map((d) => d.agent).sort();
  assert.deepEqual(names, ['codex-reviewer', 'grok-x-intelligence', 'perplexity-bug-resolver']);
});

test('session_report returns a rollup with feedback, gates, and provenance sections', async () => {
  const response = await callTool('session_report', { windowHours: 4 });
  assert.equal(response.windowHours, 4);
  assert.ok(response.feedback);
  assert.ok(response.gates);
  assert.ok(response.provenance);
  assert.equal(typeof response.feedback.totalPositive, 'number');
  assert.equal(typeof response.gates.blocked, 'number');
  assert.equal(typeof response.provenance.total, 'number');
});

test('session_report windowHours clamps invalid input to defaults', async () => {
  const response = await callTool('session_report', { windowHours: -99 });
  assert.equal(response.windowHours, 1);
});

test('require_evidence_for_claim rejects non-string claim', async () => {
  await assert.rejects(() => callTool('require_evidence_for_claim', { claim: 123 }), /claim/);
});
