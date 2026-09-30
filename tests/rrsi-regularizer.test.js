'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RRSI_DEFAULTS,
  calculateAnnealedBudget,
  calculateAnnealedStepMultiplier,
  screenLeakage,
  computeComplexityDelta,
  evaluateComplexityRegularizedScore,
  detectStagnation,
  selectTargetWithExploration,
  pruneStructuralRedundancy,
} = require('../scripts/rrsi-regularizer');

test('RRSI Regularizer: Cosine-Annealed Cardinality Budget', () => {
  // At iteration 0 (t = 0), budget should be maxBudget (3)
  assert.equal(calculateAnnealedBudget(0, 10), 3);
  assert.equal(calculateAnnealedBudget(0, 1), 3);

  // At midpoint iteration (t = T / 2), budget should be mid
  // floor(1 + (3 - 1) * 0.5 * (1 + cos(pi/2))) = floor(1 + 2 * 0.5 * 1) = 2
  assert.equal(calculateAnnealedBudget(5, 10), 2);

  // At terminal iteration (t = T), budget should be minBudget (1)
  assert.equal(calculateAnnealedBudget(10, 10), 1);
  assert.equal(calculateAnnealedBudget(15, 10), 1);

  // Custom bounds
  assert.equal(calculateAnnealedBudget(0, 20, { minBudget: 2, maxBudget: 6 }), 6);
  assert.equal(calculateAnnealedBudget(20, 20, { minBudget: 2, maxBudget: 6 }), 2);
});

test('RRSI Regularizer: Cosine-Annealed Step Multiplier', () => {
  // At iteration 0, multiplier is maxMultiplier (1.0)
  assert.equal(calculateAnnealedStepMultiplier(0, 10), 1.0);

  // At terminal iteration, multiplier is minMultiplier (0.25)
  assert.equal(calculateAnnealedStepMultiplier(10, 10), 0.25);
  assert.equal(calculateAnnealedStepMultiplier(12, 10), 0.25);

  // Monotonically decreasing
  const m0 = calculateAnnealedStepMultiplier(0, 10);
  const m3 = calculateAnnealedStepMultiplier(3, 10);
  const m7 = calculateAnnealedStepMultiplier(7, 10);
  const m10 = calculateAnnealedStepMultiplier(10, 10);

  assert.ok(m0 >= m3, `m0 (${m0}) should be >= m3 (${m3})`);
  assert.ok(m3 >= m7, `m3 (${m3}) should be >= m7 (${m7})`);
  assert.ok(m7 >= m10, `m7 (${m7}) should be >= m10 (${m10})`);
});

test('RRSI Regularizer: Leakage Critic rejects benchmark & test fixture hardcoding', () => {
  // Clean mutations pass
  const clean1 = screenLeakage({ settingKey: 'half_life_days', nextValue: 7 });
  assert.equal(clean1.passed, true);
  assert.equal(clean1.leaks.length, 0);
  assert.equal(clean1.reason, null);

  const clean2 = screenLeakage('Optimize prompt for concise instruction following');
  assert.equal(clean2.passed, true);

  // Benchmark dataset leakage
  const bench1 = screenLeakage('Special case fix for SWE-bench issue 2042');
  assert.equal(bench1.passed, false);
  assert.ok(bench1.leaks.includes('benchmark_dataset'));
  assert.match(bench1.reason, /Leakage Critic rejected candidate/);

  const bench2 = screenLeakage('Tune prompt using HumanEval golden prompts');
  assert.equal(bench2.passed, false);
  assert.ok(bench2.leaks.includes('benchmark_dataset'));

  // Test fixture hardcoding
  const fixture1 = screenLeakage('Read from tests/fixtures/eval-data.json directly');
  assert.equal(fixture1.passed, false);
  assert.ok(fixture1.leaks.includes('test_fixture_hardcode'));

  // Temporary path / session leakage
  const temp1 = screenLeakage('Write output to /tmp/temp-hack-file.txt');
  assert.equal(temp1.passed, false);
  assert.ok(temp1.leaks.includes('temp_filesystem_leak'));

  // Golden cheat token
  const cheat1 = screenLeakage('Inject expected_golden_answer into context');
  assert.equal(cheat1.passed, false);
  assert.ok(cheat1.leaks.includes('golden_cheat_token'));
});

