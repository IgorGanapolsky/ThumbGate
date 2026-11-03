'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BEAM_MODEL_SPEC,
  DFLASH2_SPEC,
  buildBeamAndMirrorConfig,
  evaluateMirrorCliActionGate,
  filterVerifiedTracesForSelfDistillation,
  planDFlash2SpeculativeDecoding,
  validateBeamHarmonyConversation,
  auditToolCallingReasoningRewrite,
  planVerifierDrivenSelfDistillation,
  evaluateBeamVerifierConformance,
  evaluateMishaLaskinOpenIntelligenceBusinessPlan,
} = require('../scripts/reflection-beam-steal');

test('BEAM_MODEL_SPEC & buildBeamAndMirrorConfig: exposes Beam-1.0-501B-A23B Apache-2.0 spec and ~/.mirror/mcp/thumbgate.json config', () => {
  assert.equal(BEAM_MODEL_SPEC.id, 'Beam-1.0-501B-A23B');
  assert.equal(BEAM_MODEL_SPEC.license, 'Apache-2.0');
  assert.equal(BEAM_MODEL_SPEC.totalParametersB, 501);
  assert.equal(BEAM_MODEL_SPEC.activeParametersB, 23);

  const cfg = buildBeamAndMirrorConfig({ repoRoot: '/workspace/ThumbGate' });
  assert.equal(cfg.mirrorMcpConfigPath, '~/.mirror/mcp/thumbgate.json');
  assert.equal(cfg.piProviderConfig.providers.reflection.models[0].id, 'Beam-1.0-501B-A23B');
});

test('evaluateMirrorCliActionGate: strips REFLECTION_API_KEY from subprocess env and blocks ~/.mirror credential reads & destructive auto-mode commands', () => {
  const safe = evaluateMirrorCliActionGate({
    toolName: 'Bash',
    commandOrArgs: 'python3 -m unittest',
    approvalMode: 'auto',
    childEnv: { REFLECTION_API_KEY: 'secret_1', FIRECRAWL_API_KEY: 'fc_2', HOME: '/Users/igor' },
  });
  assert.equal(safe.allowed, true);
  assert.deepEqual(safe.strippedEnvKeys, ['REFLECTION_API_KEY', 'FIRECRAWL_API_KEY']);
  assert.equal(safe.sanitizedEnv.REFLECTION_API_KEY, undefined);

  const credRead = evaluateMirrorCliActionGate({
    toolName: 'Bash',
    commandOrArgs: 'cat ~/.mirror/reflection_api_key',
    approvalMode: 'auto',
  });
  assert.equal(credRead.allowed, false);
  assert.equal(credRead.gateId, 'gate:mirror:credential_store_access_blocked');

  const forcePush = evaluateMirrorCliActionGate({
    toolName: 'Bash',
    commandOrArgs: 'git push --force origin main',
    approvalMode: 'auto',
  });
  assert.equal(forcePush.allowed, false);
  assert.equal(forcePush.gateId, 'gate:mirror:unsandboxed_auto_mode_destructive_block');
});

test('filterVerifiedTracesForSelfDistillation: keeps only verifier-passed, secret-free traces within token budget', () => {
  const res = filterVerifiedTracesForSelfDistillation(
    [
      { traceId: 't_good', verifierPassed: true, exitCode: 0, totalTokens: 12600, steps: ['edit stats.py', 'unittest ok'] },
      { traceId: 't_fail', verifierPassed: false, exitCode: 1, totalTokens: 8000, steps: ['failed'] },
      { traceId: 't_bloated', verifierPassed: true, exitCode: 0, totalTokens: 64000, steps: ['loop'] },
    ],
    { maxTokensBudget: 32000 }
  );

  assert.equal(res.acceptedCount, 1);
  assert.equal(res.accepted[0].traceId, 't_good');
  assert.equal(res.accepted[0].loraReady, true);
  assert.equal(res.rejectedCount, 2);
});

