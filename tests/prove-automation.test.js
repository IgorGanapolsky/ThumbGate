const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { runAutomationProof } = require('../scripts/prove-automation');

let report;
let tmpProofDir;

function getCheck(name) {
  assert.ok(report, 'automation proof report missing');
  const fatal = report.checks.find((check) => check.name === 'fatal');
  assert.equal(fatal, undefined, fatal ? `automation proof fatal: ${JSON.stringify(fatal.details)}` : 'automation fatal check present');
  const found = report.checks.find((check) => check.name === name);
  assert.ok(
    found,
    `check "${name}" not found in report; available: ${report.checks.map((check) => check.name).join(', ')}`,
  );
  return found;
}

test('automation proof harness setup', async () => {
  tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-automation-proof-test-'));
  report = await runAutomationProof({ proofDir: tmpProofDir, port: 0 });
});

test('automation proof: zero failures', () => {
  assert.equal(report.summary.failed, 0);
});

test('automation proof: at least 22 checks pass', () => {
  assert.ok(report.summary.passed >= 22, `expected >= 22 passed, got ${report.summary.passed}`);
});

test('automation proof: report.json written', () => {
  assert.ok(fs.existsSync(path.join(tmpProofDir, 'report.json')));
});

test('automation proof: report.md written', () => {
  assert.ok(fs.existsSync(path.join(tmpProofDir, 'report.md')));
});

// Individual check validations
const requiredChecks = [
  'feedback.capture.rubric_pass',
  'feedback.capture.rubric_block',
  'feedback.capture.negative_with_rubric',
  'analytics.rubric_tracking',
  'verification.failure_diagnostics',
  'prevention_rules.rubric_dimensions',
  'dpo_export.rubric_metadata',
  'api.rubric_gate',
  'mcp.rubric_gate',
  'secret_guard.read_block',
  'secret_guard.prompt_block',
  'mcp.failure_diagnostics',
  'intent.checkpoint_enforcement',
  'intent.partner_strategy',
  'intent.delegation_decision',
  'intent.codegraph_impact',
  'handoff.contract_shape',
  'handoff.sequential_guard',
  'handoff.failure_diagnostics',
  'context.evaluate.rubric',
  'context.semantic_cache.hit',
  'self_healing.helpers',
  'code_reasoning.dpo_traces',
  'code_reasoning.proof_gate',
];

for (const checkName of requiredChecks) {
  test(`automation proof: individual check "${checkName}" passes`, () => {
    const found = getCheck(checkName);
    assert.equal(found.passed, true, `check "${checkName}" failed: ${JSON.stringify(found.details)}`);
  });
}

test('automation proof: no unexpected failing checks', () => {
  assert.ok(report.checks.length > 0, 'automation proof report should include checks');
  const failed = report.checks.filter((c) => !c.passed);
  assert.equal(failed.length, 0, `unexpected failures: ${failed.map((c) => c.name).join(', ')}`);
});

test('automation proof: rubric pass has weighted score', () => {
  const check = getCheck('feedback.capture.rubric_pass');
  assert.ok(typeof check.details.weightedScore === 'number');
  assert.ok(check.details.weightedScore > 0);
});

test('automation proof: rubric block has rejection reason', () => {
  const check = getCheck('feedback.capture.rubric_block');
  assert.equal(check.details.accepted, false);
  assert.ok(check.details.reason);
});

test('automation proof: negative with rubric has failure tags', () => {
  const check = getCheck('feedback.capture.negative_with_rubric');
  assert.ok(Array.isArray(check.details.tags));
  assert.ok(check.details.tags.some((t) => t.startsWith('rubric-')));
});

test('automation proof: analytics tracks rubric samples >= 3', () => {
  const check = getCheck('analytics.rubric_tracking');
  assert.ok(check.details.samples >= 3);
});

test('automation proof: failed verification includes diagnosis', () => {
  const check = getCheck('verification.failure_diagnostics');
  assert.equal(check.details.rootCauseCategory, 'tool_output_misread');
  assert.equal(check.details.criticalFailureStep, 'verification');
});

test('automation proof: DPO rubric metadata present', () => {
  const check = getCheck('dpo_export.rubric_metadata');
  assert.ok(check.details);
});

test('automation proof: API rubric gate returns 422', () => {
  const check = getCheck('api.rubric_gate');
  assert.equal(check.details.status, 422);
});