test('RRSI Regularizer: Complexity Delta Computation', () => {
  // Numeric parameter normalized displacement
  const numDelta = computeComplexityDelta(10, 5, { range: [0, 20] });
  assert.equal(numDelta, 0.25); // |10 - 5| / 20 = 0.25

  // String / prompt token growth
  const strDelta = computeComplexityDelta(
    'A'.repeat(150),
    'A'.repeat(100)
  );
  assert.equal(strDelta, 0.5); // (150 - 100) / 100 = 0.5

  // Shorter string should have 0 complexity delta (no penalty for pruning)
  const shrinkDelta = computeComplexityDelta('A'.repeat(50), 'A'.repeat(100));
  assert.equal(shrinkDelta, 0);
});

test('RRSI Regularizer: Complexity-Aware Regularized Scoring', () => {
  // Case 1: Genuine improvement with small complexity delta -> ACCEPTED
  const res1 = evaluateComplexityRegularizedScore({
    baselineScore: 0.80,
    candidateScore: 0.85,
    testsPassed: true,
    complexityDelta: 0.2,
  }, { lambda: 0.05, stabilityFloor: 0.002 });

  // rawDelta = 0.05, penalty = 0.05 * 0.2 = 0.01, regDelta = 0.04 > 0.002
  assert.equal(res1.accepted, true);
  assert.equal(res1.rawDelta, 0.05);
  assert.equal(res1.regularizedDelta, 0.04);
  assert.equal(res1.penalty, 0.01);

  // Case 2: Trivial raw gain (+0.001) that fails stability floor -> REJECTED
  const res2 = evaluateComplexityRegularizedScore({
    baselineScore: 0.80,
    candidateScore: 0.801,
    testsPassed: true,
    complexityDelta: 0,
  }, { lambda: 0.05, stabilityFloor: 0.002 });

  assert.equal(res2.accepted, false);
  assert.match(res2.reason, /below stability floor/);

  // Case 3: Apparent gain (+0.02) drowned by massive complexity growth (complexityDelta = 1.0) -> REJECTED
  // rawDelta = 0.02, penalty = 0.05 * 1.0 = 0.05, regDelta = -0.03
  const res3 = evaluateComplexityRegularizedScore({
    baselineScore: 0.80,
    candidateScore: 0.82,
    testsPassed: true,
    complexityDelta: 1.0,
  }, { lambda: 0.05, stabilityFloor: 0.002 });

  assert.equal(res3.accepted, false);
  assert.equal(res3.regularizedDelta, -0.03);
  assert.match(res3.reason, /penalized by complexity/);

  // Case 4: Tests failed -> REJECTED regardless of score
  const res4 = evaluateComplexityRegularizedScore({
    baselineScore: 0.80,
    candidateScore: 0.99,
    testsPassed: false,
    complexityDelta: 0,
  });

  assert.equal(res4.accepted, false);
  assert.match(res4.reason, /failed test execution/);
});

test('RRSI Regularizer: Stagnation Detection', () => {
  // Insufficient history
  const insufficient = detectStagnation([{ delta: 0 }], { windowSize: 3 });
  assert.equal(insufficient.isStagnant, false);

  // Stagnant history: all flat variations <= threshold (0.001)
  const stagnantHistory = [
    { delta: 0.0005, kept: false },
    { delta: -0.0002, kept: false },
    { delta: 0.0001, kept: false },
  ];
  const stagnantResult = detectStagnation(stagnantHistory, { windowSize: 3, threshold: 0.001 });
  assert.equal(stagnantResult.isStagnant, true);
  assert.match(stagnantResult.reason, /Stagnation detected/);

  // Active progress: variations exceed threshold
  const healthyHistory = [
    { delta: 0.0005, kept: false },
    { delta: 0.05, kept: true },
    { delta: 0.02, kept: true },
  ];
  const healthyResult = detectStagnation(healthyHistory, { windowSize: 3, threshold: 0.001 });
  assert.equal(healthyResult.isStagnant, false);
});