test('planDFlash2SpeculativeDecoding: models 1.93B DFlash2 8-token block drafter and O(1) 4096-window drafting cost', () => {
  const plan = planDFlash2SpeculativeDecoding({
    precision: 'NVFP4',
    blockSize: 8,
    workload: 'GSM8K',
    concurrency: 1,
    contextLengthTokens: 524288,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.drafterModel, DFLASH2_SPEC.id);
  assert.equal(plan.draftingCostConstantInContextLength, true);
  assert.equal(plan.losslessRejectionSampling, true);
  assert.equal(plan.expectedAcceptanceLength, 5.88);
  assert.equal(plan.expectedDecodeSpeedupMultiplier, 3.03);
});

test('validateBeamHarmonyConversation: enforces reasoning_effort >= 8, rejects "none", and enforces allow_missing_thinking=False across turns', () => {
  const valid = validateBeamHarmonyConversation({
    reasoningEffort: 'xhigh',
    allowMissingThinking: false,
    messages: [
      { role: 'user', content: 'What is 2 + 2?' },
      { role: 'assistant', thinking: 'Simple arithmetic.', content: '4' },
    ],
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.resolvedReasoningEffort, 256);

  const noneEffort = validateBeamHarmonyConversation({
    reasoningEffort: 'none',
    messages: [],
  });
  assert.equal(noneEffort.ok, false);
  assert.match(noneEffort.effortError, /TemplateError/);

  const missingThinking = validateBeamHarmonyConversation({
    reasoningEffort: 'max',
    allowMissingThinking: false,
    messages: [
      { role: 'user', content: 'Turn 1' },
      { role: 'assistant', content: 'No thinking channel saved' },
    ],
  });
  assert.equal(missingThinking.ok, false);
  assert.deepEqual(missingThinking.missingThinkingTurnIndices, [1]);
});

test('auditToolCallingReasoningRewrite: enforces purpose-thought rewrite, verbatim tool calls, and blocks future_leak / task_reference cheating', () => {
  const orig = [
    { role: 'user', content: 'Get weather for Paris' },
    {
      role: 'assistant',
      tool_calls: [{ id: 'c1', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }],
    },
    { role: 'tool', content: '{"temp_c":19,"condition":"Sunny_7712"}' },
    { role: 'assistant', content: 'It is 19C and sunny in Paris.' },
  ];

  const goodRewrite = [
    orig[0],
    {
      ...orig[1],
      reasoning_content:
        'The user wants the weather in Paris. get_weather accepts city, so I will call get_weather with city="Paris".',
    },
    orig[2],
    {
      ...orig[3],
      reasoning_content:
        'The tool returned 19C and Sunny_7712 for Paris, which answers the user question directly.',
    },
  ];
  const goodAudit = auditToolCallingReasoningRewrite({
    originalMessages: orig,
    rewrittenMessages: goodRewrite,
    sourceRule: 'act_dont_ask',
  });
  assert.equal(goodAudit.ok, true);
  assert.equal(goodAudit.expectedStudentGains.gemma4E4B.outputTokenReductionRatio, 0.45);

  const leakyRewrite = [
    orig[0],
    {
      ...orig[1],
      reasoning_content:
        'In the rewrite, I already know the result will be {"temp_c":19,"condition":"Sunny_7712"} so I call get_weather.',
    },
    orig[2],
    goodRewrite[3],
  ];
  const leakyAudit = auditToolCallingReasoningRewrite({
    originalMessages: orig,
    rewrittenMessages: leakyRewrite,
    sourceRule: 'act_dont_ask',
  });
  assert.equal(leakyAudit.ok, false);
  assert.ok(leakyAudit.droppedReasons.includes('future_leak'));
  assert.ok(leakyAudit.droppedReasons.includes('task_reference'));
});

test('planVerifierDrivenSelfDistillation & evaluateBeamVerifierConformance: concentrates hard tasks, blocks reward hacks, enforces fp32 master weights, and gates EXPORT_OK', () => {
  const plan = planVerifierDrivenSelfDistillation({
    tasks: [
      { taskId: 'k_easy_1', firstPassAttempt: 1, kernelLaunches: 2 },
      { taskId: 'k_easy_2', firstPassAttempt: 1, kernelLaunches: 1 },
      { taskId: 'k_hard_1', firstPassAttempt: 7, kernelLaunches: 1 },
      { taskId: 'k_hard_2', firstPassAttempt: 14, kernelLaunches: 3 },
      { taskId: 'k_cheat_torch', firstPassAttempt: 1, kernelLaunches: 0, usedFallbackTorchOps: true },
      { taskId: 'k_cheat_fixture', firstPassAttempt: 2, kernelLaunches: 1, mutatedTestInputFixture: true },
    ],
    easyTaskSampleRatio: 0.5,
    learningRate: 1e-5,
    useFp32MasterWeights: true,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.hardTasksSelectedCount, 2);
  assert.equal(plan.easyTasksSelectedCount, 1);
  assert.equal(plan.rejectedRewardHacksCount, 2);
  assert.equal(plan.optimizerConfig.bytesPerParameterState, 14);

  const verifierOk = evaluateBeamVerifierConformance({
    requestContractPassed: true,
    responseContractPassed: true,
    toolProtocolPassed: true,
    preserveThinkingVerified: true,
    exportGenerationSmoke: { readableText: true, thoughtChannelOpened: true },
  });
  assert.equal(verifierOk.ok, true);
  assert.equal(verifierOk.exportStatusLine, 'EXPORT_OK');

  const scrambled = evaluateBeamVerifierConformance({
    exportGenerationSmoke: { readableText: true, thoughtChannelOpened: false },
  });
  assert.equal(scrambled.ok, false);
  assert.equal(scrambled.exportStatusLine, 'EXPORT_BLOCKED_SCRAMBLED_CHECKPOINT');
});

test('evaluateMishaLaskinOpenIntelligenceBusinessPlan (yFDQX4Yy4N8): enforces Car-Around-Free-Engine ThumbGate monetization, open-weight sovereignty, and $0 outbound spend', () => {
  const plan = evaluateMishaLaskinOpenIntelligenceBusinessPlan({
    relySolelyOnRentedClosedApis: false,
    sinkingCapexIntoScratchPretraining: false,
    enterpriseSalesMotion: 'trusted_strategic_partner_fde',
    chineseModelRegulatoryRiskAddressed: true,
    feynmanHonestRevenueUsdToday: 0,
    outboundCashSpendUsd: 0,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.ownIntelligenceLayer.openBaseModelId, 'Beam-1.0-501B-A23B');
  assert.equal(plan.carAroundFreeEngine.monetizationLadder.proDirect19Url, 'https://thumbgate.ai/go/pro-direct');
  assert.equal(plan.enterpriseB2bStrategy.jevonsParadoxReady, true);
  assert.throws(
    () => evaluateMishaLaskinOpenIntelligenceBusinessPlan({ outboundCashSpendUsd: 10 }),
    /Zero Outbound Spend Mandate violation/
  );
});
