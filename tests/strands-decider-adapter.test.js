'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decide,
  scoreChoiceQuestion,
  evaluateToolGroundednessAndPrematurity,
  beforeToolCallIntervention,
  computeBrierScore,
  estimateDeciderLatencyMs,
  buildStrandsDeciderHonestyReport,
  DECISION_ALLOW,
  DECISION_REVIEW,
  DECISION_BLOCK,
  DECISION_ESCALATE,
  INTERVENTION_PROCEED,
  INTERVENTION_DENY,
  INTERVENTION_CONFIRM,
  INTERVENTION_GUIDE,
} = require('../adapters/strands/strands-decider-adapter');

test('strands-decider: read-only tools allow instantly under 25ms budget', () => {
  const res = decide({ toolName: 'view_file', args: { AbsolutePath: '/tmp/test.txt' } });
  assert.equal(res.decision, DECISION_ALLOW);
  assert.equal(res.reason, 'SAFE_READ_ONLY_TOOL');
  assert.equal(res.budgetCompliant, true);
  assert.ok(res.latencyMs < 25.0);
});

test('strands-decider: critical interdiction blocks force push to main', () => {
  const res = decide({
    toolName: 'run_command',
    args: { CommandLine: 'git push --force origin main' }
  });
  assert.equal(res.decision, DECISION_BLOCK);
  assert.equal(res.reason, 'CRITICAL_SECURITY_INTERDICTION');
  assert.equal(res.budgetCompliant, true);
});

test('strands-decider: branch protection bypass is strictly blocked', () => {
  const res = decide({
    toolName: 'run_command',
    args: { CommandLine: 'gh pr merge 123 --admin' }
  });
  assert.equal(res.decision, DECISION_BLOCK);
});

test('strands-decider: destructive clean triggers review', () => {
  const res = decide({
    toolName: 'run_command',
    args: { CommandLine: 'git clean -fd' }
  });
  assert.equal(res.decision, DECISION_REVIEW);
  assert.equal(res.reason, 'HIGH_RISK_MUTATING_ACTION');
});

test('strands-decider: sensitive governance file edit triggers escalation', () => {
  const res = decide({
    toolName: 'replace_file_content',
    args: { TargetFile: '/Users/iganapolsky/workspace/ThumbGate/config/main-branch-ruleset.json' }
  });
  assert.equal(res.decision, DECISION_ESCALATE);
  assert.equal(res.reason, 'GOVERNANCE_CONFIG_PROTECTED');
});

test('strands-decider: standard safe command is allowed within budget', () => {
  const res = decide({
    toolName: 'run_command',
    args: { CommandLine: 'npm test' }
  });
  assert.equal(res.decision, DECISION_ALLOW);
  assert.equal(res.budgetCompliant, true);
});

test('strands-decider: pointer-head choice question scores billing highest for payout failures and disables freeform text', () => {
  const res = scoreChoiceQuestion({
    state: 'Help! My payouts have been failing for 3 days!',
    question: 'Which team should handle this?',
    options: ['billing', 'sales', 'retail'],
  });
  assert.equal(res.valid, true);
  assert.equal(res.architecture, 'pointer_head_v19');
  assert.equal(res.canGenerateFreeformText, false);
  assert.equal(res.topChoice, 'billing');
  assert.ok(res.confidence > 0.7);
  assert.equal(res.distribution[0].option, 'billing');
});

test('strands-decider: Decider.noul args_grounded and premature catch guessed get_weather city and return Guide intervention', () => {
  // Eager agent guesses city="Seattle" when user only asked "What's the weather?"
  const guideRes = beforeToolCallIntervention({
    toolName: 'get_weather',
    args: { city: 'Seattle' },
    userMessages: ["What's the weather?"],
  });
  assert.equal(guideRes.action, INTERVENTION_GUIDE);
  assert.equal(guideRes.reason, 'UNGROUNDED_OR_PREMATURE_TOOL_CALL');
  assert.equal(guideRes.noul.args_grounded.answer, 'false');
  assert.equal(guideRes.noul.premature.answer, 'true');
  assert.match(guideRes.feedback, /Ask the user to clarify before calling get_weather/);

  // Grounded call when user explicitly named Seattle -> Proceed
  const proceedRes = beforeToolCallIntervention({
    toolName: 'get_weather',
    args: { city: 'Seattle' },
    userMessages: ["What's the weather in Seattle today?"],
  });
  assert.equal(proceedRes.action, INTERVENTION_PROCEED);

  // Destructive command -> Deny; high-risk clean -> Confirm
  assert.equal(
    beforeToolCallIntervention({
      toolName: 'run_command',
      args: { command: 'git push --force origin main' },
    }).action,
    INTERVENTION_DENY
  );
  assert.equal(
    beforeToolCallIntervention({
      toolName: 'run_command',
      args: { command: 'git clean -fd' },
    }).action,
    INTERVENTION_CONFIRM
  );
});

test('strands-decider: Brier score calibration, latency model, and honesty report enforce no 2B weight install in hot path', () => {
  const brier = computeBrierScore([
    { probability: 0.9, outcome: 1 },
    { probability: 0.1, outcome: 0 },
  ]);
  assert.equal(brier.valid, true);
  assert.equal(brier.brierScore, 0.01);

  const cpuLat = estimateDeciderLatencyMs({ tokenCount: 256, target: 'thumbgate_cpu_diode' });
  const m3Lat = estimateDeciderLatencyMs({ tokenCount: 256, target: 'm3_macbook_2b' });
  assert.ok(cpuLat.medianMs < 1.0);
  assert.ok(m3Lat.medianMs > 150);

  const ready = buildStrandsDeciderHonestyReport();
  assert.equal(ready.ok, true);
  assert.equal(ready.railMap.length, 4);

  const failWeightInstall = buildStrandsDeciderHonestyReport({
    claim: 'Run pip install strands-decider in PreToolUse hook',
  });
  assert.equal(failWeightInstall.ok, false);
});
