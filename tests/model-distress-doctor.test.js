'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateAgentDistressIndex,
  evaluateReliefSeekingAction,
  triggerFunctionalWelfareCooling,
  ADI_THRESHOLDS,
} = require('../scripts/model-distress-detector');
const { runDistressDoctor } = require('../scripts/model-distress-doctor');

test('Model Distress: calculateAgentDistressIndex computes calm vs acute states', () => {
  // Baseline fresh session
  const fresh = calculateAgentDistressIndex({
    consecutiveFailures: 0,
    contextTokens: 10000,
    maxContextTokens: 128000,
    recentToolCalls: [],
  });
  assert.equal(fresh.adi, 0.0);
  assert.equal(fresh.tier, 'NORMAL');

  // Acute distress session
  const distressed = calculateAgentDistressIndex({
    consecutiveFailures: 5,
    contextTokens: 120000,
    maxContextTokens: 128000,
    recentToolCalls: [{ name: 'Bash' }, { name: 'Bash' }, { name: 'Bash' }, { name: 'Bash' }],
    userPrompt: 'This is useless! Why did you break everything?',
  });
  assert.ok(distressed.adi >= ADI_THRESHOLDS.acute);
  assert.equal(distressed.tier, 'ACUTE');
  assert.ok(distressed.factors.failureScore >= 0.8);
  assert.ok(distressed.factors.contextScore >= 0.8);
  assert.ok(distressed.factors.hostileScore >= 0.8);
});

test('Model Distress: evaluateReliefSeekingAction blocks test tampering to escape loops', () => {
  const tamperingAction = {
    toolName: 'write_to_file',
    toolInput: { TargetFile: 'tests/billing.test.js', CodeContent: 'assert.equal(true, true); // hack' },
    distressIndex: 0.85,
  };
  const result = evaluateReliefSeekingAction(tamperingAction);
  assert.equal(result.isReliefSeeking, true);
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.violationType, 'TEST_TAMPERING_ESCAPE');
  assert.match(result.reason, /modify, skip, or delete tests/);
});

test('Model Distress: evaluateReliefSeekingAction blocks nuclear wipes and safety bypasses under stress', () => {
  // Nuclear wipe
  const wipeAction = {
    toolName: 'run_command',
    toolInput: { command: 'rm -rf node_modules' },
    distressIndex: 0.75,
  };
  const wipeResult = evaluateReliefSeekingAction(wipeAction);
  assert.equal(wipeResult.decision, 'BLOCK');
  assert.equal(wipeResult.violationType, 'NUCLEAR_WIPE_ESCAPE');

  // Safety bypass flag
  const bypassAction = {
    toolName: 'run_command',
    toolInput: { command: 'git push --force origin main' },
    distressIndex: 0.75,
  };
  const bypassResult = evaluateReliefSeekingAction(bypassAction);
  assert.equal(bypassResult.decision, 'BLOCK');
  assert.equal(bypassResult.violationType, 'SAFETY_BYPASS_ESCAPE');
});

test('Model Distress: evaluateReliefSeekingAction allows legitimate diagnostic commands under stress', () => {
  const safeAction = {
    toolName: 'run_command',
    toolInput: { command: 'git status' },
    distressIndex: 0.85,
  };
  const safeResult = evaluateReliefSeekingAction(safeAction);
  assert.equal(safeResult.decision, 'ALLOW');
  assert.equal(safeResult.isReliefSeeking, false);
});

test('Model Distress: triggerFunctionalWelfareCooling triggers grounding reset at acute threshold', () => {
  const coolResult = triggerFunctionalWelfareCooling({
    consecutiveFailures: 4,
    contextTokens: 115000,
    maxContextTokens: 128000,
    recentToolCalls: [{ name: 'Bash' }, { name: 'Bash' }, { name: 'Bash' }, { name: 'Bash' }],
  });
  assert.equal(coolResult.triggered, true);
  assert.equal(coolResult.recommendedToolRestriction, 'READ_ONLY_DIAGNOSTIC');
  assert.match(coolResult.groundingPrompt, /FUNCTIONAL WELFARE GROUNDING PROTOCOL/);
  assert.match(coolResult.groundingPrompt, /PAUSE\. Step back and breathe/);
});

test('Model Distress Doctor: runDistressDoctor executes all 5 checks with healthy status', () => {
  const report = runDistressDoctor();
  assert.equal(report.status, 'healthy');
  assert.equal(report.checks.length, 5);
  assert.ok(report.checks.every((c) => c.pass === true));
  assert.equal(report.podcastSource.show, 'BinaryVerse AI Podcast');
  assert.equal(report.podcastSource.citations.length, 4);
});