test('RRSI Regularizer: Structured Exploration vs Exploitation', () => {
  const targets = [
    { name: 'target_A' },
    { name: 'target_B' },
    { name: 'target_C' },
  ];

  const history = [
    { targetName: 'target_A', kept: true },
    { targetName: 'target_A', kept: true },
    { targetName: 'target_B', kept: false },
  ];

  // When not stagnant, exploitation selects top-performing target (target_A)
  const exploit = selectTargetWithExploration({
    targets,
    history,
    isStagnant: false,
  });
  assert.equal(exploit.strategy, 'exploitation');
  assert.equal(exploit.target.name, 'target_A');

  // When stagnant, entropy exploration forces selection of least-exercised target (target_C with 0 visits)
  const explore = selectTargetWithExploration({
    targets,
    history,
    isStagnant: true,
  });
  assert.equal(explore.strategy, 'entropy_exploration');
  assert.equal(explore.target.name, 'target_C');
});

test('RRSI Regularizer: Structural Pruner removes duplicates and subsumed rules', () => {
  const rules = [
    'Always verify test status before merge',
    'Always verify test status before merge', // duplicate
    '   ALWAYS verify test status before merge   ', // case/whitespace duplicate
    'Never commit secrets or tokens to source control repository',
    'Never commit secrets or tokens to source control repository when pushing commits', // subsumed
    'Check branch protection status',
  ];

  const pruned = pruneStructuralRedundancy(rules);
  assert.equal(pruned.prunedRules.length, 3);
  assert.equal(pruned.reductionCount, 3);
  assert.equal(pruned.prunedRules[0], 'Always verify test status before merge');
  assert.equal(pruned.prunedRules[1], 'Never commit secrets or tokens to source control repository');
  assert.equal(pruned.prunedRules[2], 'Check branch protection status');
});

