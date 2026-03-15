const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { runProof } = require('../scripts/prove-adapters');

let report;
let tmpProofDir;

function getCheck(name) {
  assert.ok(report, 'proof report missing');
  const fatal = report.checks.find((check) => check.name === 'fatal');
  assert.equal(fatal, undefined, fatal ? `proof fatal: ${JSON.stringify(fatal.details)}` : 'proof fatal check present');
  const found = report.checks.find((check) => check.name === name);
  assert.ok(
    found,
    `check "${name}" not found in report; available: ${report.checks.map((check) => check.name).join(', ')}`,
  );
  return found;
}

test('adapter proof harness setup', async () => {
  tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-proof-test-'));
  report = await runProof({ proofDir: tmpProofDir, port: 0 });
});

test('adapter proof: zero failures', () => {
  assert.equal(report.summary.failed, 0);
});

test('adapter proof: at least 28 checks pass', () => {
  assert.ok(report.summary.passed >= 28, `expected >= 28 passed, got ${report.summary.passed}`);
});

test('adapter proof: report.json written', () => {
  assert.ok(fs.existsSync(path.join(tmpProofDir, 'report.json')));
});

test('adapter proof: report.md written', () => {
  assert.ok(fs.existsSync(path.join(tmpProofDir, 'report.md')));
});

// Individual check validations
const requiredChecks = [
  'api.healthz',
  'api.auth.required',
  'api.intents.catalog',
  'api.intents.plan',
  'api.intents.plan.codegraph',
  'api.capture_feedback',
  'api.capture_feedback.clarification',
  'api.capture_feedback.rubric_gate',
  'api.context.construct',
  'api.context.evaluate',
  'mcp.initialize',
  'mcp.stdio.framed.initialize',
  'mcp.stdio.ndjson.initialize',
  'mcp.cli.serve.bad_home.initialize',
  'mcp.tools.list',
  'mcp.tools.call.feedback_summary',
  'mcp.tools.call.diagnose_failure',
  'mcp.tools.call.plan_intent',
  'mcp.tools.call.plan_intent.codegraph',
  'mcp.tools.call.recall.codegraph',
  'mcp.tools.call.capture_feedback.clarification',
  'mcp.tools.call.capture_feedback.rubric_gate',
  'mcp.policy.locked_profile_denies_write_tool',
  'adapter.chatgpt.openapi.parity',
  'adapter.gemini.declarations',
  'adapter.files.present',
  'subagent.profiles.valid',
  'mcp.policy.profile_differentiation',
];

for (const checkName of requiredChecks) {
  test(`adapter proof: individual check "${checkName}" passes`, () => {
    const found = getCheck(checkName);
    assert.equal(found.passed, true, `check "${checkName}" failed: ${JSON.stringify(found.details)}`);
  });
}

test('adapter proof: no unexpected failing checks', () => {
  assert.ok(report.checks.length > 0, 'proof report should include checks');
  const failed = report.checks.filter((c) => !c.passed);
  assert.equal(failed.length, 0, `unexpected failures: ${failed.map((c) => c.name).join(', ')}`);
});

test('adapter proof: API healthz returns status 200', () => {
  const check = getCheck('api.healthz');
  assert.equal(check.details.status, 200);
});

test('adapter proof: auth required returns 401', () => {
  const check = getCheck('api.auth.required');
  assert.equal(check.details.status, 401);
});

test('adapter proof: rubric gate returns accepted=false', () => {
  const check = getCheck('api.capture_feedback.rubric_gate');
  assert.equal(check.details.accepted, false);
});

test('adapter proof: vague API feedback requires clarification', () => {
  const check = getCheck('api.capture_feedback.clarification');
  assert.equal(check.details.status, 'clarification_required');
});

test('adapter proof: vague MCP feedback requires clarification', () => {
  const check = getCheck('mcp.tools.call.capture_feedback.clarification');
  assert.equal(check.details.status, 'clarification_required');
});

test('adapter proof: MCP diagnose_failure returns compiled constraints', () => {
  const check = getCheck('mcp.tools.call.diagnose_failure');
  assert.equal(check.details.rootCauseCategory, 'intent_plan_misalignment');
  assert.ok(check.details.toolSchemaCount >= 1);
});

test('adapter proof: API intent plan includes codegraph evidence', () => {
  const check = getCheck('api.intents.plan.codegraph');
  assert.equal(check.details.source, 'stub');
  assert.ok(check.details.impactScore > 0);
});

test('adapter proof: MCP intent plan includes codegraph evidence', () => {
  const check = getCheck('mcp.tools.call.plan_intent.codegraph');
  assert.ok(check.details.impactScore > 0);
});

test('adapter proof: MCP recall includes codegraph evidence', () => {
  const check = getCheck('mcp.tools.call.recall.codegraph');
  assert.ok(check.details.contentLength > 0);
});

test('adapter proof: gemini has >= 3 tools', () => {
  const check = getCheck('adapter.gemini.declarations');
  assert.ok(check.details.tools >= 3);
});

test('adapter proof: default profile has more tools than locked', () => {
  const check = getCheck('mcp.policy.profile_differentiation');
  assert.ok(check.details.defaultTools > check.details.lockedTools);
});

test('adapter proof: cleanup', () => {
  try {
    fs.rmSync(tmpProofDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (err) {}
});
