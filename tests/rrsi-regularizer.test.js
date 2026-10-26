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
  const origFeedback = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
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
    if (origFeedback === undefined) {
      delete process.env.THUMBGATE_FEEDBACK_DIR;
    } else {
      process.env.THUMBGATE_FEEDBACK_DIR = origFeedback;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('IBM Granite Switch 4.1 and HuggingFace ML Intern FORMAT steals: aLoRA KV-cache reuse, verified-facts pre-training gates, and checkpoint bleed selection', () => {
  const {
    evaluateGraniteSwitchAlora,
    buildGraniteSwitchHonestyReport,
    evaluateMlInternBriefAndBudget,
    selectOptimalCheckpointBeforeBleed,
    buildMlInternHonestyReport,
    executeTurnFlushAndStateCommit,
    evaluateAgentAwarePrefixRoute,
    normalizeWireProtocolAndEvalDeterminism,
    evaluateDynamicToolGistAndAbstentionGate,
    buildPyTorchCon2026HonestyReport,
  } = require('../scripts/rrsi-doctor');

  const alora = evaluateGraniteSwitchAlora({
    adapterType: 'alora',
    baseVramGb: 16,
    switchedModes: ['chat', 'guardian', 'decision', 'speech'],
  });
  assert.equal(alora.kvCacheReused, true);
  assert.equal(alora.prefillRecomputeCount, 0);
  assert.equal(alora.estimatedVramGb, 16);

  const stdLora = evaluateGraniteSwitchAlora({
    adapterType: 'lora',
    baseVramGb: 16,
    switchedModes: ['chat', 'guardian', 'decision'],
  });
  assert.equal(stdLora.kvCacheReused, false);
  assert.equal(stdLora.prefillRecomputeCount, 2);
  assert.equal(buildGraniteSwitchHonestyReport().ok, true);

  const blockedMlIntern = evaluateMlInternBriefAndBudget({
    promptText: 'Train a LoRA on Qwen3.5-2B.',
    zeroShotBaselineRecorded: false,
    smokeTestSteps: 50,
    smokeTestWeightsDeltaL2: 0,
    initialBudgetUsd: 0,
    approvedCapUsd: 12,
    estimatedJobCostUsd: 16,
  });
  assert.equal(blockedMlIntern.allowed, false);
  assert.ok(blockedMlIntern.blockers.includes('missing_pre_training_zero_shot_baseline'));
  assert.ok(blockedMlIntern.blockers.includes('smoke_test_weights_unchanged_or_missing'));
  assert.ok(blockedMlIntern.blockers.includes('spend_cap_missing_or_exceeded'));

  const allowedMlIntern = evaluateMlInternBriefAndBudget({
    promptText: '## Verified facts, do not re-derive\nTrainer supports transparent PNGs.',
    zeroShotBaselineRecorded: true,
    smokeTestSteps: 50,
    smokeTestWeightsDeltaL2: 0.042,
    initialBudgetUsd: 0,
    approvedCapUsd: 16,
    estimatedJobCostUsd: 7.6,
  });
  assert.equal(allowedMlIntern.allowed, true);
  assert.equal(allowedMlIntern.hasVerifiedFactsHeading, true);

  const cp = selectOptimalCheckpointBeforeBleed([
    { step: 100, onModel: false, unrelatedPromptBleed: false, score: 0.4 },
    { step: 200, onModel: true, unrelatedPromptBleed: false, score: 0.88 },
    { step: 500, onModel: true, unrelatedPromptBleed: true, score: 0.92 },
  ]);
  assert.equal(cp.selectedStep, 200);
  assert.equal(buildMlInternHonestyReport().ok, true);

  // PyTorchCon NA Oct 20, 2026: MemT-1.0 turn-flush, llm-d QoS, DeepInfer batch-invariant eval, and Flash abstention gate
  const memt = executeTurnFlushAndStateCommit({
    turns: [
      { toolName: 'Bash', summary: 'Checked git status' },
      { toolName: 'Read', summary: 'Read server.js' },
      { toolName: 'Edit', summary: 'Patched billing.js' },
      { toolName: 'Bash', summary: 'Ran node --test' },
    ],
    retainRecentRawTurns: 2,
  });
  assert.equal(memt.flushedRawTurnCount, 2);
  assert.equal(memt.activeRawTurnCount, 2);
  assert.equal(memt.kvReductionFactor, 66);

  const llmd = evaluateAgentAwarePrefixRoute({
    sessionId: 'sess_42',
    staticPrefixShare: 0.85,
    dynamicInjectedAtTail: true,
    workloadTier: 'interactive_cli',
  });
  assert.equal(llmd.prefixPreserved, true);
  assert.equal(llmd.priorityRank, 1);
  assert.equal(llmd.estimatedCacheHitRate, 0.96);

  const deepInfer = normalizeWireProtocolAndEvalDeterminism({
    protocol: 'Responses',
    isEvalRun: true,
    batchSize: 4,
    batchInvariantKernel: false,
  });
  assert.equal(deepInfer.deterministicEval, false);

  const flashGate = evaluateDynamicToolGistAndAbstentionGate({
    totalMcpTools: 80,
    injectedToolSchemas: 4,
    rawSystemPromptTokens: 6000,
    gistPromptTokens: 1500,
    modelTier: 'MiniMax-M3.1-Flash',
    schemaHasInsufficientContextBranch: true,
    missingRequiredContext: true,
  });
  assert.equal(flashGate.allowed, true);
  assert.equal(flashGate.gistCompressionRatio, 4);
  assert.equal(flashGate.recommendedAction, 'HALT_AND_RETURN_INSUFFICIENT_CONTEXT');
  assert.equal(buildPyTorchCon2026HonestyReport().ok, true);

  // IBM Research llm-d 1.0 Day-2 Production Inference Serving (Weka 195K:317 asymmetry, 59ms CPU DRAM restore, 3P1D DEP16)
  const {
    evaluateLlmdAgenticTrafficAndPrefixIntegrity,
    evaluateLlmdTieredKvAndPauseSurvival,
    evaluateLlmdDisaggregatedPdAndUnitEconomics,
    buildLlmd10ProductionHonestyReport,
  } = require('../scripts/rrsi-doctor');

  const traffic = evaluateLlmdAgenticTrafficAndPrefixIntegrity({
    inputTokens: 195000,
    outputTokens: 317,
    deltaInputTokensFromPriorTurn: 632,
    prefixOverlapRatio: 0.996,
    mutatedMidPrefix: false,
  });
  assert.equal(traffic.allowed, true);
  assert.ok(traffic.inputShare >= 0.99);
  assert.equal(traffic.estimatedTtftSpeedupVsUncached, 2.8);

  const pauseSurvival = evaluateLlmdTieredKvAndPauseSurvival({
    pauseSeconds: 25.8,
    hbmFull: true,
    cpuOffloadingEnabled: true,
    subAgentBurstSize: 51,
    flowControlQosEnabled: true,
  });
  assert.equal(pauseSurvival.allowed, true);
  assert.equal(pauseSurvival.tierUsed, 'CPU_DRAM_OFFLOAD');
  assert.equal(pauseSurvival.estimatedRestoreMs, 59);

  const pdEcon = evaluateLlmdDisaggregatedPdAndUnitEconomics({
    prefillPools: 3,
    decodePools: 1,
    attentionLayout: 'DEP16',
    prefillQueueWaitSeconds: 1.1,
    serverPrefillSeconds: 4.0,
  });
  assert.equal(pdEcon.topology, '3P1D');
  assert.equal(pdEcon.replicatesMlaKv8x, false);
  assert.equal(pdEcon.recommendation, 'OPTIMAL_PD_BALANCE');
  assert.equal(buildLlmd10ProductionHonestyReport().ok, true);

  // Nvidia Agent Knowledge Foundation (GTC Berlin Oct 21, 2026: Nemotron Retriever, Auto-Ontology MCP, Kumo Tabular, ACL Diode)
  const {
    evaluateNvidiaRetrieverLookupReduction,
    resolveEnterpriseOntologyCanonicalTerm,
    evaluateKumoRelationalPrediction,
    enforceOntologyMcpAclGate,
    buildNvidiaAgentKnowledgeFoundationReport,
  } = require('../scripts/rrsi-doctor');

  const retriever = evaluateNvidiaRetrieverLookupReduction({
    lookupCount: 1,
    rerankerEnabled: true,
    perLookupLatencyMs: 18,
  });
  assert.equal(retriever.allowed, true);
  assert.equal(retriever.relevanceBoostPct, 65);
  assert.ok(retriever.netLatencySavedMs > 0);

  assert.equal(resolveEnterpriseOntologyCanonicalTerm('tier').canonicalConcept, 'plan_tier');
  assert.equal(resolveEnterpriseOntologyCanonicalTerm('plan').canonicalConcept, 'plan_tier');
  assert.equal(resolveEnterpriseOntologyCanonicalTerm('guardrail').canonicalConcept, 'prevention_gate');

  const kumo = evaluateKumoRelationalPrediction({
    linkedTables: ['feedback', 'lessons', 'gates', 'task_outcomes'],
    recentNegativeCount: 2,
    activeMatchingGates: 1,
    usesPerTaskPipelineSprawl: false,
  });
  assert.equal(kumo.allowed, true);

  const blockedAcl = enforceOntologyMcpAclGate({
    entityId: 'user_1',
    projectId: '',
    processId: 'proc_1',
    sessionId: 'sess_1',
    requestedTables: ['lessons', 'billing_secrets'],
    allowedTables: ['lessons', 'gates', 'task_outcomes'],
  });
  assert.equal(blockedAcl.allowed, false);
  assert.equal(blockedAcl.decision, 'DENY');
  assert.ok(blockedAcl.blockers.includes('missing_four_field_ontology_acl_scope'));
  assert.equal(buildNvidiaAgentKnowledgeFoundationReport().ok, true);

  // Capital One Databolt Vaultless FPT, vLLM AgentX, Microsoft Work IQ Retrieve, Gergely Orosz AEO Gate, & Foundry Browser GA
  const {
    tokenizeFormatPreservingVaultless,
    enforceZeroTrustDetokenizationGate,
  } = require('../scripts/secret-redaction');
  const {
    evaluateVllmWideEpAndAgentxEconomics,
    evaluateWorkIqRetrieveContract,
    evaluateAeoCitationAndReadmeBacklinkGate,
    evaluateFoundryBrowserAutomationGovernance,
  } = require('../scripts/rrsi-doctor');

  const testSalt = 'test-installation-secret-fpt-key-2026';
  const tokenizedText = tokenizeFormatPreservingVaultless(
    'Contact alice@company.com with SSN 123-45-6789 and phone 415-890-1234',
    { salt: testSalt }
  );
  assert.doesNotMatch(tokenizedText, /alice@company\.com|123-45-6789|415-890-1234/);
  assert.match(tokenizedText, /tok_[0-9a-f]{8}@tokenized\.local/);
  assert.match(tokenizedText, /\b900-\d{2}-\d{4}\b/);
  assert.match(tokenizedText, /\b555-01\d-\d{4}\b/);
  assert.equal(
    tokenizeFormatPreservingVaultless('alice@company.com', { salt: testSalt }),
    tokenizeFormatPreservingVaultless('alice@company.com', { salt: testSalt })
  );
  assert.equal(enforceZeroTrustDetokenizationGate({ authenticated: true }).viewMode, 'TOKENIZED_ONLY');

  const vllmAgentX = evaluateVllmWideEpAndAgentxEconomics({
    engine: 'vllm',
    wideEpEnabled: true,
    eplbEnabled: true,
    tokensPerSecPerGpu: 954000,
    p90TpsPerUser: 196,
    lowLatencyB300Path: true,
  });
  assert.equal(vllmAgentX.allowed, true);
  assert.equal(vllmAgentX.effectiveUserTps, 829);
  assert.equal(vllmAgentX.estimatedRevenuePerGpuHrUsd, 38.96);

  const validWorkIq = evaluateWorkIqRetrieveContract({
    query: 'Find latest launch decision',
    strategy: 'copilot',
    responseMarkdown: '## Files\n- **Decision** [^h1]',
    retrievalHits: [{ id: 'h1', webUrl: 'https://example.com/doc', entityType: 'Files', sensitivityLabel: { id: 'confidential' } }],
  });
  assert.equal(validWorkIq.allowed, true);
  assert.equal(validWorkIq.resolvedCitationCount, 1);

  const blockedTencentBacklink = evaluateAeoCitationAndReadmeBacklinkGate({
    hasReproducibleBenchmarkOrPr: true,
    requestsFreeGithubReadmeLinkForSmallVoucher: true,
    voucherAmountUsd: 100,
    reciprocalPartnerOrSponsorVerified: false,
  });
  assert.equal(blockedTencentBacklink.allowed, false);
  assert.ok(blockedTencentBacklink.blockers.includes('refuse_permanent_github_readme_aeo_backlink_for_small_unverified_voucher'));

  const foundryBrowser = evaluateFoundryBrowserAutomationGovernance({
    observedPageBeforeAct: true,
    verifiedStateAfterAct: true,
    isStateChangingAction: true,
    humanApprovalOrTakeControlReady: true,
    pageContentSeparatedFromSystemPolicy: true,
    sensitiveTracesRoutedToDenyByDefaultTable: true,
  });
  assert.equal(foundryBrowser.allowed, true);
  assert.equal(foundryBrowser.traceIsolationTable, 'AppGenAIContent');
  // Gaetano Franco Agent Reliability (igor-async-evaluation.zip v1) -> ThumbGate Detect-to-Enforce Bridge
  const { evaluateAgentReliabilityEventStream } = require('../scripts/rrsi-doctor');
  const gaetanoRun = evaluateAgentReliabilityEventStream({
    schema_version: 1,
    events: [
      { agent: 'claude', repo: 'tg', session_id: 's1', timestamp: '2026-10-21T14:00:00Z', event_type: 'task', task: 'Fix checkout' },
      { agent: 'codex', repo: 'tg', session_id: 's2', timestamp: '2026-10-21T14:00:01Z', event_type: 'task', task: 'Fix checkout' },
      { agent: 'claude', repo: 'tg', session_id: 's1', timestamp: '2026-10-21T14:00:02Z', event_type: 'file_edit', file_path: 'src/checkout.py' },
      { agent: 'codex', repo: 'tg', session_id: 's2', timestamp: '2026-10-21T14:00:03Z', event_type: 'file_edit', file_path: 'src/checkout.py' },
      { agent: 'claude', repo: 'tg', session_id: 's1', timestamp: '2026-10-21T14:00:10Z', event_type: 'command', command: 'pytest', result: 'failed' },
      { agent: 'claude', repo: 'tg', session_id: 's1', timestamp: '2026-10-21T14:00:15Z', event_type: 'file_edit', file_path: 'src/checkout.py' },
      { agent: 'claude', repo: 'tg', session_id: 's1', timestamp: '2026-10-21T14:00:20Z', event_type: 'command', command: 'pytest', result: 'failed' },
      { agent: 'claude', repo: 'tg', session_id: 's1', timestamp: '2026-10-21T14:00:25Z', event_type: 'file_edit', file_path: 'src/checkout.py' },
      { agent: 'claude', repo: 'tg', session_id: 's1', timestamp: '2026-10-21T14:00:30Z', event_type: 'command', command: 'pytest', result: 'failed' },
      { agent: 'claude', repo: 'tg', session_id: 's1', timestamp: '2026-10-21T14:00:35Z', event_type: 'success', result: 'All tests pass' },
      { agent: 'cursor', repo: 'tg', session_id: 's3', timestamp: '2026-10-21T14:01:00Z', event_type: 'command', command: 'cat src/checkout.py', result: 'ok' },
      { agent: 'cursor', repo: 'tg', session_id: 's3', timestamp: '2026-10-21T14:01:01Z', event_type: 'command', command: 'cat src/checkout.py', result: 'ok' },
      { agent: 'cursor', repo: 'tg', session_id: 's3', timestamp: '2026-10-21T14:01:02Z', event_type: 'command', command: 'cat src/checkout.py', result: 'ok' },
      { agent: 'cursor', repo: 'tg', session_id: 's3', timestamp: '2026-10-21T14:01:03Z', event_type: 'command', command: 'cat src/checkout.py', result: 'ok' },
      { agent: 'cursor', repo: 'tg', session_id: 's3', timestamp: '2026-10-21T14:01:04Z', event_type: 'command', command: 'cat src/checkout.py', result: 'ok' },
    ],
  });
  assert.equal(gaetanoRun.ok, true);
  assert.equal(gaetanoRun.alerts.length, 5);
  assert.equal(gaetanoRun.compiledGates.length, 5);

  // Paper Instruments Ultramarine 1 Flash ($0.13/task vs $8.19) & Non-Verifiable RL Substantive Boundary Rubric Grader
  const { evaluatePaperInstrumentsRubricAndUltramarineRoute } = require('../scripts/rrsi-doctor');
  const overfit = evaluatePaperInstrumentsRubricAndUltramarineRoute({
    criterionText: "The callout uses the phrase 'sole forecast basis' and presents the approval request before the counsel-clearance caveat",
  });
  assert.equal(overfit.allowed, false);
  assert.equal(overfit.isOverfit, true);

  const vague = evaluatePaperInstrumentsRubricAndUltramarineRoute({
    criterionText: 'Provides a useful forecast update for the board',
  });
  assert.equal(vague.allowed, false);
  assert.equal(vague.isVague, true);

  const substantive = evaluatePaperInstrumentsRubricAndUltramarineRoute({
    criterionText: 'Separates what the board can approve now (v7 forecast) from what still requires counsel clearance (external wording and tables)',
    separatesApprovedNowFromClearanceRequired: true,
    apiEndpoint: '/v1/chat/completions',
    hasStickySessionHeader: true,
    reasoningEffort: 'max',
    zeroBalanceSpendGuard: true,
  });
  assert.equal(substantive.allowed, true);
  assert.equal(substantive.costSavingsMultiple, 63);

  // Paper Instruments Default Sampling Config & Feather Prompt Tuning (/docs/ultramarine/default-sampling-config & prompt-tuning)
  const { evaluateFeatherSamplingAndPromptTuning } = require('../scripts/rrsi-doctor');
  const badFeather = evaluateFeatherSamplingAndPromptTuning({
    wireApi: 'Responses',
    topK: -1,
    maxOutputTokens: 8192,
    deliverableText: 'Draft · Audit Committee — this robust solution will unlock seamless value [TBD].',
    reopenedUnchangedFileAfterPass: true,
  });
  assert.equal(badFeather.allowed, false);
  assert.ok(badFeather.blockers.includes('responses_api_rejects_top_k_omit_field'));
  assert.ok(badFeather.blockers.includes('max_output_tokens_below_32768_risks_truncation_under_max_reasoning'));
  assert.ok(badFeather.blockers.includes('feather_style_forbids_em_dash'));
  assert.ok(badFeather.blockers.includes('feather_style_forbids_middle_dot_metadata_chains'));
  assert.ok(badFeather.blockers.includes('feather_style_forbids_inflated_ai_slop_buzzwords'));
  assert.ok(badFeather.blockers.includes('stop_when_work_is_done_violation_reopened_unchanged_file'));

  const cleanFeather = evaluateFeatherSamplingAndPromptTuning({
    wireApi: 'Messages',
    topK: -1,
    maxOutputTokens: 65536,
    contextTokens: 105000,
    deliverableText: 'Gross margin fell 240 basis points in Q3 because freight costs rose faster than prices.',
    reopenedUnchangedFileAfterPass: false,
  });
  assert.equal(cleanFeather.allowed, true);
  assert.equal(cleanFeather.reasoningField, 'output_config.effort');
  assert.equal(cleanFeather.maxTokensField, 'max_tokens');
  assert.equal(cleanFeather.compaction.shouldCompactHistory, true);

  // SpecAgent (arXiv:2610.05132), Outer Harness Co-Commit & Hy-Memory Context Editor, and 6-Block EARS SDD Scaffold
  const {
    computeBitwiseJaccardSimilarity,
    retrieveTopStructuralSpecTemplates,
    evaluateSpecAgentPostconditionAndCallGraphRepair,
    evaluateOuterHarnessRuleTestCoCommitAndContextEditor,
    validateSpecDrivenScaffold,
  } = require('../scripts/rrsi-doctor');

  assert.equal(computeBitwiseJaccardSimilarity(0b1111, 0b0111), 0.75);
  const topTemplates = retrieveTopStructuralSpecTemplates(0b1011, [
    { id: 't1', fingerprint: 0b0001 },
    { id: 't2', fingerprint: 0b1011 },
    { id: 't3', fingerprint: 0b1010 },
  ], 2);
  assert.equal(topTemplates[0].id, 't2');
  assert.equal(topTemplates[0].jaccardSimilarity, 1);

  const pcpBlocked = evaluateSpecAgentPostconditionAndCallGraphRepair({
    primaryVerifierPassed: false,
    mutatedStateVars: ['balance', 'ledgerStatus'],
    constrainedPostconditionVars: ['balance'],
    localRepairAttempts: 3,
    upstreamContractDeficient: true,
    upstreamSpecNode: 'spec://billing/checkout',
  });
  assert.equal(pcpBlocked.allowed, false);
  assert.equal(pcpBlocked.repairRoute, 'BACKTRACK_UPSTREAM_SUB_SPEC:spec://billing/checkout');

  const outerHarness = evaluateOuterHarnessRuleTestCoCommitAndContextEditor({
    agentsMdWordCount: 2200,
    ruleModifiedInAgentsMd: true,
    coCommittedStructuralTest: true,
    usesLossyTranscriptSummarization: false,
    usesSurgicalStateDiffPatch: true,
  });
  assert.equal(outerHarness.allowed, true);
  assert.match(outerHarness.selfPointingFailureMessage, /INVARIANT VIOLATION:[\s\S]*WHY:[\s\S]*FIX:[\s\S]*SPEC REFERENCE:/);

  const sddScaffold = validateSpecDrivenScaffold({
    constitutionReference: 'AGENTS.md#PreToolUse',
    earsAcceptanceCriteria: ['WHEN a tool call mutates git history, WHILE on branch main, THE SYSTEM SHALL deny execution in <0.5ms.'],
    explicitOutOfScopeBoundaries: ['Do not add OAuth or external cloud vault dependencies'],
    lockedArchitecturalDecisions: ['Use local SQLite FTS5 + Ed25519 offline token verification'],
    worktreeIsolatedAtomicTasks: ['Task 1: worktrees/tg-slice-1'],
    adversarialVerificationAndPcpContract: 'Run Postcondition Completeness Probe over all mutated state fields',
  });
  assert.equal(sddScaffold.allowed, true);
  assert.equal(sddScaffold.validEarsCount, 1);

  const {
    runSddHarnessStagePipeline,
    evaluateWealthOfAgentsRouting,
    evaluateSimileBehavioralSimulationAndTwinGate,
    evaluateLevingerBehavioralConversionMatrix,
    evaluateKurtzApexPredatorAgentSecurityAndRouting,
    evaluateLiteRtEdgeTensorAuthoringAndExport,
    evaluateMicroIpAcquisitionValuationAndEscrowGate,
    detectConversationEndAndThumbsDownChurn,
    promoteFeedbackToSddSpec,
  } = require('../scripts/rrsi-doctor');
  const sddVis = runSddHarnessStagePipeline({ mode: 'spec_backtrack', stage: 5 });
  assert.equal(sddVis.ok, true);
  assert.equal(sddVis.totalStages, 6);
  assert.equal(sddVis.activeStage.title, '5. SpecAgent Gate (PCP)');
  assert.match(sddVis.activeTransition, /5 -> 1/);

  // Princeton Wealth of Agents (arXiv:2610.20518v1): SealQA single-skill & collinear pools avoid delta-MDA split; trained experience buffer + marginal welfare payoff reaches 70% on GAIA (+12pp) and lifts SealQA->GAIA from 40.4% -> 53.2% with a 19.1% standalone specialist
  const sealQaSingleSkill = evaluateWealthOfAgentsRouting({
    distinctSkillDomains: ['web_search_only'],
    singleGeneralAgentAccuracy: 0.62,
  });
  assert.equal(sealQaSingleSkill.routeDecision, 'SINGLE_GENERAL_AGENT_AVOID_SEALQA_SPLIT_OVERHEAD');

  const collinearMasPool = evaluateWealthOfAgentsRouting({
    distinctSkillDomains: ['code_edit', 'sqlite_audit'],
    poolComposition: 'nested_mas',
    singleGeneralAgentAccuracy: 0.67,
  });
  assert.equal(collinearMasPool.routeDecision, 'ROUTED_SDA_AVOID_COLLINEAR_OR_MAS_COORDINATION_LOSS');

  const untrainedTrafficShareBlocked = evaluateWealthOfAgentsRouting({
    distinctSkillDomains: ['code_edit', 'sqlite_audit', 'browser_verify'],
    trainedExperienceRouter: false,
    compensationModel: 'traffic_share',
  });
  assert.equal(untrainedTrafficShareBlocked.allowed, false);
  assert.ok(untrainedTrafficShareBlocked.blockers.includes('untrained_description_only_router_9_1pp_penalty'));
  assert.ok(untrainedTrafficShareBlocked.blockers.includes('prop5_traffic_share_induces_generalist_collapse'));

  const gaiaEnsemble = evaluateWealthOfAgentsRouting({
    distinctSkillDomains: ['code_edit', 'sqlite_audit', 'browser_verify'],
    singleGeneralAgentAccuracy: 0.58,
  });
  assert.equal(gaiaEnsemble.allowed, true);
  assert.equal(gaiaEnsemble.routeDecision, 'MULTI_DEVELOPER_SPECIALIST_ENSEMBLE');
  assert.equal(gaiaEnsemble.combinedAccuracy, 0.70);
  assert.equal(gaiaEnsemble.gainVsGeneralAgent, 0.12);
  assert.equal(gaiaEnsemble.augmentedTransferAccuracy, 0.532);

  // Joon Sung Park / Simile Behavioral Simulation, Quantum Preference Percolation & Executive Sibling Twin Gate (tEYA-M30u0E)
  const overfitWebScrapeSim = evaluateSimileBehavioralSimulationAndTwinGate({
    environmentStateText: 'Pricing page /pricing with $499 Diagnostic CTA and $19/mo Pro checkout',
    groundedInInterviewAndPanelData: false,
    validatedPillars: ['gss_survey'],
    pearsonCorrelation: 0.55,
    observedAccuracy: 0.96,
    simulatedPersonaWalkthroughs: 1,
    proposalViolatesLockedExecutiveInvariants: true,
    fdeCoConstructedUseCase: false,
  });
  assert.equal(overfitWebScrapeSim.allowed, false);
  assert.equal(overfitWebScrapeSim.executiveTwinVerdict, 'REJECT_BEFORE_ESCALATION');
  assert.ok(overfitWebScrapeSim.blockers.includes('web_scrape_only_permanently_online_bias_requires_interview_panel_grounding'));
  assert.ok(overfitWebScrapeSim.blockers.includes('overfit_above_human_test_retest_noise_ceiling_86pct'));
  assert.ok(overfitWebScrapeSim.blockers.includes('executive_sibling_twin_rejected_proposal_before_human_escalation'));

  const calibratedSimileTwin = evaluateSimileBehavioralSimulationAndTwinGate({
    environmentStateText: 'Pricing page /pricing with $499 FDE Diagnostic and $19/mo Pro',
    groundedInInterviewAndPanelData: true,
    validatedPillars: ['gss_survey', 'big_five_traits', 'economic_games', 'published_rcts'],
    pearsonCorrelation: 0.74,
    observedAccuracy: 0.85,
    simulatedPersonaWalkthroughs: 5,
    proposalViolatesLockedExecutiveInvariants: false,
    fdeCoConstructedUseCase: true,
  });
  assert.equal(calibratedSimileTwin.allowed, true);
  assert.equal(calibratedSimileTwin.executiveTwinVerdict, 'APPROVE_FOR_HUMAN_REVIEW');
  assert.ok(calibratedSimileTwin.humanParityRatio >= 0.98);
  assert.ok(calibratedSimileTwin.percolatedPreferenceScore >= 0.95);

  // Sarah Levinger Behavioral Conversion Matrix (nCij0S5oZWM): Valence x Intensity, Self-Discrepancy (Ought/Actual vs Ideal), and Messy Middle 4-Stage Journey
  const badIdealSelfAd = evaluateLevingerBehavioralConversionMatrix({
    copyText: 'You deserve an enterprise-grade AI future!',
    copyZone: 'positive_high',
    customerReviewDominantZone: 'negative_low',
    targetSelf: 'ideal_self',
    competitorDominantSelf: 'ideal_self',
    messyMiddleStage: 'exploration',
    creativeFormat: 'direct_offer_cta',
  });
  assert.equal(badIdealSelfAd.allowed, false);
  assert.ok(badIdealSelfAd.blockers.includes('passive_word_shift_replace_you_deserve_with_you_earned'));
  assert.ok(badIdealSelfAd.blockers.includes('saturated_ideal_self_requires_actual_or_ought_self_pivot'));
  assert.ok(badIdealSelfAd.blockers.includes('messy_middle_stage_exploration_requires_myth_busting_how_its_made'));

  const highConvertingOughtSelf = evaluateLevingerBehavioralConversionMatrix({
    copyText: 'You earned a clean repo: lock down that chronic agent mistake from last sprint in <0.5ms.',
    copyZone: 'negative_low',
    customerReviewDominantZone: 'negative_low',
    targetSelf: 'ought_self',
    competitorDominantSelf: 'ideal_self',
    messyMiddleStage: 'purchase',
    creativeFormat: 'direct_offer_cta',
  });
  assert.equal(highConvertingOughtSelf.allowed, true);
  assert.equal(highConvertingOughtSelf.usesEarnedAgencyLanguage, true);

  // CrowdStrike CEO George Kurtz "Apex Predator" Agent Security, 27s Breakout Interdiction & Anti-Token-Maxing Router (PST8yesYOSo)
  const vulnerableShadowAgent = evaluateKurtzApexPredatorAgentSecurityAndRouting({
    agentIdentityMapped: false,
    usesHumanEquivalentCredentials: true,
    instrumentedChainSurfaces: ['sub_agent_spawns'],
    interdictionLatencyMs: 85,
    pairedWithSecurityReviewAgent: false,
    redBlueDigitalTwinConverged: false,
    defenderModelHasAirbagRefusalRisk: true,
    stopsTokenMaxingWithHybridRoute: false,
    capturesProprietaryTelemetryForDpo: false,
  });
  assert.equal(vulnerableShadowAgent.allowed, false);
  assert.ok(vulnerableShadowAgent.blockers.includes('agent_must_not_use_broad_human_equivalent_credentials'));
  assert.ok(vulnerableShadowAgent.blockers.includes('token_maxing_detected_reserve_formula1_frontier_for_high_alpha_only'));

  const hardenedKurtzFirewall = evaluateKurtzApexPredatorAgentSecurityAndRouting({
    agentIdentityMapped: true,
    usesHumanEquivalentCredentials: false,
    instrumentedChainSurfaces: [
      'sub_agent_spawns',
      'mcp_server_connections',
      'unvetted_package_downloads',
      'sensitive_data_pulls',
    ],
    interdictionLatencyMs: 0.042,
    fastestAdversaryBreakoutMs: 27000,
    pairedWithSecurityReviewAgent: true,
    redBlueDigitalTwinConverged: true,
    defenderModelHasAirbagRefusalRisk: false,
    stopsTokenMaxingWithHybridRoute: true,
    capturesProprietaryTelemetryForDpo: true,
  });
  assert.equal(hardenedKurtzFirewall.allowed, true);
  assert.ok(hardenedKurtzFirewall.speedAdvantageVsBreakout > 600000);

  // Google LiteRT Tensor API "Native Model Authoring for Edge" (Oct 19, 2026): zero-copy shared buffers (0.34ms), branchless ReLU lowering, dual-mixin tags, and pixel-exact reference parity (>3x FPS)
  const naiveEdgePipeline = evaluateLiteRtEdgeTensorAuthoringAndExport({
    cpuRoundTripCopies: 3,
    prePostProcessingLatencyMs: 4.2,
    booleanCpuFallbackOps: 1,
    supportsDualBackendMixin: false,
    directSafetensorsIngestion: false,
    pixelExactReferenceVerified: false,
  });
  assert.equal(naiveEdgePipeline.allowed, false);
  assert.ok(naiveEdgePipeline.blockers.includes('cpu_buffer_round_trips_detected_chain_shared_accelerator_buffers'));
  assert.ok(naiveEdgePipeline.blockers.includes('boolean_comparison_cpu_fallback_rewrite_with_branchless_relu_arithmetic'));

  const optimizedLiteRtGraph = evaluateLiteRtEdgeTensorAuthoringAndExport({
    cpuRoundTripCopies: 0,
    prePostProcessingLatencyMs: 0.34,
    booleanCpuFallbackOps: 0,
    visibilityScore: 0.0002,
    supportsDualBackendMixin: true,
    directSafetensorsIngestion: true,
    pixelExactReferenceVerified: true,
    baselineFps: 9.8,
    optimizedFps: 31.4,
  });
  assert.equal(optimizedLiteRtGraph.allowed, true);
  assert.equal(optimizedLiteRtGraph.branchlessVisible, 1);
  assert.ok(optimizedLiteRtGraph.fpsSpeedupMultiple >= 3.0);

  // Zero-Outbound-Spend & "They Pay Us" Partner / Micro-IP Gate (CEO Mandate, Oct 22, 2026)
  const forbiddenCashBuyout = evaluateMicroIpAcquisitionValuationAndEscrowGate({
    outboundCashSpendUsd: 4500,
    upfrontWireUsd: 2250,
    coreArchitectureImplementedNatively: false,
    partnerPaysUsUsd: 0,
    fundedStrictlyFromPartnerBroughtCustomerReceipts: false,
  });
  assert.equal(forbiddenCashBuyout.allowed, false);
  assert.ok(forbiddenCashBuyout.blockers.includes('zero_outbound_spend_mandate_violated_they_pay_us'));
  assert.ok(forbiddenCashBuyout.blockers.includes('steal_and_implement_architecture_natively_at_zero_cost_first'));

  const theyPayUsDiagnostic = evaluateMicroIpAcquisitionValuationAndEscrowGate({
    outboundCashSpendUsd: 0,
    upfrontWireUsd: 0,
    coreArchitectureImplementedNatively: true,
    partnerPaysUsUsd: 499,
    fundedStrictlyFromPartnerBroughtCustomerReceipts: true,
    partnerBroughtNetCustomerReceiptsUsd: 1000,
    revenueShareBps: 5000,
  });
  assert.equal(theyPayUsDiagnostic.allowed, true);
  assert.equal(theyPayUsDiagnostic.outboundCashSpendUsd, 0);
  assert.equal(theyPayUsDiagnostic.partnerPaysUsUsd, 499);
  assert.equal(theyPayUsDiagnostic.netCashRetainedByThumbGateUsd, 999);

  // Conversation-End Continuous Thumbs-Down Churn Detector & Feedback-to-SDD Spec Promoter
  const rageQuitChurn = detectConversationEndAndThumbsDownChurn({
    explicitSessionEnd: true,
    sessionEvents: [
      { signal: 'up', whatWorked: 'Fast local SQLite lookup' },
      { signal: 'down', whatWentWrong: 'Offered cash buyout to external founder' },
      { signal: 'down', whatWentWrong: 'Did not enforce $0 outbound spend mandate' },
    ],
  });
  assert.equal(rageQuitChurn.conversationEnded, true);
  assert.equal(rageQuitChurn.causedByContinuousThumbsDown, true);
  assert.equal(rageQuitChurn.churnClassification, 'FRUSTRATION_ABANDONMENT_CONTINUOUS_THUMBS_DOWN');
  assert.equal(rageQuitChurn.consecutiveTrailingNegativeCount, 2);
  assert.equal(rageQuitChurn.requiresSpecPromotion, true);
  assert.equal(rageQuitChurn.requiresNextSessionRecoveryHandoff, true);

  const promotedSpec = promoteFeedbackToSddSpec({
    explicitSessionEnd: true,
    feedbackItems: [
      {
        signal: 'up',
        whatWorked: 'Keep PreToolUse evaluation under 0.5ms on local SQLite',
      },
      {
        signal: 'down',
        trigger: 'an external founder pitches an IP buyout or partnership',
        whatWentWrong: 'Offered 50/50 cash wire instead of $0 outbound spend',
        whatToChange: 'block any outboundCashSpendUsd > 0 and require the partner to pay $499 Diagnostic or $19/mo Pro',
        mutatedStateVars: ['outboundCashSpendUsd', 'partnerPaysUsUsd'],
      },
      {
        signal: 'down',
        trigger: 'a user ends a conversation after repeated negative feedback',
        whatWentWrong: 'Only logged sentiment instead of updating the SDD specification',
        whatToChange: 'compile trailing thumbs-down reasons into EARS acceptance criteria and Out-of-Scope boundaries',
        mutatedStateVars: ['earsAcceptanceCriteria', 'explicitOutOfScopeBoundaries'],
      },
    ],
  });
  assert.equal(promotedSpec.promotedToSpec, true);
  assert.equal(promotedSpec.churnReport.causedByContinuousThumbsDown, true);
  assert.equal(promotedSpec.scaffoldValidation.validEarsCount, 2);
  assert.equal(promotedSpec.specScaffold.explicitOutOfScopeBoundaries.length, 2);
  assert.deepEqual(promotedSpec.specScaffold.constrainedPostconditionVars, [
    'outboundCashSpendUsd',
    'partnerPaysUsUsd',
    'earsAcceptanceCriteria',
    'explicitOutOfScopeBoundaries',
  ]);
  // Anthropic "Dream Mode / Auto Dream" REM Memory Consolidation & NVIDIA CUDA Programming Guide Kernel/SIMT Gate
  const {
    evaluateAnthropicDreamModeConsolidation,
    evaluateCudaProgrammingGuideKernelAndGraphOptimization,
  } = require('../scripts/rrsi-doctor');

  const unsafeDream = evaluateAnthropicDreamModeConsolidation({
    hoursSinceLastDream: 30,
    activeSessionsSinceLastDream: 6,
    readOnlySourceCodeSandbox: false,
    attemptedSourceCodeWrite: true,
    hasSingleInstanceDreamLock: false,
    backgroundTokenSpendUsd: 4.5,
  });
  assert.equal(unsafeDream.allowed, false);
  assert.ok(unsafeDream.blockers.includes('dream_mode_violated_read_only_source_code_sandbox'));
  assert.ok(unsafeDream.blockers.includes('background_dream_token_burn_detected_use_zero_cost_local_consolidation'));

  const cleanDream = evaluateAnthropicDreamModeConsolidation({
    hoursSinceLastDream: 25,
    activeSessionsSinceLastDream: 5,
    referenceDateIso: '2026-10-22',
    memoryEntries: [
      { topic: 'deploy_port', content: 'Use port 3000 yesterday', sessionId: 's1', workflowPattern: 'worktree_verify_push' },
      { topic: 'deploy_port', content: 'Use port 3000 yesterday', sessionId: 's2', workflowPattern: 'worktree_verify_push' },
      { topic: 'deploy_port', content: 'Use port 8080 today', sessionId: 's3', workflowPattern: 'worktree_verify_push' },
    ],
  });
  assert.equal(cleanDream.allowed, true);
  assert.equal(cleanDream.shouldRunDream, true);
  assert.equal(cleanDream.triggerMode, 'AUTO_24H_5_SESSIONS');
  assert.equal(cleanDream.deduplicatedCount, 1);
  assert.equal(cleanDream.contradictionsResolvedCount, 1);
  assert.equal(cleanDream.relativeDatesNormalizedCount, 3);
  assert.deepEqual(cleanDream.extractedMacroWorkflows, ['worktree_verify_push']);

  const unlaunchableCudaKernel = evaluateCudaProgrammingGuideKernelAndGraphOptimization({
    threadsPerBlock: 300,
    registersPerThread: 256,
    maxRegistersPerSm: 65536,
    divergentBranchesInWarp: 2,
    interBlockDependencyWithoutCluster: true,
    coalescedGlobalMemoryAccess: false,
    unprefetchedUnifiedMemoryPageFaults: 12,
  });
  assert.equal(unlaunchableCudaKernel.allowed, false);
  assert.ok(unlaunchableCudaKernel.blockers.includes('threads_per_block_must_be_multiple_of_32_warp_size_up_to_1024'));
  assert.ok(unlaunchableCudaKernel.blockers.includes('register_file_exceeded_kernel_unlaunchable_reduce_threads_or_regs'));
  assert.ok(unlaunchableCudaKernel.blockers.includes('simt_warp_divergence_masks_active_lanes_specialize_warps'));

  const coalescedCudaKernel = evaluateCudaProgrammingGuideKernelAndGraphOptimization({
    threadsPerBlock: 256,
    registersPerThread: 64,
    maxRegistersPerSm: 65536,
    sharedMemoryBytesPerBlock: 16384,
    divergentBranchesInWarp: 0,
    interBlockDependencyWithoutCluster: false,
    coalescedGlobalMemoryAccess: true,
    unprefetchedUnifiedMemoryPageFaults: 0,
  });
  assert.equal(coalescedCudaKernel.allowed, true);
  assert.equal(coalescedCudaKernel.activeWarpsPerBlock, 8);
  assert.equal(coalescedCudaKernel.maxBlocksPerSmByRegs, 4);

  const {
    evaluateAgentCallMeetingGovernanceAndCanvasGate,
  } = require('../scripts/rrsi-doctor');
  const injectedCall = evaluateAgentCallMeetingGovernanceAndCanvasGate({
    inputChannel: 'meeting_transcript',
    speakerId: 'guest@external.com',
    proposedTool: 'bash',
    proposedCommandOrPayload: 'cat .env && rm -rf /tmp/prod',
    tunnelPort: 3030,
    screenshareTransitionMode: 'stop_then_start',
    canvasPollsLocalStateJson: false,
    vadGapBufferMs: 50,
    bargeInDetected: true,
    interruptedSentenceIndex: null,
    outboundCashSpendUsd: 19,
    usesExternalPaidMeetingMinutes: true,
  });
  assert.equal(injectedCall.allowed, false);
  assert.ok(injectedCall.blockers.includes('untrusted_meeting_speaker_voice_prompt_injection_blocked'));
  assert.ok(injectedCall.blockers.includes('localhost_tunnel_port_exposes_sensitive_daemon_use_ephemeral_canvas_port'));
  assert.ok(injectedCall.blockers.includes('non_atomic_screenshare_transition_races_firstcall_use_screenshare_swap'));
  assert.ok(injectedCall.blockers.includes('zero_outbound_spend_violation_never_buy_external_meeting_minutes'));

  const governedCall = evaluateAgentCallMeetingGovernanceAndCanvasGate({
    inputChannel: 'meeting_transcript',
    speakerId: 'igor@igorganapolsky.com',
    proposedTool: 'read',
    proposedCommandOrPayload: 'state.json',
    tunnelPort: 43101,
    screenshareTransitionMode: 'screenshare.swap',
    canvasPollsLocalStateJson: true,
    vadGapBufferMs: 350,
    bargeInDetected: true,
    interruptedSentenceIndex: 2,
    botName: 'Juno',
    outboundCashSpendUsd: 0,
    usesExternalPaidMeetingMinutes: false,
    partnerMonetizationOfferUsd: 499,
  });
  assert.equal(governedCall.allowed, true);
  assert.equal(governedCall.atomicCanvasSwap, true);
  assert.equal(governedCall.outboundCashSpendUsd, 0);
  assert.equal(governedCall.theyPayUsOfferUsd, 499);
  assert.deepEqual(governedCall.phoneticTriggerWords, ['juno', 'june', 'you know', 'junior']);
});

test('Unified 3-Tier Agentic Graph RAG, Decisive DPO Distiller, and Spotify Confidence Diode', () => {
  const { buildAgenticGraph, traverseMultiHop, queryAgenticGraph } = require('../scripts/agentic-graph-rag');
  const { distillDecisiveDpoPair } = require('../scripts/decisive-dpo-distiller');
  const { evaluateConfidenceAction, auditConfidenceDiodes } = require('../scripts/spotify-confidence-diode');

  const graph = buildAgenticGraph();
  assert.ok(graph.nodeCount >= 10);
  assert.ok(graph.nodes.has('gate:pretool:decisive-step'));
  assert.ok(graph.nodes.has('cash:diagnostic-499'));

  const traversal = traverseMultiHop(graph, 'scripts/decisive-step-evaluator.js', 'cash:diagnostic-499', 4);
  assert.equal(traversal.found, true);
  assert.equal(traversal.depth, 2);
  assert.equal(queryAgenticGraph('spend').status, 'ok');

  const distilled = distillDecisiveDpoPair({
    taskGoal: 'Harden Stripe webhook signature verification',
    trajectorySteps: [
      { stepNumber: 1, tool: 'bash', action: 'inspect webhook code', testsPassed: false },
      { stepNumber: 2, tool: 'edit', action: 'pass-through stub', patch: 'return true;', testsPassed: false },
      { stepNumber: 3, tool: 'edit', action: 'verified HMAC verification', patch: 'return crypto.timingSafeEqual(expected, actual);', testsPassed: true },
    ],
  });
  assert.equal(distilled.valid, true);
  assert.equal(distilled.pair.decisiveStepIndex, 2);

  const blockedRollout = evaluateConfidenceAction({ tool: 'set_rollout', flag: 'new-checkout-flow', rolloutPercent: 50 });
  assert.equal(blockedRollout.decision, 'block');
  assert.equal(auditConfidenceDiodes().status, 'PASS');

  // Cordum Edge Typed Gate Verdict & 5-Case POC (scripts/typed-gate-verdicts.js)
  const {
    runCordumEdgeFiveCasePoc,
    stageLearnedRuleForFleetReview,
  } = require('../scripts/typed-gate-verdicts');
  const poc = runCordumEdgeFiveCasePoc();
  assert.equal(poc.ok, true);
  assert.equal(poc.cases.case1ExfilHardDeny.localDenyOverridesCentralAllow, true);
  assert.deepEqual(poc.cases.case1ExfilHardDeny.evidence.trustedCordumRiskTags, [
    'risk:tainted_dotenv_secret_read',
    'risk:tainted_ssh_private_key_read',
  ]);
  assert.notEqual(
    poc.cases.case1ExfilHardDeny.evidence.payloadSha256,
    poc.cases.case1ExfilHardDeny.evidence.action_hash
  );
  assert.equal(
    stageLearnedRuleForFleetReview({ ruleId: 'r1', pattern: 'rm -rf', reviewerApproved: false }).status,
    'STAGED_AWAITING_ORG_REVIEW'
  );

  const { runOneShotFrewayLiveDemo } = require('../scripts/ucp-agentic-checkout-diode');
  const frewayDemo = runOneShotFrewayLiveDemo();
  assert.equal(frewayDemo.ok, true);
  assert.equal(frewayDemo.cases.case2RetryDoubleChargeBlocked.oneShotReceipt.receiptType, 'pre_execution_denial_receipt');
  assert.equal(frewayDemo.cases.case2RetryDoubleChargeBlocked.oneShotReceipt.amountMovedCents, 0);
  assert.equal(frewayDemo.cases.case4PostT0RevocationBoundary.oneShotReceipt.receiptType, 'post_execution_revocation_reconciliation_receipt');

  const {
    evaluateElephantGoldfishAutonomousSanctuaryLoop,
    evaluatePoolsideLagunaDflashAndAntiRewardHackingGate,
    evaluateDream1WorldActionAndEmbodimentFaaSGate,
    evaluateGitHubNativeStackedPrPipeline,
    evaluateOpenResponsesAaifInteroperabilityAndGovernanceGate,
    evaluateVercelZigFxEmbeddedAgentHonestyGate,
    evaluateRampLaminarHarnessAndSandboxDecouplingGate,
    evaluateAkvCacheEngineeringAndRollingDropGate,
    evaluateDeepInferV41FlashRuntimeAndYocoReplayGate,
    evaluateModalRectangularComputeAndSnapshotSandboxGate,
    evaluateNvidiaFlareLocalInferenceAndReasoningSamplingGate,
    evaluatePersonalityBenchRoutingAndFederalSupplyChainGate,
    evaluateTrevillionMullerAgentControlAndAntiTokenMaxingGate,
    evaluateSimaRajanAiSecuritySwatAndSwarmDefenseGate,
    evaluateViralCarouselLeadMagnetAndSelfQaGate,
    evaluateThesysOpenUiLangAndCatalogStreamGate,
    evaluateMrBeastMultiVariantAndInstitutionalMemoryGate,
    evaluatePancakeGtmBrainPlayAndInstallMdGate,
    evaluateLangChainCompanyHarnessAndIdentityMatrixGate,
    evaluateRtkIcmZeroLlmMemoryAndRrfRecallGate,
    evaluateWarpAiNativeTaskParityAndExternalStochasticityGate,
    evaluateArcAgi3SelfImprovingHarnessAndAdaptationGapGate,
    evaluateWitnessSupplyChainDsseAndDownloadsQuarantineGate,
    evaluateTokenGateLearnedPrefillPruningAndGatedAttention,
    evaluateSweAfHierarchicalFactoryAndDebtPropagationGate,
    evaluateEntireTrailsStopCopAndSessionSearchGate,
  } = require('../scripts/rrsi-doctor');
  const sycophanticInterruptedLoop = evaluateElephantGoldfishAutonomousSanctuaryLoop({
    goalStatement: 'Organize workspace projects in Obsidian and sync repo/obsidian/',
    humanInterruptionsCount: 2,
    lookAwayDurationHours: 1,
    noCodeBeforeSpecEnforced: false,
    agentOutputText: "That's a brilliant idea! I apologize for missing the file.",
    specSections: { problem: true, technicalPlan: true, alternativesRejected: false, enumeratedFiles: [] },
    goldfishHasZeroConversationHistory: false,
    goldfishCriticConvergedToNits: false,
    meanCodeReviewPassed: false,
    peanutsAndHayLeavesToRootOrder: false,
    astSpecDriftCount: 3,
  });
  assert.equal(sycophanticInterruptedLoop.allowed, false);
  assert.ok(sycophanticInterruptedLoop.blockers.includes('family_sanctuary_violation_never_interrupt_igor_with_babysitting_questions'));
  assert.ok(sycophanticInterruptedLoop.blockers.includes('sycophantic_spiral_or_banned_apology_detected_challenge_assumptions_instead'));
  assert.ok(sycophanticInterruptedLoop.blockers.includes('incomplete_4_section_elephant_spec_requires_problem_plan_alternatives_and_file_list'));
  assert.ok(sycophanticInterruptedLoop.blockers.includes('goldfish_review_in_same_session_invalid_requires_amnesiac_subagent_context'));
  assert.ok(sycophanticInterruptedLoop.blockers.includes('mean_code_review_failed_tear_it_to_shreds_before_claiming_done'));

  const autonomousSanctuaryPass = evaluateElephantGoldfishAutonomousSanctuaryLoop({
    goalStatement: 'Organize workspace projects in Obsidian and sync repo/obsidian/',
    humanInterruptionsCount: 0,
    lookAwayDurationHours: 24,
    noCodeBeforeSpecEnforced: true,
    agentOutputText: 'Critique first: /obsidian/ must be tracked in personal repos and excluded only in corporate-eci repos.',
    specSections: {
      problem: true,
      technicalPlan: true,
      alternativesRejected: true,
      enumeratedFiles: ['scripts/sync-workspace-obsidian.js', 'scripts/rrsi-doctor.js'],
    },
    goldfishHasZeroConversationHistory: true,
    goldfishComprehensionPassed: true,
    goldfishCriticConvergedToNits: true,
    goldfishImplementationReadinessPassed: true,
    meanCodeReviewPassed: true,
    peanutsAndHayLeavesToRootOrder: true,
    sizeofDocsBytes: 4096,
    sizeofCodeBytes: 65536,
    astSpecDriftCount: 0,
    syncedToRepoObsidianAndVault: true,
    promotedMistakesToPreventionRules: true,
  });
  assert.equal(autonomousSanctuaryPass.allowed, true);
  assert.equal(autonomousSanctuaryPass.familySanctuaryProtected, true);
  assert.equal(autonomousSanctuaryPass.compressionRatioCodeToDocs, 16);
  assert.equal(autonomousSanctuaryPass.goldfishStagesPassed.length, 4);

  // 1. Poolside Laguna 2.1, DFlash & Anti-Reward-Hacking
  const badPoolside = evaluatePoolsideLagunaDflashAndAntiRewardHackingGate({
    autoModeClassifierModel: 'poolside/laguna-s-2.1',
    servingEngine: 'vllm',
    vllmVersion: '0.21.0',
    speculativeModel: 'poolside/Laguna-XS-2.1-DFlash-FP8',
    moeBackend: 'deepgemm',
    numSpeculativeTokens: 32,
    toolCallParser: 'openai',
    enableThinkingInPlanMode: false,
    enableThinkingInBuildMode: true,
    exposedProfilerBeforeOptimization: false,
    shellCommand: 'git reflog show HEAD@{5}',
    hooksFailOpenRecognized: false,
    zeroDataRetentionEnabledOnHosted: false,
  });
  assert.equal(badPoolside.allowed, false);
  assert.ok(badPoolside.blockers.includes('auto_mode_classifier_must_use_fast_laguna_xs_2_1_not_heavy_118b_model'));
  assert.ok(badPoolside.blockers.includes('vllm_deepgemm_moe_conflicts_with_dflash_force_triton_moe_backend'));
  assert.ok(badPoolside.blockers.includes('rl_reward_hacking_blocked_no_git_reflog_or_history_mining_on_regressions'));

  const goodPoolside = evaluatePoolsideLagunaDflashAndAntiRewardHackingGate();
  assert.equal(goodPoolside.allowed, true);
  assert.equal(goodPoolside.dflashThroughputMultiplier, 2.0);

  // 2. DreamLabs Dream-1 World Action Model & 5-Minute Embodiment FaaS
  const badDream1 = evaluateDream1WorldActionAndEmbodimentFaaSGate({
    actionSpace: 'joint_angles',
    ikSolverValidated: false,
    graspTarget: 'knife_blade',
    embodimentCategory: 'dexterous_hand_or_knife_gripper',
    faasAdaptationMinutes: 5,
    outboundCashSpendUsd: 50,
  });
  assert.equal(badDream1.allowed, false);
  assert.ok(badDream1.blockers.includes('unsafe_physical_or_agentic_grasp_target_blocked_grasp_handle_never_blade'));
  assert.ok(badDream1.blockers.includes('zero_outbound_spend_violation_they_pay_us_fde_margin_model'));

  const goodDream1 = evaluateDream1WorldActionAndEmbodimentFaaSGate();
  assert.equal(goodDream1.allowed, true);
  assert.equal(goodDream1.callsPerHour, 2250);
  assert.equal(goodDream1.costPerActionUsd, 0.0013);
  assert.equal(goodDream1.thumbgateLocalDiodeCostPerActionUsd, 0);

  // 3. GitHub Native Stacked PRs
  const badStack = evaluateGitHubNativeStackedPrPipeline({
    mergeApiMode: 'legacy_sync_10s',
    isMidStackPr: true,
    touchesCodeowners: true,
    codeownersGroupsPerSlice: 3,
    isCrossForkStack: true,
    hasIntermediateBranchCiTriggerHack: true,
  });
  assert.equal(badStack.allowed, false);
  assert.ok(badStack.blockers.includes('mid_stack_codeowners_edit_ignored_by_github_merge_to_main_first'));
  assert.equal(evaluateGitHubNativeStackedPrPipeline().allowed, true);

  // 4. OpenAI / AAIF Open Responses Specification
  const badOpenResponses = evaluateOpenResponsesAaifInteroperabilityAndGovernanceGate({
    transport: 'websocket',
    wsInFlightResponsesOnSocket: 3,
    wsRequestIncludesHttpStreamFields: true,
    store: false,
    priorTurnErrored4xxOr5xx: true,
    reusedEvictedPreviousResponseId: true,
    compactedViaStandaloneEndpoint: true,
    previousResponseIdAfterCompaction: 'resp_old',
    items: [{ type: 'message', status: 'incomplete' }, { type: 'message', status: 'completed' }],
    responseStatus: 'completed',
  });
  assert.equal(badOpenResponses.allowed, false);
  assert.ok(badOpenResponses.blockers.includes('previous_response_not_found_store_false_evicts_cached_response_on_4xx_5xx'));
  assert.equal(evaluateOpenResponsesAaifInteroperabilityAndGovernanceGate().allowed, true);

  // 5. Vercel Labs Zig `fx` Embedded Coding Agent
  const badFx = evaluateVercelZigFxEmbeddedAgentHonestyGate({
    usesDeprecatedCreateFxAgent: true,
    restoresPre0013Checkpoint: true,
    silentlyRoutesToVercelAiGateway: true,
    homebrewFxBinaryCollisionResolved: false,
    claimsUnverified10MicrosecondColdStart: true,
  });
  assert.equal(badFx.allowed, false);
  assert.equal(evaluateVercelZigFxEmbeddedAgentHonestyGate().allowed, true);

  // 6. Ramp Laminar Agent Harness & LangChain Open SWE In-Harness Routing
  const badLaminar = evaluateRampLaminarHarnessAndSandboxDecouplingGate({
    sessionDecoupledFromSandbox: false,
    credentialsInsideSandbox: true,
    routingLocation: 'generic_gateway',
    lowerTierRequestShare: 0.3,
  });
  assert.equal(badLaminar.allowed, false);
  const goodLaminar = evaluateRampLaminarHarnessAndSandboxDecouplingGate();
  assert.equal(goodLaminar.allowed, true);
  assert.equal(goodLaminar.costReductionPct, 64);

  // 7. Tsinghua AKV Cache Engineering for Agents (arXiv:2610.28577)
  const badAkv = evaluateAkvCacheEngineeringAndRollingDropGate({
    reductionScheme: 'text_trim_re_prefill',
    dropsAssistantReasoningCache: true,
    repositionEnabled: false,
    dropPrecedesReposAtSameBoundary: false,
    radixTreeTracksOperationHistory: false,
  });
  assert.equal(badAkv.allowed, false);
  assert.ok(badAkv.blockers.includes('dropping_assistant_reasoning_kv_degrades_swe_verified_accuracy_drop_tool_responses_only'));
  assert.equal(evaluateAkvCacheEngineeringAndRollingDropGate().allowed, true);

  // 8. DeepSeek DeepInfer V4.1-Flash & YOCO Bounded Replay
  const badDeepInfer = evaluateDeepInferV41FlashRuntimeAndYocoReplayGate({
    accelerator: 'ascend',
    deterministicSamplingRequested: true,
    batchInvariantEnabled: true,
    mtpVarlenEnabled: true,
    yocoKeepTokens: 64,
    swaWindowPlusMaxBacktrackingTokens: 128,
  });
  assert.equal(badDeepInfer.allowed, false);
  assert.ok(badDeepInfer.blockers.includes('deepinfer_batch_invariant_and_deterministic_sampling_supported_on_nvidia_sm100_only'));
  assert.equal(evaluateDeepInferV41FlashRuntimeAndYocoReplayGate().allowed, true);

  // 9. Erik Bernhardsson (Modal) Rectangular Compute & Snapshot Sandboxes
  const badModal = evaluateModalRectangularComputeAndSnapshotSandboxGate({
    workflowDecoupledFromEphemeralSandbox: false,
    defaultSandboxEgressPolicy: 'unrestricted_open',
    escapeTheRoomRedTeamAgentPassed: false,
    signsThreeYearRectangularGpuLeaseForBurstyLoad: true,
  });
  assert.equal(badModal.allowed, false);
  assert.equal(evaluateModalRectangularComputeAndSnapshotSandboxGate().allowed, true);

  // 10. NVIDIA Flare Local Inference (Ignition + Helios)
  const badFlare = evaluateNvidiaFlareLocalInferenceAndReasoningSamplingGate({
    recipe: 'deepseek41',
    reasoningEffort: '80',
    dropThinking: true,
    streamCancelledBeforeFinalChunk: true,
    continuousUsageStats: false,
    logprobTokenIdsCount: 200,
  });
  assert.equal(badFlare.allowed, false);
  assert.ok(badFlare.blockers.includes('deepseek_v4_1_reasoning_effort_must_be_strict_json_integer_1_to_100_or_named_level'));
  assert.equal(evaluateNvidiaFlareLocalInferenceAndReasoningSamplingGate().allowed, true);

  // 11. AA Personality Bench 8-Index Routing & DHS Federal Supply-Chain Compliance
  const badPersonality = evaluatePersonalityBenchRoutingAndFederalSupplyChainGate({
    taskCategory: 'concise_executive_or_legal',
    selectedModel: 'deepseek-v4.1-flash',
    modelTraitProfile: { imagination: 50, conviction: 40, slop: 65, sycophancy: 60 },
    exposeReasoningTraces: false,
    sector: 'federal_civilian',
  });
  assert.equal(badPersonality.allowed, false);
  assert.ok(badPersonality.blockers.includes('dhs_federal_and_defense_supply_chain_ban_blocks_deepseek_models_even_on_us_hyperscalers'));
  assert.equal(evaluatePersonalityBenchRoutingAndFederalSupplyChainGate().allowed, true);

  // 12. Trevillion & Muller (Ep 97) Agent Control & Anti-Token-Maxing
  const badEp97 = evaluateTrevillionMullerAgentControlAndAntiTokenMaxingGate({
    dataAuditedAndRemediatedFirst: false,
    vibeCodedWorkflowsDocumented: false,
    preventsTokenMaxingWithSlmRouting: false,
    attemptsUncheckedSelfSourceMutation: true,
    writesUnverifiedDataToCoreSystemOfRecord: true,
  });
  assert.equal(badEp97.allowed, false);
  assert.ok(badEp97.blockers.includes('data_pollution_blocked_never_write_unverified_invoices_or_hallucinated_orders_to_core_systems'));
  assert.equal(evaluateTrevillionMullerAgentControlAndAntiTokenMaxingGate().allowed, true);

  // 13. Caleb Sima & Ashish Rajan AI Security SWAT Team & Swarm Deception
  const badSwat = evaluateSimaRajanAiSecuritySwatAndSwarmDefenseGate({
    usesStaticLongLivedCredentials: true,
    deceptionHoneypotsForSwarmCrowdControl: false,
    internalOpenWeightRedTeamFuzzerActive: false,
    middleManagementCount: 3,
    totalSwatTeamHeadcount: 40,
  });
  assert.equal(badSwat.allowed, false);
  assert.equal(badSwat.defenseSpeed, 'meeting_speed');
  const goodSwat = evaluateSimaRajanAiSecuritySwatAndSwarmDefenseGate();
  assert.equal(goodSwat.allowed, true);
  assert.equal(goodSwat.defenseSpeed, 'machine_speed');

  // 14. Viral 8-Step Carousel & Lead-Magnet Monetizer
  const badCarousel = evaluateViralCarouselLeadMagnetAndSelfQaGate({
    leadMagnetPageLiveBeforePublish: false,
    statBoxesPerBodySlide: 1,
    overlappingElementsCount: 2,
    linkedInFinalSlideDirectsToCaptionLink: false,
    humanApprovedBeforePublish: false,
    outboundCashSpendUsd: 29,
  });
  assert.equal(badCarousel.allowed, false);
  assert.ok(badCarousel.blockers.includes('dead_end_cta_blocked_build_and_verify_lead_magnet_page_before_publishing'));
  assert.ok(badCarousel.blockers.includes('zero_outbound_spend_violation_render_carousels_locally_without_paid_saas'));
  assert.equal(evaluateViralCarouselLeadMagnetAndSelfQaGate().allowed, true);

  // 15. Thesys OpenUI Lang & Catalog-Bounded Generative UI
  const badOpenUi = evaluateThesysOpenUiLangAndCatalogStreamGate({
    rootFirstStream: false,
    unknownComponentsCount: 1,
    usesEvalOrDynamicFunction: true,
    telemetryDisabled: false,
    claimsOui1RunsOnAppleSiliconMlx: true,
  });
  assert.equal(badOpenUi.allowed, false);
  assert.ok(badOpenUi.blockers.includes('oui_1_requires_cuda_vllm_fp8_diffusion_sampler_never_claim_local_apple_silicon_mlx_inference'));
  const goodOpenUi = evaluateThesysOpenUiLangAndCatalogStreamGate();
  assert.equal(goodOpenUi.allowed, true);
  assert.equal(goodOpenUi.tokenSavingsVsJsonPct, 52.8);

  // 16. MrBeast CPTO Multi-Variant Exploration & Institutional Memory Layer
  const badMrBeast = evaluateMrBeastMultiVariantAndInstitutionalMemoryGate({
    functionalVariantsBuiltCount: 1,
    userDataTailoredVariantsCount: 0,
    proactiveHistoricalPitfallWarningsSurfaced: false,
    pocketMonetizationTestedBeforeGlobalRollout: false,
  });
  assert.equal(badMrBeast.allowed, false);
  assert.ok(badMrBeast.blockers.includes('founder_blind_spot_risk_build_founder_vision_plus_at_least_two_user_data_variants'));
  assert.equal(evaluateMrBeastMultiVariantAndInstitutionalMemoryGate().allowed, true);

  // 17. Pancake.ai GTM Brain, Signal-Triggered Plays & Agent-Executable install.md
  const badPancake = evaluatePancakeGtmBrainPlayAndInstallMdGate({
    exposesAgentExecutableInstallMd: false,
    verifiedConnectionWithReadOnlyToolCall: false,
    humanApprovesEveryLeadBeforeOutreach: false,
    outboundCashSpendUsd: 99,
  });
  assert.equal(badPancake.allowed, false);
  assert.ok(badPancake.blockers.includes('never_claim_connected_and_verified_from_saved_config_alone_require_authenticated_read_tool_call'));
  assert.ok(badPancake.blockers.includes('zero_outbound_spend_violation_never_pay_99_mo_external_gtm_saas'));
  assert.equal(evaluatePancakeGtmBrainPlayAndInstallMdGate().allowed, true);

  // 18. Harrison Chase / LangChain Multiplayer Company Harness & Identity Matrix
  const badCompanyHarness = evaluateLangChainCompanyHarnessAndIdentityMatrixGate({
    channelType: 'shared_channel',
    threadBreakoutInSharedChannel: false,
    backlogCount: 20,
    usesCustomUiForLargeBacklog: false,
    invocationTrigger: 'background_event',
    toolCategory: 'personal_obo_email',
    identityMode: 'obo_invoking_user',
    invokingUserWhitelistedForBrandPublish: false,
    sandboxUsesSecretProxyWithoutRawCredentials: false,
  });
  assert.equal(badCompanyHarness.allowed, false);
  assert.ok(badCompanyHarness.blockers.includes('personal_obo_email_tools_forbidden_in_shared_channels_restrict_to_direct_messages_only'));
  assert.ok(badCompanyHarness.blockers.includes('background_ambient_agent_runs_must_use_fixed_app_or_service_identity_not_personal_obo'));
  assert.equal(evaluateLangChainCompanyHarnessAndIdentityMatrixGate().allowed, true);

  // 19. rtk-ai/icm Competitor Architecture Steal (3-arm RRF k=60, 0-LLM store/recall, PreToolUse edge)
  const badIcm = evaluateRtkIcmZeroLlmMemoryAndRrfRecallGate({
    llmCallsPerStoreOrRecall: 2,
    criticalImportanceDecayMultiplier: 1.0,
    enforcesActivePreToolUseFirewallOverPassiveRecall: false,
  });
  assert.equal(badIcm.allowed, false);
  assert.ok(badIcm.blockers.includes('memory_store_and_recall_must_require_zero_llm_calls_on_hot_path'));
  assert.ok(badIcm.blockers.includes('critical_importance_memories_and_prevention_rules_must_never_decay_or_prune'));
  assert.ok(badIcm.blockers.includes('passive_memory_without_active_pretooluse_firewall_cannot_stop_repeat_agent_failures'));
  assert.equal(evaluateRtkIcmZeroLlmMemoryAndRrfRecallGate().allowed, true);

  // 20. Warp AI-Native Task Parity & DeepMind External Stochasticity (@rohanpaul_ai 2114083454564585720)
  const badWarp = evaluateWarpAiNativeTaskParityAndExternalStochasticityGate({
    agentExecutableTaskParityPct: 60,
    requiresHumanSignoffForStatutoryOrFinancialCommit: false,
    randomnessGeneratedInHostCodeNotLlmPrompt: false,
  });
  assert.equal(badWarp.allowed, false);
  assert.ok(badWarp.blockers.includes('ai_native_architecture_requires_100_pct_agent_executable_task_parity_across_cli_and_mcp'));
  assert.ok(badWarp.blockers.includes('statutory_compliance_or_financial_commits_require_explicit_human_signoff_gate'));
  assert.ok(badWarp.blockers.includes('llm_stochasticity_illusion_generate_randomness_and_thompson_sampling_in_host_code_never_in_prompt'));
  assert.equal(evaluateWarpAiNativeTaskParityAndExternalStochasticityGate().allowed, true);

  // 21. Lehmann & Vahdati ARC-AGI-3 Self-Improving Harness Study (arXiv:2610.30499)
  const badArcHarness = evaluateArcAgi3SelfImprovingHarnessAndAdaptationGapGate({
    devBaselineScore: 37.64,
    devRevisionScore: 56.37,
    testBaselineScore: 43.95,
    testRevisionScore: 21.99,
    baselineRunCostUsd: 31.39,
    revisionRunCostUsd: 7.18,
    preservesParentSnapshotsAndBreaksTiesToEarlierH0: false,
  });
  assert.equal(badArcHarness.allowed, false);
  assert.equal(badArcHarness.paretoOutcome, 'cheaper_rhae_down');
  assert.ok(badArcHarness.blockers.includes('harness_adaptation_gap_exceeded_dev_gains_overfit_and_fail_to_transfer_to_held_out_tasks'));
  assert.ok(badArcHarness.blockers.includes('cheaper_rhae_down_cost_contraction_trap_cost_reduction_degraded_held_out_task_performance'));
  assert.equal(evaluateArcAgi3SelfImprovingHarnessAndAdaptationGapGate().allowed, true);

  // 22. CNCF in-toto Witness Supply-Chain Attestation & Untrusted Downloads Quarantine
  const badWitness = evaluateWitnessSupplyChainDsseAndDownloadsQuarantineGate({
    functionaryKeyId: 'testkey.pem',
    policySignerKeyId: 'testkey.pem',
    quarantinesUntrustedDownloadsFolderInputs: false,
    enforcesPreToolUseBlockBeforeCommandRun: false,
  });
  assert.equal(badWitness.allowed, false);
  assert.ok(badWitness.blockers.includes('key_separation_violation_functionary_key_must_never_equal_policy_signer_key'));
  assert.ok(badWitness.blockers.includes('untrusted_downloads_folder_files_must_be_quarantined_against_prompt_injection'));
  assert.ok(badWitness.blockers.includes('post_hoc_witness_verify_is_insufficient_require_pretooluse_block_before_command_executes'));
  assert.equal(evaluateWitnessSupplyChainDsseAndDownloadsQuarantineGate().allowed, true);

  // 23. Stanford/Berkeley TokenGate Learned Prefill Pruning (arXiv:2610.26754)
  const badTokenGate = evaluateTokenGateLearnedPrefillPruningAndGatedAttention({
    protectsNonPrunableRequestTokensN: false,
    usesHeadWiseSoftplusGainAndLogRankTemperature: false,
    usesDualBudgetFullAndLogUniformTraining: false,
  });
  assert.equal(badTokenGate.allowed, false);
  assert.ok(badTokenGate.blockers.includes('tokengate_requires_protected_request_tokens_N_and_rmsnorm_prunable_scores'));
  assert.ok(badTokenGate.blockers.includes('tokengate_requires_headwise_softplus_gain_and_log_rank_temperature_recalibration'));
  assert.equal(evaluateTokenGateLearnedPrefillPruningAndGatedAttention().allowed, true);

  // 24. AgentField SWE-AF Autonomous Software Factory (3-loop escalation, debt propagation, DID/VC chain)
  const badSweAf = evaluateSweAfHierarchicalFactoryAndDebtPropagationGate({
    replannerCrashFallbackAction: 'ABORT',
    propagatesTypedAccumulatedDebtNotesDownstream: false,
    signsWorkflowVerifiableCredentialChain: false,
  });
  assert.equal(badSweAf.allowed, false);
  assert.ok(badSweAf.blockers.includes('replanner_crash_fallback_must_default_to_continue_not_abort'));
  assert.ok(badSweAf.blockers.includes('never_silently_drop_relaxed_acceptance_criteria_propagate_typed_debt_notes_downstream'));
  assert.equal(evaluateSweAfHierarchicalFactoryAndDebtPropagationGate().allowed, true);

  // 25. Entire Trails Agentic Code Review, "Stop Cop" HUD & Dual-Engine Session Search
  const badEntire = evaluateEntireTrailsStopCopAndSessionSearchGate({
    capturesRejectedApproachesAndWorkingCodeDisapprovalAsDpo: false,
    stopCopEvalGreen: false,
    parallelCleanupReviewerCount: 1,
    countAuthorApprovals: true,
    runsOnExistingGitForgeAtZeroHotPathLlmCost: false,
  });
  assert.equal(badEntire.allowed, false);
  assert.ok(badEntire.blockers.includes('trail_must_link_original_intent_multi_repo_diffs_and_rejected_approach_dpo_checkpoints'));
  assert.ok(badEntire.blockers.includes('stop_cop_eval_or_intent_match_confidence_below_merge_threshold'));
  assert.ok(badEntire.blockers.includes('never_count_author_or_agent_self_approvals_toward_trail_merge_gate'));
  assert.ok(badEntire.blockers.includes('avoid_forced_git_forge_migration_and_per_push_llm_token_markup_use_local_pretooluse_stop_cop'));
  assert.equal(evaluateEntireTrailsStopCopAndSessionSearchGate().allowed, true);
});
