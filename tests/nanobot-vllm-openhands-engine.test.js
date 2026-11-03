'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  auditNanobotInstallationAndRevenueLoop,
  evaluateVllmServingUpgrade,
  runOpenHandsAutomationPipeline,
  evaluateOpenHandsControlPlane,
  scoreAgenticSdlcMaturityQuiz,
  evaluateThinkingMachinesUpgrade,
  evaluateCollectiveiTelliRevenueLoop,
  evaluateAiAmArenaAndSecurityGuardrails,
  runDisposableAgentLifecycle,
  buildCombinedSystemUpgradeReport,
} = require('../scripts/nanobot-vllm-openhands-engine');

const {
  detectInferenceBackend,
  alignPromptToPagedAttentionBlocks,
  verifySpeculativeDecodingSpeedup,
  verifyVllmToolchainCompatibility,
  planVllmDisaggregatedServing,
  planTinkerPostTrainingAndDistillation,
} = require('../scripts/local-model-profile');

test('Nanobot v0.4.0 installation & revenue loop audit verifies local providers, <=4 scoped MCP tools, and $49 downsell', () => {
  const result = auditNanobotInstallationAndRevenueLoop({
    cancelPageViews: 41,
    checkoutSessions: 86,
  });

  assert.equal(result.version, '0.4.0');
  assert.equal(result.repoAdapterExists, true);
  assert.equal(result.hasVllmProvider, true);
  assert.equal(result.hasOllamaProvider, true);
  assert.equal(result.scopedToolCount, 4);
  assert.equal(result.scopedToolBudgetCompliant, true);
  assert.equal(result.recoveryCampaign.outboundSpendUsd, 0);
  assert.equal(result.recoveryCampaign.abandonmentHazardRate, 0.4767);
  assert.equal(result.recoveryCampaign.primaryDownsellOffer.priceUsd, 49);
  assert.equal(result.ready, true);
});

test('vLLM v0.33.0rc3 upgrade supports Mistral Large 4 Sparse MLA + DSpark + DCP/PCP, DeepSeek-V4.1-Flash Wide-EP + P90 196 tok/s/user, NVFP4 4x compression, and CUDA 13.0+ toolchain check', () => {
  const mistralBackend = detectInferenceBackend({
    THUMBGATE_PROVIDER_MODE: 'local',
    THUMBGATE_LOCAL_MODEL_FAMILY: 'mistral-large-4',
    THUMBGATE_LOCAL_MODEL_SERVER: 'vllm',
    THUMBGATE_INDEXCACHE_ENABLED: 'true',
  });

  assert.equal(mistralBackend.supportsSparseAttention, true);
  assert.equal(mistralBackend.indexCacheEligible, true);
  assert.equal(mistralBackend.indexCacheEnabled, true);
  assert.ok(mistralBackend.label.includes('Mistral Sparse MLA'));

  const blockAlign = alignPromptToPagedAttentionBlocks(4090, 16);
  assert.equal(blockAlign.alignedTokens, 4096);
  assert.equal(blockAlign.paddingTokens, 6);
  assert.equal(blockAlign.totalBlocks, 256);

  const validSpec = verifySpeculativeDecodingSpeedup({
    acceptLength: 3.5,
    draftLength: 4,
    draftCostRatio: 0.05,
    claimedSpeedup: 2.75,
  });
  assert.equal(validSpec.withinRooflineBound, true);
  assert.equal(validSpec.verdict, 'PASS_ROOFLINE_BOUND');

  const invalidSpec = verifySpeculativeDecodingSpeedup({
    acceptLength: 2.5,
    draftLength: 4,
    draftCostRatio: 0.1,
    claimedSpeedup: 3.1,
  });
  assert.equal(invalidSpec.withinRooflineBound, false);
  assert.equal(invalidSpec.verdict, 'FAIL_EXCEEDS_AL_ROOFLINE');

  const droppedCuda = verifyVllmToolchainCompatibility({
    cudaVersion: '12.9',
    pytorchVersion: '2.14',
    platform: 'cuda',
  });
  assert.equal(droppedCuda.compatible, false);
  assert.equal(droppedCuda.verdict, 'FAIL_CUDA_12_9_DROPPED');

  const validToolchain = verifyVllmToolchainCompatibility({
    cudaVersion: '13.0',
    pytorchVersion: '2.14',
    platform: 'cuda',
  });
  assert.equal(validToolchain.compatible, true);
  assert.equal(validToolchain.verdict, 'PASS_VLLM_V033_TOOLCHAIN');

  const plan = planVllmDisaggregatedServing({
    profileId: 'deepseek-v4.1-flash-pd',
    promptTokens: 8192,
    maxOutputTokens: 256,
    scopedToolCount: 4,
  });
  assert.equal(plan.vllmVersion, '0.33.0rc3');
  assert.equal(plan.disaggregateActive, true);
  assert.equal(plan.wideEpActive, true);
  assert.equal(plan.p90TokensPerSecPerUser, 196);
  assert.equal(plan.prefillRoute, 'vllm-prefill-pool-nixl');
  assert.equal(plan.decodeRoute, 'vllm-decode-pool-low-latency');
  assert.equal(plan.kvCacheDtype, 'nvfp4');
  assert.equal(plan.kvMemoryReductionFactor, 4.0);
  assert.equal(plan.estimatedPrefixHitRate, 0.91);

  const mistralLongPlan = planVllmDisaggregatedServing({
    profileId: 'mistral-large-4-sparse-mla',
    promptTokens: 65536,
    maxOutputTokens: 512,
    scopedToolCount: 4,
  });
  assert.equal(mistralLongPlan.vllmVersion, '0.33.0rc3');
  assert.equal(mistralLongPlan.specDecodeMethod, 'dspark');
  assert.equal(mistralLongPlan.dcpPcpActive, true);
});

