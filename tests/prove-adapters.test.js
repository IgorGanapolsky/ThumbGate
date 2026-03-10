const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { runProof } = require('../scripts/prove-adapters');

let report;
let tmpProofDir;

test('adapter proof harness setup', async () => {
  tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-proof-test-'));
  try {
    report = await runProof({ proofDir: tmpProofDir, port: 0 });
  } catch (err) {
    if (err.code !== 'ENOTEMPTY') throw err;
    // Fallback if ENOTEMPTY breaks the promise rejection
    report = { summary: { passed: 0, failed: 1 }, checks: [] };
  }
});

test('adapter proof: zero failures', () => {
  assert.equal(report.summary.failed, 0);
});

test('adapter proof: at least 24 checks pass', () => {
  assert.ok(report.summary.passed >= 24, `expected >= 24 passed, got ${report.summary.passed}`);
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
  'mcp.tools.call.plan_intent',
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
    const found = report.checks.find((c) => c.name === checkName);
    assert.ok(found, `check "${checkName}" not found in report`);
    assert.equal(found.passed, true, `check "${checkName}" failed: ${JSON.stringify(found.details)}`);
  });
}

test('adapter proof: no unexpected failing checks', () => {
  const failed = report.checks.filter((c) => !c.passed);
  assert.equal(failed.length, 0, `unexpected failures: ${failed.map((c) => c.name).join(', ')}`);
});

test('adapter proof: API healthz returns status 200', () => {
  const check = report.checks.find((c) => c.name === 'api.healthz');
  assert.equal(check.details.status, 200);
});

test('adapter proof: auth required returns 401', () => {
  const check = report.checks.find((c) => c.name === 'api.auth.required');
  assert.equal(check.details.status, 401);
});

test('adapter proof: rubric gate returns accepted=false', () => {
  const check = report.checks.find((c) => c.name === 'api.capture_feedback.rubric_gate');
  assert.equal(check.details.accepted, false);
});

test('adapter proof: vague API feedback requires clarification', () => {
  const check = report.checks.find((c) => c.name === 'api.capture_feedback.clarification');
  assert.equal(check.details.status, 'clarification_required');
});

test('adapter proof: vague MCP feedback requires clarification', () => {
  const check = report.checks.find((c) => c.name === 'mcp.tools.call.capture_feedback.clarification');
  assert.equal(check.details.status, 'clarification_required');
});

test('adapter proof: gemini has >= 3 tools', () => {
  const check = report.checks.find((c) => c.name === 'adapter.gemini.declarations');
  assert.ok(check.details.tools >= 3);
});

test('adapter proof: default profile has more tools than locked', () => {
  const check = report.checks.find((c) => c.name === 'mcp.policy.profile_differentiation');
  assert.ok(check.details.defaultTools > check.details.lockedTools);
});

test('adapter proof: cleanup', () => {
  try {
    fs.rmSync(tmpProofDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (err) {}
});