test('automation proof: MCP rubric gate rejects', () => {
  const check = getCheck('mcp.rubric_gate');
  assert.equal(check.details.accepted, false);
});

test('automation proof: secret guard blocks file reads', () => {
  const check = getCheck('secret_guard.read_block');
  assert.equal(check.details.decision, 'deny');
  assert.match(check.details.reason, /secret material/i);
});

test('automation proof: prompt guard blocks secret-bearing prompts', () => {
  const check = getCheck('secret_guard.prompt_block');
  assert.equal(check.details.continue, false);
  assert.match(check.details.stopReason, /secret material/i);
});

test('automation proof: MCP failure diagnostics compiles constraints', () => {
  const check = getCheck('mcp.failure_diagnostics');
  assert.equal(check.details.rootCauseCategory, 'intent_plan_misalignment');
  assert.ok(check.details.toolSchemaCount >= 1);
});

test('automation proof: intent checkpoint enforced', () => {
  const check = getCheck('intent.checkpoint_enforcement');
  assert.equal(check.details.blocked, 'checkpoint_required');
  assert.equal(check.details.approved, 'ready');
});

test('automation proof: partner strategy exposed in intent plan', () => {
  const check = getCheck('intent.partner_strategy');
  assert.equal(check.details.partnerProfile, 'strict_reviewer');
  assert.equal(check.details.verificationMode, 'evidence_first');
  assert.ok(check.details.contextPack > 6000);
});

test('automation proof: delegation decision exposes sequential execution', () => {
  const check = getCheck('intent.delegation_decision');
  assert.equal(check.details.executionMode, 'sequential_delegate');
  assert.equal(check.details.delegateProfile, 'pr_workflow');
  assert.ok(check.details.delegationScore >= 0.6);
});

test('automation proof: handoff contract contains evidence and checks', () => {
  const check = getCheck('handoff.contract_shape');
  assert.ok(Array.isArray(check.details.requiredEvidence));
  assert.ok(Array.isArray(check.details.requiredChecks));
});

test('automation proof: sequential guard blocks duplicate handoffs', () => {
  const check = getCheck('handoff.sequential_guard');
  assert.equal(check.details.statusCode, 409);
  assert.match(check.details.message, /unresolved handoff/i);
});

test('automation proof: handoff failure records diagnostics', () => {
  const check = getCheck('handoff.failure_diagnostics');
  assert.equal(check.details.verificationAccepted, false);
  assert.ok(check.details.rootCauseCategory);
});

test('automation proof: codegraph impact adds structural evidence', () => {
  const check = getCheck('intent.codegraph_impact');
  assert.equal(check.details.source, 'stub');
  assert.ok(check.details.impactScore > 0);
  assert.ok(check.details.deadCodeCount >= 1);
});

test('automation proof: semantic cache hit on equivalent query', () => {
  const check = getCheck('context.semantic_cache.hit');
  assert.equal(check.details.firstHit, false);
  assert.equal(check.details.secondHit, true);
});

test('automation proof: self-healing includes reasoning traces', () => {
  const check = getCheck('self_healing.helpers');
  assert.ok(check.details.reasoning, 'should include reasoning aggregate');
  assert.ok(check.details.reasoning.allPassed, 'all traces should pass');
});

test('automation proof: code reasoning DPO traces have confidence', () => {
  const check = getCheck('code_reasoning.dpo_traces');
  assert.ok(check.details);
});

test('automation proof: code reasoning proof gate passes', () => {
  const check = getCheck('code_reasoning.proof_gate');
  assert.ok(check.details.allPassed, 'all proof traces should pass');
  assert.ok(check.details.averageConfidence > 0);
});

test('automation proof: report includes reasoning aggregate', () => {
  assert.ok(report.reasoning, 'report should have reasoning field');
  assert.equal(report.reasoning.refuted, 0);
  assert.ok(report.reasoning.allPassed);
});

test('automation proof: report includes proof traces', () => {
  assert.ok(Array.isArray(report.proofTraces));
  assert.ok(report.proofTraces.length > 0);
  report.proofTraces.forEach((trace) => {
    assert.ok(trace.traceId);
    assert.ok(trace.summary);
  });
});

test('automation proof: cleanup', () => {
  fs.rmSync(tmpProofDir, { recursive: true, force: true });
});