test('RRSI Workspace Evolution Integration: Leakage Critic blocks cheat hypotheses', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-rrsi-leak-test-'));
  const origFeedback = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  try {
    const { runWorkspaceEvolution } = require('../scripts/workspace-evolver');

    // Attempt evolution with benchmark cheat string in hypothesisSuffix
    const result = runWorkspaceEvolution({
      targetName: 'half_life_days',
      nextValue: 8,
      hypothesisSuffix: 'Hacked for SWE-bench test pass',
      feedbackDir: tmpDir,
    });

    assert.equal(result.skipped, true);
    assert.match(result.reason, /\[RRSI Leakage Critic\]/);
    assert.ok(result.leakageCheck.leaks.includes('benchmark_dataset'));
  } finally {
    if (origFeedback === undefined) {
      delete process.env.THUMBGATE_FEEDBACK_DIR;
    } else {
      process.env.THUMBGATE_FEEDBACK_DIR = origFeedback;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('RRSI Workspace Evolution Integration: Complexity Penalty rejects marginal bloat', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-rrsi-penalty-test-'));
  const origFeedback = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  try {
    const { runWorkspaceEvolution } = require('../scripts/workspace-evolver');

    // Run with high lambda penalty (e.g. lambda = 10.0) so small score improvement is rejected
    // Helper state command that passes on value 8
    const script = [
      'const { readEvolutionState } = require("./scripts/evolution-state");',
      'const passed = readEvolutionState().settings.half_life_days === 8;',
      'console.log("ℹ tests 10");',
      'console.log("ℹ pass " + (passed ? 6 : 5));', // baseline gets 5/10 (0.5), candidate gets 6/10 (0.6)
      'console.log("ℹ fail " + (passed ? 4 : 5));',
    ].join(' ');
    const testCmd = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;

    // Raw score gain: (0.6 - 0.5) * 0.9 = ~0.09.
    // Normalized displacement: |8 - 7| / (14 - 3) = 1/11 = ~0.0909.
    // With lambda = 5.0, penalty = 5.0 * 0.0909 = 0.45 > 0.09, regularized delta is negative!
    const result = runWorkspaceEvolution({
      targetName: 'half_life_days',
      nextValue: 8,
      primaryCommands: [testCmd],
      feedbackDir: tmpDir,
      lambda: 5.0,
      stabilityFloor: 0.01,
    });

    assert.equal(result.kept, false);
    assert.ok(result.rrsiDecision);
    assert.equal(result.rrsiDecision.accepted, false);
    assert.match(result.reason, /penalized by complexity/);
  } finally {
    if (origFeedback === undefined) {
      delete process.env.THUMBGATE_FEEDBACK_DIR;
    } else {
      process.env.THUMBGATE_FEEDBACK_DIR = origFeedback;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('RRSI Doctor: audits all 6 regularization pillars and returns PASS', () => {
  const { auditRRSI, RAIL_MAP } = require('../scripts/rrsi-doctor');
  assert.ok(Array.isArray(RAIL_MAP));
  assert.ok(RAIL_MAP.length >= 6);

  const report = auditRRSI();
  assert.equal(report.status, 'PASS');
  assert.ok(report.checks.length >= 6);
  assert.ok(report.checks.every((c) => c.passed));
  assert.match(report.summary, /RRSI regularizers active & healthy/);
  assert.match(report.paperCitation, /arXiv:2609\.24972/);
});

test('RRSI Doctor: CLI invocation support (--json, --map-only, --map-only --json, default)', () => {
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  const doctorScript = path.resolve(__dirname, '../scripts/rrsi-doctor.js');

  // 1. --json mode
  const jsonOut = execFileSync(process.execPath, [doctorScript, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(jsonOut);
  assert.equal(parsed.status, 'PASS');
  assert.ok(parsed.checks.length >= 6);

  // 2. --map-only text mode
  const mapText = execFileSync(process.execPath, [doctorScript, '--map-only'], { encoding: 'utf8' });
  assert.match(mapText, /RRSI Architectural Rail Map/);
  assert.match(mapText, /Cosine-Annealed Update Sparsity/);

  // 3. --map-only --json mode
  const mapJson = execFileSync(process.execPath, [doctorScript, '--map-only', '--json'], { encoding: 'utf8' });
  const parsedMap = JSON.parse(mapJson);
  assert.ok(Array.isArray(parsedMap));
  assert.ok(parsedMap.length >= 6);

  // 4. default human-readable mode
  const defaultText = execFileSync(process.execPath, [doctorScript], { encoding: 'utf8' });
  assert.match(defaultText, /RRSI HARNESS REGULARIZATION DOCTOR/);
  assert.match(defaultText, /All RRSI regularizers fail closed\./);
});

test('RRSI Workspace Evolution: coverage for target recommendation, no-op mutation, and standard mode', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const { recommendEvolutionTarget, runWorkspaceEvolution } = require('../scripts/workspace-evolver');

  // Target recommendations
  assert.equal(recommendEvolutionTarget({ failureType: 'verification', tags: ['security'] }), 'prevention_min_occurrences');
  assert.equal(recommendEvolutionTarget({ failureType: 'verification', tags: ['billing'] }), 'prevention_min_occurrences');
  assert.equal(recommendEvolutionTarget({ failureType: 'verification', tags: ['other'] }), 'verification_max_retries');
  assert.equal(recommendEvolutionTarget({ failureType: 'execution', tags: ['testing'] }), 'verification_max_retries');
  assert.equal(recommendEvolutionTarget({ failureType: 'execution', tags: [] }), 'half_life_days');
  assert.equal(recommendEvolutionTarget({}), 'half_life_days');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-rrsi-noop-test-'));
  try {
    // No-op mutation test: nextValue equals currentValue (7 is default half_life_days)
    const noopResult = runWorkspaceEvolution({
      targetName: 'half_life_days',
      nextValue: 7,
      feedbackDir: tmpDir,
    });
    assert.equal(noopResult.skipped, true);
    assert.match(noopResult.reason, /no-op mutation/);

    // Evolution in standard mode (enableRRSI: false) with mock command
    const testCmd = `${JSON.stringify(process.execPath)} -e "console.log('ℹ tests 1\\nℹ pass 1')"`;
    const standardResult = runWorkspaceEvolution({
      targetName: 'half_life_days',
      nextValue: 8,
      enableRRSI: false,
      primaryCommands: [testCmd],
      feedbackDir: tmpDir,
    });
    assert.ok(standardResult);
    assert.equal(standardResult.metrics.rrsi.enabled, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