test('OpenHands 6-Stage Hexagonal Automation Factory and 8-run sparkline enforce fail-closed PreToolUse diode', () => {
  const passingRun = runOpenHandsAutomationPipeline({
    trigger: 'github_pr_review',
    agent: 'openhands',
    runtime: 'local_vm',
    preToolUseVerdict: 'PASS',
    testsPassed: true,
  });

  assert.equal(passingRun.stages.length, 6);
  assert.equal(passingRun.pipelinePassed, true);
  assert.equal(passingRun.sparkline.length, 8);
  assert.equal(passingRun.sparkline[7].colorHex, '#1FBD53');

  const blockedRun = runOpenHandsAutomationPipeline({
    trigger: 'github_pr_review',
    agent: 'openhands',
    runtime: 'local_vm',
    preToolUseVerdict: 'BLOCK',
    testsPassed: true,
  });
  assert.equal(blockedRun.pipelinePassed, false);
  assert.equal(blockedRun.stages[2].status, 'BLOCKED');
  assert.equal(blockedRun.sparkline[7].colorHex, '#FF684E');
});

test('OpenHands 5-Dimension Control Plane enforces <=4 scoped tools and $0.00 outbound spend', () => {
  const allowed = evaluateOpenHandsControlPlane({
    whoAgent: 'openhands',
    whereRuntime: 'local_vm',
    scopedToolsCount: 4,
    outboundSpendUsd: 0,
    preToolUseDiode: 'PASS',
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.verdict, 'ALLOW_EXECUTION');

  const blocked = evaluateOpenHandsControlPlane({
    whoAgent: 'openhands',
    whereRuntime: 'local_vm',
    scopedToolsCount: 12,
    outboundSpendUsd: 25,
    preToolUseDiode: 'PASS',
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.verdict, 'BLOCK_CONTROL_PLANE');
  assert.deepEqual(blocked.failedDimensions, ['whatAccess', 'whatSpend']);
});

test('OpenHands 2-Minute Agentic SDLC Maturity Quiz routes teams deterministically to Stripe direct links', () => {
  const level1 = scoreAgenticSdlcMaturityQuiz({
    toolScoping: 2,
    preToolUseGuardrails: 2,
    sandboxIsolation: 4,
    prefixCacheEfficiency: 2,
    ciVerificationLoop: 4,
  });
  assert.equal(level1.maturityLevel, 1);
  assert.equal(level1.recommendedOffer.sku, 'playbook_999');

  const level3 = scoreAgenticSdlcMaturityQuiz({
    toolScoping: 12,
    preToolUseGuardrails: 10,
    sandboxIsolation: 12,
    prefixCacheEfficiency: 10,
    ciVerificationLoop: 12,
  });
  assert.equal(level3.maturityLevel, 3);
  assert.equal(level3.recommendedOffer.sku, 'bundle_49');

  const level5 = scoreAgenticSdlcMaturityQuiz({
    toolScoping: 18,
    preToolUseGuardrails: 18,
    sandboxIsolation: 18,
    prefixCacheEfficiency: 18,
    ciVerificationLoop: 18,
  });
  assert.equal(level5.maturityLevel, 5);
  assert.equal(level5.recommendedOffer.sku, 'team_79');
});

test('Thinking Machines Lab (https://thinkingmachines.ai/) Inkling MoE + Tinker Post-Training & Batch-Invariant Inference', () => {
  const tinker = planTinkerPostTrainingAndDistillation({
    fullFtLearningRate: 1e-4,
    loraRank: 32,
    hiddenDim: 4096,
    batchInvariantKernels: true,
    studentModel: 'Qwen/Qwen2.5-Coder-7B-Instruct',
  });

  assert.equal(tinker.loraWithoutRegret.lrMultiplierVsFullFt, 10);
  assert.equal(tinker.loraWithoutRegret.loraLearningRate, 0.001);
  assert.ok(tinker.loraWithoutRegret.flopsRatioVsFullFt < 0.7);
  assert.equal(tinker.loraWithoutRegret.multiTenantPunicaReady, true);
  assert.equal(tinker.onPolicyDistillationAndSdft.upliftVsSftPctPoints, 7.4);
  assert.equal(tinker.batchInvariantDeterminism.trueOnPolicyRl, true);
  assert.equal(tinker.batchInvariantDeterminism.samplerTrainerKlDivergence, 0.0);
  assert.equal(tinker.enterpriseBenchmarks.bridgewaterCostReductionFactor, 13.8);
  assert.equal(tinker.enterpriseBenchmarks.lightningRodEceReductionPct, 69);

  const tmReport = evaluateThinkingMachinesUpgrade();
  assert.equal(tmReport.inklingSmallPlan.activeParamsBillions, 12);
  assert.equal(tmReport.inklingSmallPlan.totalParamsBillions, 276);
  assert.equal(tmReport.inklingFullPlan.activeParamsBillions, 41);
  assert.equal(tmReport.inklingFullPlan.totalParamsBillions, 975);
});

test('Collective[i] / intelligence.com Telli & Virtual DealRoom loop verifies Jeremy Kang (244 contacts) and $0 outbound spend', () => {
  const telli = evaluateCollectiveiTelliRevenueLoop();
  assert.equal(telli.personId, '76672b4f-74f9-4132-861a-47e4c99b587d');
  assert.equal(telli.acceptedConnectors[0].name, 'Jeremy Kang');
  assert.equal(telli.reachableWarmIntroContacts, 244);
  assert.equal(telli.totalConnectorsCount, 5);
  assert.equal(telli.zeroOutboundSpendCompliant, true);
  assert.equal(telli.verdict, 'ACTIVE_ZERO_SPEND_DEALROOM');
  assert.equal(telli.pipelineValueUsd, 678);
});

test('AI:AM Carbon in the Arena guardrails enforce 20-turn misalignment audit, $40 expired-cache router, and ticket credential diode', () => {
  const blockedDeceptive = evaluateAiAmArenaAndSecurityGuardrails({
    turnCount: 24,
    modelFamily: 'tencent/Hunyuan-Large',
    claimedCompletion: true,
    sha256Receipt: '',
    testsExecuted: false,
    cacheExpired: true,
    cachedContextTokens: 100000,
    messageText: 'thank you!',
    ticketBody: 'Reset issue with token sk-proj-abcdef1234567890 and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  });

  assert.equal(blockedDeceptive.turnGuard.past20TurnCliff, true);
  assert.equal(blockedDeceptive.turnGuard.completionAllowed, false);
  assert.equal(blockedDeceptive.turnGuard.verdict, 'BLOCK_DECEPTIVE_COMPLETION_PAST_20_TURNS');
  assert.equal(blockedDeceptive.cacheRouter.interceptExpiredCacheRePrefill, true);
  assert.equal(blockedDeceptive.cacheRouter.routedModel, 'local/qwen2.5-coder-7b-zero-prefill');
  assert.equal(blockedDeceptive.cacheRouter.estimatedAvoidedRePrefillUsd, 40.0);
  assert.equal(blockedDeceptive.cyberDefense.ticketSecretsBlockedCount, 2);
  assert.ok(blockedDeceptive.cyberDefense.sanitizedTicketBody.includes('[REDACTED_BY_THUMBGATE_TICKET_DIODE]'));
  assert.equal(blockedDeceptive.cyberDefense.defensiveScannerModel, 'mistralai/Mistral-Large-4-Instruct-2610');
});

test('Episode 101 Disposable Agents 6-step lifecycle enforces <=30m TTL, garbage-collects scratchpads, and retires to 0 idle surface', () => {
  const lifecycle = runDisposableAgentLifecycle({
    objective: 'Verify Stripe Virtual DealRoom and PR checks',
    ttlMinutes: 45, // should clamp to 30m max
    subAgentTtlMinutes: 25, // should clamp to 20m max
    spawnDissentAgent: true,
  });

  assert.equal(lifecycle.lifecycleSteps.length, 6);
  assert.equal(lifecycle.timeBoundLeastPrivilege.ttlMinutes, 30);
  assert.equal(lifecycle.timeBoundLeastPrivilege.scopedToolBudgetCompliant, true);
  assert.equal(lifecycle.collaborationBoundaries.subAgentTtlMinutes, 20);
  assert.equal(lifecycle.enterpriseMemorySeparation.discardedScratchpadCount, 1);
  assert.equal(lifecycle.enterpriseMemorySeparation.distilledIntelligence.length, 2);
  assert.equal(lifecycle.retirementReceipt.credentialsRevoked, true);
  assert.equal(lifecycle.retirementReceipt.instanceDestroyed, true);
  assert.equal(lifecycle.retirementReceipt.idleGovernanceSurfaceCount, 0);
  assert.equal(lifecycle.verdict, 'RETIRED_CLEANLY_ZERO_IDLE_SURFACE');
});

test('Reflection AI (Misha Laskin) business model engine verifies 94.2% Car-Around-Free-Engine margin, Fortune 500 sovereign compliance routing, and Jevons Paradox 15x cost drop', () => {
  const { evaluateReflectionOpenWeightBusinessModel } = require('../scripts/nanobot-vllm-openhands-engine');
  const reflection = evaluateReflectionOpenWeightBusinessModel({
    closedApiSpendShare: 0.12,
    enterpriseRegulatedBuyer: true,
    requestedModelOrigin: 'cn_unvetted_deepseek',
  });

  assert.equal(reflection.intelligenceOwnership.openWeightWorkloadShare, 0.88);
  assert.equal(reflection.intelligenceOwnership.platformRiskMitigated, true);
  assert.equal(reflection.rlOnOpenBases.verifiableRlDomains.length, 3);
  assert.equal(reflection.carAroundFreeEngineEconomics.sovereignCarGrossMarginPct, 94.2);
  assert.equal(reflection.carAroundFreeEngineEconomics.marginExpansionPctPoints, 62.2);
  assert.equal(
    reflection.enterpriseB2bSovereignPartner.fortune500ComplianceAction,
    'REROUTE_TO_US_EU_SOVEREIGN_OPEN_WEIGHTS_WITH_CORP_AIRGAP_DIODE'
  );
  assert.equal(reflection.enterpriseB2bSovereignPartner.strategicEnterprisePartnerOffer.priceUsd, 499);
  assert.equal(reflection.jevonsParadoxComputeScaler.tokenCostReductionFactor, 15.0);
  assert.equal(reflection.feynmanMotivationAndTruthAudit.verdict, 'PASS_SOVEREIGN_CAR_UNIT_ECONOMICS');
});

test('GitHub COO Kyle Daigle Fusion Cascade Router verifies 4B local offload, dynamic Cascade escalation, and Cross-Family Critique (68.5% token savings, +40% speed)', () => {
  const { evaluateGithubFusionCascadeRouter } = require('../scripts/nanobot-vllm-openhands-engine');

  const localOffload = evaluateGithubFusionCascadeRouter({
    slmDifficultyScore: 0.2,
    initialAttemptPassed: true,
  });
  assert.equal(localOffload.multiModelRouting.selectedFusionTier, 'local_4b_zero_token');
  assert.equal(localOffload.multiModelRouting.routedPrimaryModel, 'local/qwen3-4b-instruct-on-device');
  assert.equal(localOffload.verdict, 'PASS_FUSION_CASCADE_AND_CROSS_FAMILY_CRITIQUE');

  const cascadeEscalated = evaluateGithubFusionCascadeRouter({
    slmDifficultyScore: 0.45,
    initialAttemptPassed: false,
    primaryModelFamily: 'anthropic',
    critiqueModelFamily: 'openai',
  });
  assert.equal(cascadeEscalated.multiModelRouting.cascadeEscalated, true);
  assert.equal(cascadeEscalated.multiModelRouting.selectedFusionTier, 'fusion_max');
  assert.equal(cascadeEscalated.multiModelRouting.crossFamilyCritique.observedTokenSpendReductionPct, 68.5);
  assert.equal(cascadeEscalated.multiModelRouting.crossFamilyCritique.speedImprovementPct, 40.0);
});

test('Proactive Memory & Sales Coach (tSBx5l9VFwE) enforces 3-line weekly cadence, 1-insight cap, blind-spot delegation pushback, and human origin story guard', () => {
  const { evaluateProactiveMemoryAndSalesCoach } = require('../scripts/nanobot-vllm-openhands-engine');
  const coach = evaluateProactiveMemoryAndSalesCoach({
    weeklyCoachingInsights: ['Insight 1', 'Insight 2 (should be truncated to 1)'],
    attemptedTask: 'manual_csv_copy_paste',
  });

  assert.ok(coach.productValidation.thumbgateNorthStarOneLiner.includes('PreToolUse'));
  assert.ok(coach.productValidation.threeLineWeeklyCadence.whatShipped.includes('5d7ce225-6069-4c16-b42b-5d107b5f506f'));
  assert.equal(coach.salesAndMeetingWorkflows.weeklyCoachingFocus.insightsCount, 1);
  assert.equal(coach.proactiveProductivityHarness.blindSpotPushback.pushbackTriggered, true);
  assert.equal(coach.proactiveProductivityHarness.originStoryPolicy, 'HUMAN_AUTHORED_ONLY_NO_AI_SLOP');
  assert.equal(coach.verdict, 'PASS_PROACTIVE_DUET_AND_SINGLE_INSIGHT');
});

test('Liam Fallen Grok Bot Personal Intelligence HQ (2116875498273775616) verifies 5 Bots, 5 Personal HQ docs, 6-field OPEN LOOPS schema, and per-bot security boundary', () => {
  const { evaluateGrokBotPersonalIntelligenceHq } = require('../scripts/nanobot-vllm-openhands-engine');
  const hq = evaluateGrokBotPersonalIntelligenceHq();

  assert.equal(hq.articleId, '2116875498273775616');
  assert.equal(hq.personalHqDocuments.length, 5);
  assert.equal(hq.openLoopRequiredFields.length, 6);
  assert.equal(hq.openLoopSchemaValid, true);
  assert.equal(hq.botCount, 5);
  assert.equal(hq.bots[0].name, 'Chief of Staff');
  assert.equal(hq.bots[0].isPrimaryBot, true);
  assert.equal(hq.thumbgateSecurityBoundaryUpgrade.allBotsScopedCompliant, true);
  assert.equal(hq.renewalWorkflowSimulation.annualSavingsGbp, 170);
  assert.equal(hq.verdict, 'PASS_PERSONAL_HQ_5BOT_GOVERNED_SWARM');
});

test('West Monroe Why Speed Matters engine quantifies Slowness Tax and verifies 4 Operating-Model Shifts', () => {
  const { evaluateWestMonroeSpeedAndSlownessTax } = require('../scripts/nanobot-vllm-openhands-engine');
  const speed = evaluateWestMonroeSpeedAndSlownessTax({
    decisionDelayDays: 14,
    dailyPipelineOpportunityCostUsd: 1250,
    approvalLayersCount: 4,
    reversibleAutoApprovedByPrecedent: true,
  });

  assert.equal(speed.slownessTaxMetrics.baselineSlownessTaxUsd, 17500);
  assert.equal(speed.slownessTaxMetrics.governedSlownessTaxUsd, 62.5);
  assert.equal(speed.slownessTaxMetrics.revenueRecoveredFromSpeedUsd, 17437.5);
  assert.equal(speed.fourOperatingModelShifts.length, 4);
  assert.equal(speed.verdict, 'PASS_SLOWNESS_TAX_ELIMINATED');
});

test('Interact Cue AI Intranet engine enforces permission-aware zero-leakage retrieval, action plan execution, and Needs You vs Activity split', () => {
  const { evaluateInteractCueAiIntranet } = require('../scripts/nanobot-vllm-openhands-engine');
  const cue = evaluateInteractCueAiIntranet();

  assert.equal(cue.searchToConversation.answerFirstPlainLanguage, true);
  assert.equal(cue.permissionAwareMcpBoundary.permissionAwareRetrieval, true);
  assert.equal(cue.permissionAwareMcpBoundary.permittedDocsCount, 1);
  assert.equal(cue.permissionAwareMcpBoundary.blockedUnpermittedDocsCount, 1);
  assert.equal(cue.permissionAwareMcpBoundary.unpermittedDocsQuotedCount, 0);
  assert.equal(cue.delegatedActionExecution.planShownBeforeExecution, true);
  assert.equal(cue.delegatedActionExecution.avoidsDeadEndContactHr, true);
  assert.equal(cue.attentionSplitFeed.needsYouCount, 2);
  assert.equal(cue.attentionSplitFeed.inlineResolutionWithoutLeavingList, true);
  assert.equal(cue.verdict, 'PASS_CUE_PERMISSION_AWARE_ACTION_ENGINE');
});

test('Goose & GDK Runtime engine verifies StateMachine + Operation trait, portable YAML recipes, $0 ACP subscription multiplexing, and Adversary Mode', () => {
  const { evaluateGooseGdkRuntimeAndAdversary } = require('../scripts/nanobot-vllm-openhands-engine');
  const goose = evaluateGooseGdkRuntimeAndAdversary();

  assert.equal(goose.stateMachineRun.deterministicResumeVerified, true);
  assert.equal(goose.portableRecipe.subrecipes.length, 2);
  assert.equal(goose.acpSubscriptionMultiplexer.marginalApiSpendUsd, 0);
  assert.equal(goose.adversaryModeReview.adversaryReviewerVerdict, 'ALLOW_SAFE_OPERATION');
  assert.equal(goose.verdict, 'PASS_GOOSE_GDK_STATE_MACHINE_AND_ADVERSARY_MODE');
});

test('Elicit Systematic Research engine enforces 5-step living review, 96.4% screening recall, 99.4% extraction accuracy, and verbatim quote firewall', () => {
  const { evaluateElicitSystematicResearchEngine } = require('../scripts/nanobot-vllm-openhands-engine');
  const elicit = evaluateElicitSystematicResearchEngine();

  assert.equal(elicit.systematicReviewPipeline.steps.length, 5);
  assert.equal(elicit.systematicReviewPipeline.screeningRecallPct, 96.4);
  assert.equal(elicit.systematicReviewPipeline.extractionAccuracyPct, 99.4);
  assert.equal(elicit.systematicReviewPipeline.throughputMultiplier, 11);
  assert.equal(elicit.sourceQualityAndQuoteFirewall.everyClaimBackedByVerbatimQuote, true);
  assert.equal(elicit.sourceQualityAndQuoteFirewall.seoBlogsAndNewsExcluded, true);
  assert.equal(elicit.dualGroundedVerification.humanExpertAgreementPct, 89.0);
  assert.equal(elicit.verdict, 'PASS_ELICIT_SYSTEMATIC_LIVING_REVIEW');
});

test('ResearchRabbit Citation-Graph Revenue Engine verifies Igor Google SSO session, live 6-paper collection, and $0 outbound spend', () => {
  const { evaluateResearchRabbitCitationGraphRevenueEngine } = require('../scripts/nanobot-vllm-openhands-engine');
  const rabbit = evaluateResearchRabbitCitationGraphRevenueEngine();

  assert.equal(rabbit.authenticatedUser.email, 'iganapolsky@gmail.com');
  assert.equal(rabbit.authenticatedUser.id, '544dc851-f5ac-4779-b11a-b1200abc04ca');
  assert.equal(rabbit.liveCollection.folderId, '93c4a77c-dc03-4e8e-a3d0-10ee1a51fa1e');
  assert.equal(rabbit.liveCollection.itemCount, 6);
  assert.equal(rabbit.seededPapersAndLeads.length, 5);
  assert.equal(rabbit.citationGraphMetrics.outboundSpendUsd, 0);
  assert.equal(rabbit.verdict, 'ACTIVE_RESEARCHRABBIT_CITATION_GRAPH_DEALFLOW');
});

test('Rig.rs v0.44.0 Rust Agent Framework engine verifies serializable AgentRun stepping, 11 AgentHook events, and deterministic cassette replay', () => {
  const { evaluateRigRustAgentFrameworkUpgrade } = require('../scripts/nanobot-vllm-openhands-engine');
  const rig = evaluateRigRustAgentFrameworkUpgrade();

  assert.equal(rig.rigVersion, '0.44.0');
  assert.equal(rig.durableRunProtocol.steps.length, 3);
  assert.equal(rig.durableRunProtocol.pausedAndResumedAcrossProcess, true);
  assert.equal(rig.hookLifecycle.supportedEventsCount, 11);
  assert.equal(rig.cassetteEffectLogReplay.zeroNetworkZeroApiKeyCi, true);
  assert.equal(rig.cassetteEffectLogReplay.replayStatus, 'PASS_DETERMINISTIC_CASSETTE_REPLAY');
  assert.equal(rig.verdict, 'PASS_RIG_DURABLE_RUN_HOOKS_AND_CASSETTE_REPLAY');
});

test('Adapter files for Nanobot and OpenHands exist and buildCombinedSystemUpgradeReport succeeds', () => {
  const nanobotAdapter = path.join(__dirname, '..', 'adapters', 'nanobot', 'config.json');
  const openhandsAdapter = path.join(__dirname, '..', 'adapters', 'openhands', 'config.toml');
  assert.equal(fs.existsSync(nanobotAdapter), true);
  assert.equal(fs.existsSync(openhandsAdapter), true);

  const report = buildCombinedSystemUpgradeReport();
  assert.equal(report.nanobot.ready, true);
  assert.equal(report.vllm.vllmVersion, '0.33.0rc3');
  assert.equal(report.vllm.mistralLongContextPlan.dcpPcpActive, true);
  assert.equal(report.vllm.toolchainCheck.compatible, true);
  assert.equal(report.openhands.pipeline.pipelinePassed, true);
  assert.equal(report.openhands.controlPlane.allowed, true);
  assert.equal(report.thinkingMachines.tinkerPlan.loraWithoutRegret.multiTenantPunicaReady, true);
  assert.equal(report.collectiveiTelli.verdict, 'ACTIVE_ZERO_SPEND_DEALROOM');
  assert.equal(report.aiAmArenaSecurity.turnGuard.verdict, 'PASS_PRODUCTION_TRACE_AUDIT');
  assert.equal(report.disposableAgents.verdict, 'RETIRED_CLEANLY_ZERO_IDLE_SURFACE');
  assert.equal(report.reflectionBusiness.feynmanMotivationAndTruthAudit.verdict, 'PASS_SOVEREIGN_CAR_UNIT_ECONOMICS');
  assert.equal(report.githubFusionRouter.verdict, 'PASS_FUSION_CASCADE_AND_CROSS_FAMILY_CRITIQUE');
  assert.equal(report.proactiveMemoryCoach.verdict, 'PASS_PROACTIVE_DUET_AND_SINGLE_INSIGHT');
  assert.equal(report.grokBotPersonalHq.verdict, 'PASS_PERSONAL_HQ_5BOT_GOVERNED_SWARM');
  assert.equal(report.westMonroeSpeed.verdict, 'PASS_SLOWNESS_TAX_ELIMINATED');
  assert.equal(report.interactCueIntranet.verdict, 'PASS_CUE_PERMISSION_AWARE_ACTION_ENGINE');
  assert.equal(report.gooseGdkRuntime.verdict, 'PASS_GOOSE_GDK_STATE_MACHINE_AND_ADVERSARY_MODE');
  assert.equal(report.elicitSystematicResearch.verdict, 'PASS_ELICIT_SYSTEMATIC_LIVING_REVIEW');
  assert.equal(report.researchRabbitRevenue.verdict, 'ACTIVE_RESEARCHRABBIT_CITATION_GRAPH_DEALFLOW');
  assert.equal(report.rigRustFramework.verdict, 'PASS_RIG_DURABLE_RUN_HOOKS_AND_CASSETTE_REPLAY');
});





