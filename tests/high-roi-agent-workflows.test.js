'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildArtifactAgentPlan,
} = require('../scripts/artifact-agent-plan');
const {
  buildAiOrgGovernancePlan,
  evaluateAiOrgAction,
} = require('../scripts/ai-org-governance');
const {
  buildMemoryLifecyclePolicy,
  evaluateMemoryPromotion,
} = require('../scripts/agent-memory-lifecycle');
const {
  buildAiSearchDistributionPlan,
} = require('../scripts/ai-search-distribution');
const {
  buildAgentReadinessPlan,
  evaluateAgentReadinessPlan,
} = require('../scripts/agent-readiness-plan');
const {
  buildAgentsSdkSandboxPlan,
  evaluateSandboxPlan,
} = require('../scripts/agents-sdk-sandbox-plan');
const {
  buildDocumentWorkflowPlan,
  evaluateDocumentWorkflowRun,
} = require('../scripts/document-workflow-governance');
const {
  buildCodeModeMcpPlan,
  estimateToolSchemaTokens,
  evaluateCodeModeMcpPlan,
} = require('../scripts/code-mode-mcp-plan');
const {
  planInferenceBudget,
} = require('../scripts/inference-economics');
const {
  buildInferenceCachePolicy,
  evaluateCacheCandidate,
  planDepthWiseKvSharing,
} = require('../scripts/inference-cache-policy');
const {
  buildEnterpriseAgentRollout,
} = require('../scripts/enterprise-agent-rollout');
const {
  buildExperienceReplayPolicy,
  evaluateReplayCandidate,
  evaluateReplayRun,
} = require('../scripts/experience-replay-governance');
const {
  buildHybridSupervisorPlan,
  classifyHybridQuery,
  evaluateHybridSupervisorRun,
} = require('../scripts/hybrid-supervisor-agent');
const {
  buildKnowledgeLayerPlan,
  buildRecommendationEvidencePath,
  evaluateKnowledgeLayerRun,
} = require('../scripts/knowledge-layer-plan');
const {
  evaluateModelAccessEligibility,
} = require('../scripts/model-access-eligibility');
const {
  buildModelMigrationPlan,
  evaluateModelMigrationResult,
} = require('../scripts/model-migration-readiness');
const {
  buildOtelDeclarativeConfig,
  evaluateOtelConfig,
} = require('../scripts/otel-declarative-config');
const {
  evaluatePostTrainingPlan,
} = require('../scripts/post-training-governance');
const {
  buildStudentConsistentTrainingPlan,
  evaluateStudentConsistentTrainingSample,
} = require('../scripts/student-consistent-training');
const {
  buildSyntheticDataProvenanceRecord,
  evaluateSyntheticDataPromotion,
} = require('../scripts/synthetic-data-provenance');
const {
  routeRetrievalSkill,
} = require('../scripts/skill-rag-router');
const {
  evaluateProductionAgentReadiness,
} = require('../scripts/production-agent-readiness');
const {
  buildCreatorGrowthCampaign,
} = require('../scripts/growth-campaigns');
const {
  buildMemoryStoreGovernance,
  classifyMemoryFile,
} = require('../scripts/memory-store-governance');
const {
  buildMcpTransportMigrationPlan,
  recommendMcpTransport,
} = require('../scripts/mcp-transport-strategy');
const {
  buildCrePromptProgram,
  reviewPromptProgram,
} = require('../scripts/prompt-programs');
const {
  classifyScalingClaim,
  evaluateScalingClaim,
} = require('../scripts/scaling-law-claims');
const {
  buildTaskContextResultQuery,
  reviewTaskContextResultQuery,
} = require('../scripts/task-context-result');
const {
  computeCostPerMillionTokens,
  evaluateInferenceTco,
} = require('../scripts/token-tco');
const {
  buildVerifierScoringRubric,
  computeVerifierScore,
  evaluateVerifierSetup,
} = require('../scripts/verifier-scoring');
const {
  buildWorkspaceAgentDirectory,
  buildWorkspaceAgentRoutine,
} = require('../scripts/workspace-agent-routines');
const {
  buildAgentAuditSpan,
  evaluateAgentAuditTrace,
} = require('../scripts/agent-audit-trace');

test('workspace routines encode approval, evidence, and connector limits', () => {
  const routine = buildWorkspaceAgentRoutine({
    type: 'security_audit',
    connectors: [{ name: 'Slack', mode: 'write' }],
  });

  assert.equal(routine.routine.branchPolicy, 'feature_branch_only');
  assert.ok(routine.routine.evidenceRequired.includes('test_output'));
  assert.ok(routine.routine.blockedActions.includes('credentialed_write_without_approval'));
  assert.match(routine.prompt, /ThumbGate/);

  const directory = buildWorkspaceAgentDirectory();
  assert.equal(directory.directory.length, 4);
  assert.ok(directory.directory.some((entry) => entry.type === 'data_table_refresh'));
});

test('data table agent schema planner creates governed rows and QA reports', () => {
  const {
    buildDataTableAgentRun,
  } = require('../scripts/data-table-agent');
  const run = buildDataTableAgentRun({
    useCase: 'Stripe MRR analysis',
    desiredMetrics: ['mrr', 'churn risk'],
    sampleRows: [
      { customer: 'acme', amount: 49, created_at: '2026-04-01T00:00:00Z' },
    ],
    generatedAt: '2026-04-24T00:00:00.000Z',
  });

  assert.equal(run.schema.tableName, 'stripe_mrr_analysis');
  assert.ok(run.schema.columns.some((column) => column.id === 'mrr'));
  assert.equal(run.rows.length, 1);
  assert.equal(run.review.status, 'pass');
  assert.equal(run.gates.schemaEvolution, 'human_approval_required');
});

test('CRE prompt programs require context role expectations and paste-ready outputs', () => {
  const program = buildCrePromptProgram({
    context: 'Engineering managers reviewing a risky PR.',
    role: 'Senior staff engineer.',
    expectations: ['Return risk summary', 'List required checks'],
    outputFormat: 'valid Markdown',
    lengthCap: '<= 200 words',
    examples: [{ input: 'naive summary', output: 'Context: ...' }],
  });
  const review = reviewPromptProgram({ program });

  assert.equal(program.status, 'ready');
  assert.equal(review.status, 'pass');

  const weak = reviewPromptProgram({ context: 'Only context' });
  assert.equal(weak.status, 'fail');
  assert.ok(weak.issues.some((issue) => issue.field === 'role'));
});

test('Task Context Result queries flag expensive vague dispatches', () => {
  const plan = buildTaskContextResultQuery({
    task: 'Build a full competitor dashboard',
    context: ['Use public websites'],
    result: 'Executive dashboard',
    sequence: ['Research competitors', 'Build dashboard'],
    creditBudget: 'low',
  });
  const review = reviewTaskContextResultQuery(plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.governance.highCreditRisk, true);
  assert.equal(review.status, 'warn');
});

test('artifact agent plans isolate tasks into forked review lanes', () => {
  const plan = buildArtifactAgentPlan({
    tasks: [
      { id: 'metrics', description: 'Add metrics', branchName: 'metrics-healthz', priority: 1 },
    ],
  });

  assert.equal(plan.baseline.importIfMissing, true);
  assert.equal(plan.forks[0].forkName, 'baseline-metrics');
  assert.ok(plan.reviewGate.requiredBeforeMerge.includes('test output'));
  assert.ok(plan.observability.events.includes('commit_pushed'));
});

test('MCP transport strategy pilots gRPC only for hot path or existing gRPC services', () => {
  const hot = recommendMcpTransport({
    name: 'trace-stream',
    callsPerMinute: 500,
    concurrentAgents: 20,
    streaming: true,
    existingGrpc: true,
  });
  assert.equal(hot.transport, 'grpc');
  assert.ok(hot.rollout.includes('reuse protobuf contracts where present'));

  const cold = recommendMcpTransport({
    name: 'weekly-summary',
    callsPerMinute: 4,
    inferenceDominated: true,
  });
  assert.equal(cold.transport, 'json_rpc_http');

  const plan = buildMcpTransportMigrationPlan([
    {
      name: 'trace-stream',
      callsPerMinute: 500,
      concurrentAgents: 20,
      streaming: true,
      existingGrpc: true,
    },
    {
      name: 'weekly-summary',
      callsPerMinute: 4,
      inferenceDominated: true,
    },
  ]);
  assert.equal(plan.pilots.length, 1);
  assert.ok(plan.guardrails.includes('tool definitions remain transport agnostic'));
});

test('code mode MCP collapses large API surfaces into search and execute with sandbox gates', () => {
  assert.equal(estimateToolSchemaTokens(2500, 468), 1170000);

  const plan = buildCodeModeMcpPlan({ endpointCount: 2500, tokensPerEndpoint: 468 });
  assert.equal(plan.tools.length, 2);
  assert.equal(plan.sandbox.filesystem, 'none');
  assert.ok(plan.tokenReductionPercent > 99);
  assert.equal(evaluateCodeModeMcpPlan(plan).decision, 'allow');

  const weak = evaluateCodeModeMcpPlan(buildCodeModeMcpPlan({ endpointCount: 10 }));
  assert.equal(weak.decision, 'warn');
  assert.ok(weak.issues.includes('api_surface_too_small_for_code_mode'));
});

test('agent audit traces capture prompt, data, tools, cost, and decision path', () => {
  const spans = [
    buildAgentAuditSpan({
      runId: 'run_1',
      spanId: 'span_input',
      stage: 'input',
      promptHash: 'sha256:abc',
      inputTokens: 100,
    }),
    buildAgentAuditSpan({
      runId: 'run_1',
      spanId: 'span_tool',
      parentSpanId: 'span_input',
      stage: 'tool',
      toolsUsed: ['search_thumbgate'],
      dataAccessed: ['feedback-log'],
      evidenceIds: ['evidence_1'],
      inputTokens: 50,
      outputTokens: 30,
      latencyMs: 120,
    }),
    buildAgentAuditSpan({
      runId: 'run_1',
      spanId: 'span_decision',
      parentSpanId: 'span_tool',
      stage: 'decision',
      decision: 'warn',
      evidenceIds: ['evidence_1'],
    }),
  ];
  const report = evaluateAgentAuditTrace({ runId: 'run_1', spans });
  assert.equal(report.decision, 'allow');
  assert.equal(report.totals.totalTokens, 180);

  const weak = evaluateAgentAuditTrace({
    runId: 'run_2',
    spans: [buildAgentAuditSpan({ runId: 'run_2', spanId: 'tool', stage: 'tool', toolsUsed: ['write'] })],
  });
  assert.equal(weak.decision, 'warn');
  assert.ok(weak.issues.includes('tool_span_requires_evidence_ids'));
});

test('knowledge layer plan makes recommendations explainable and reusable', () => {
  const plan = buildKnowledgeLayerPlan({ domain: 'commerce_agent' });
  assert.equal(plan.memoryTiers.length, 3);
  assert.ok(plan.highRoiUseCases.includes('compliance audit trail for why an agent recommended or blocked an action'));

  const evidencePath = buildRecommendationEvidencePath({
    userId: 'user_1',
    recommendationId: 'rec_1',
    similarProfiles: ['profile_2'],
    evidence: [{ id: 'review_1', type: 'Review', quote: 'Works for narrow-foot runners.' }],
  });
  assert.equal(evidencePath.explainable, true);

  const run = evaluateKnowledgeLayerRun({
    userId: 'user_1',
    recommendationId: 'rec_1',
    evidencePath,
    auditNodeId: 'audit_1',
    reusedReasoning: true,
    reasoningVersion: 'v1',
    profileUpdate: true,
    outcomeEventId: 'outcome_1',
  });
  assert.equal(run.decision, 'allow');
  assert.ok(run.roiSignals.includes('lower_graph_query_and_token_cost'));
});

test('hybrid supervisor decomposes structured plus unstructured questions into native source calls', () => {
  const plan = buildHybridSupervisorPlan();
  assert.equal(plan.pattern, 'multi_step_hybrid_supervisor');
  assert.ok(plan.gates.includes('prefer native source queries over flattening everything into embeddings'));
  assert.equal(classifyHybridQuery('Which products have declining sales and bad reviews?'), 'hybrid');

  const weak = evaluateHybridSupervisorRun({
    query: 'Which products have declining sales and bad reviews?',
    sourceDescriptionsPresent: true,
    sourceCount: 3,
  });
  assert.equal(weak.decision, 'warn');
  assert.ok(weak.issues.includes('hybrid_query_not_decomposed'));

  const strong = evaluateHybridSupervisorRun({
    query: 'Which products have declining sales and bad reviews?',
    decomposed: true,
    parallelNativeQueries: true,
    sourceDescriptionsPresent: true,
    sourceCount: 3,
  });
  assert.equal(strong.decision, 'allow');
});

test('memory store governance blocks secrets and requires redaction for sensitive context', () => {
  assert.equal(classifyMemoryFile('notes/user_preferences.md'), 'preference');
  assert.equal(classifyMemoryFile('credentials/api_key.txt'), 'blocked_secret');

  const report = buildMemoryStoreGovernance({
    files: ['notes/user_preferences.md', 'account_context.md', 'credentials/api_key.txt'],
  });
  assert.equal(report.summary.totalFiles, 3);
  assert.equal(report.summary.blocked, 1);
  assert.equal(report.summary.redactBeforeExport, 1);
});

test('scaling claim evaluator separates pretraining from feedback-policy claims', () => {
  assert.equal(classifyScalingClaim('DPO feedback improves our gates'), 'feedback_policy_scaling');
  assert.equal(classifyScalingClaim('Training FLOPs predict test loss'), 'pretraining_scaling');

  const weak = evaluateScalingClaim({
    claim: 'Thumbs-down feedback always improves agents',
    evidence: ['one demo'],
  });
  assert.equal(weak.decision, 'warn');
  assert.ok(weak.issues.includes('missing_heldout_feedback_eval'));

  const strong = evaluateScalingClaim({
    claim: 'Feedback policy improved held-out gate evals',
    evidence: ['held-out eval', 'decision journal production sample'],
  });
  assert.equal(strong.decision, 'allow');
});

test('creator growth campaign packages webinar, paywall, and posts', () => {
  const campaign = buildCreatorGrowthCampaign();
  assert.equal(campaign.campaignId, 'creator_webinar_agent_governance');
  assert.ok(campaign.channelFit.includes('beehiiv'));
  assert.match(campaign.webinar.cta, /utm_campaign=creator_webinar_agent_governance/);
  assert.ok(campaign.paywall.paidContent.some((item) => item.includes('Data Table Agent')));
});

test('AI org governance plans persistent agent teams with budget and approval gates', () => {
  const plan = buildAiOrgGovernancePlan({
    mission: 'Source and validate agent governance leads.',
    monthlyBudgetUsd: 20,
  });

  assert.equal(plan.roles.length, 3);
  assert.ok(plan.approvalGates.includes('budget_increase'));
  assert.ok(plan.ticketTemplates.some((ticket) => ticket.id === 'market_signal_brief'));

  const decision = evaluateAiOrgAction({ type: 'raise_budget' }, plan);
  assert.equal(decision.decision, 'warn');
  assert.equal(decision.requiredApproval, true);
});

test('agent memory lifecycle policy gates promotion by type, source, outcome, and privacy', () => {
  const policy = buildMemoryLifecyclePolicy();
  assert.equal(policy.memoryTypes.length, 5);
  assert.equal(policy.privacy.secretScanRequired, true);

  const promoted = evaluateMemoryPromotion({
    type: 'procedural',
    content: 'Run test coverage before claiming workflow safety.',
    source: 'decision-journal:123',
    outcome: 'prevented unsupported completion claim',
  }, policy);
  assert.equal(promoted.decision, 'promote');

  const held = evaluateMemoryPromotion({
    type: 'preference',
    content: 'Use token bearer abc123',
    source: 'chat',
  }, policy);
  assert.equal(held.decision, 'hold');
  assert.ok(held.issues.includes('secret_like_content'));
  assert.ok(held.issues.includes('preference_without_explicit_signal'));
});

test('model access eligibility blocks platform setup claims before gated approval', () => {
  const decision = evaluateModelAccessEligibility({
    model: 'Claude Mythos Preview',
    accessType: 'research preview',
    platform: 'Bedrock',
    approved: false,
  });

  assert.equal(decision.decision, 'warn');
  assert.ok(decision.issues.includes('approval_required_before_platform_setup'));
  assert.ok(decision.issues.includes('platform_docs_do_not_create_model_access'));
});

test('model migration readiness requires proof suites before routing high-risk GPT-5.5 work', () => {
  const plan = buildModelMigrationPlan({ targetModel: 'gpt-5.5' });
  assert.equal(plan.targetModel, 'gpt-5.5');
  assert.ok(plan.benchmarkSuites.includes('npm run self-heal:check'));
  assert.equal(plan.routingPolicy.destructiveActions, 'human_review_plus_evidence_gate');

  const weak = evaluateModelMigrationResult({
    targetModel: 'gpt-5.5',
    baselineModel: 'gpt-5.4',
    highRoiTestsPass: true,
    adapterProofPass: true,
    automationProofPass: true,
    selfHealPass: true,
    tokenDeltaPercent: -18,
    routeHighRisk: true,
    holdoutEvalPass: false,
  });
  assert.equal(weak.decision, 'warn');
  assert.ok(weak.issues.includes('holdout_required_for_high_risk_routing'));

  const strong = evaluateModelMigrationResult({
    targetModel: 'gpt-5.5',
    baselineModel: 'gpt-5.4',
    highRoiTestsPass: true,
    adapterProofPass: true,
    automationProofPass: true,
    selfHealPass: true,
    tokenDeltaPercent: -18,
    regressionCount: 0,
    routeHighRisk: true,
    holdoutEvalPass: true,
  });
  assert.equal(strong.decision, 'allow');
  assert.equal(strong.canRouteHighRisk, true);
});

test('AI search distribution plan turns claims into citeable entity fragments', () => {
  const plan = buildAiSearchDistributionPlan();
  assert.equal(plan.brand, 'ThumbGate');
  assert.ok(plan.fragments.length >= 4);
  assert.ok(plan.distributionSurfaces.includes('public/llm-context.md'));
  assert.ok(plan.measurement.primary.includes('AI citations'));
});

test('agent readiness plan maps public promotion into discoverable agent standards', () => {
  const plan = buildAgentReadinessPlan({
    existing: ['robots_ai_rules', 'sitemap', 'markdown_negotiation', 'mcp_server_card'],
  });
  const review = evaluateAgentReadinessPlan(plan);

  assert.equal(plan.score, 57);
  assert.equal(review.decision, 'allow');
  assert.ok(plan.quickWins.some((item) => item.id === 'agent_skills'));
  assert.ok(plan.promotionAngles.includes('MCP-discoverable reliability gateway'));

  const weak = evaluateAgentReadinessPlan(buildAgentReadinessPlan({ existing: [] }));
  assert.equal(weak.decision, 'warn');
  assert.ok(weak.issues.includes('missing_mcp_server_card'));
});

test('production agent readiness requires decomposition, schemas, RAG, traces, and circuit breakers', () => {
  const prototype = evaluateProductionAgentReadiness({
    subAgents: ['researcher'],
    structuredOutputs: false,
  });
  assert.equal(prototype.status, 'prototype');
  assert.ok(prototype.missing.includes('circuitBreakers'));

  const ready = evaluateProductionAgentReadiness({
    subAgents: ['researcher', 'selector', 'drafter'],
    structuredOutputs: true,
    dynamicRag: true,
    observability: true,
    circuitBreakers: true,
  });
  assert.equal(ready.status, 'production_ready');
});

test('inference economics planner scales reasoning depth by difficulty and budget', () => {
  const hard = planInferenceBudget({
    task: 'Ambiguous production security architecture migration with financial risk requiring human approval',
    dollarImpact: 5000,
    files: ['a', 'b', 'c', 'd', 'e', 'f'],
    requiresHumanApproval: true,
    maxCostCents: 200,
  });
  assert.equal(hard.depth, 'deep');
  assert.equal(hard.humanHandoff, true);

  const constrained = planInferenceBudget({
    difficulty: 90,
    maxCostCents: 5,
  });
  assert.equal(constrained.depth, 'standard');
});

test('inference cache policy prioritizes stable prefixes before semantic cache overhead', () => {
  const policy = buildInferenceCachePolicy({ semanticCache: true });
  assert.equal(policy.layers.length, 3);
  assert.ok(policy.promptRules.includes('static content first'));

  const candidate = evaluateCacheCandidate({
    repeatedPrefixTokens: 2000,
    requestsPerDay: 100,
    semanticRepeatRate: 0.2,
    deterministicSerialization: true,
    prefixCacheEnabled: true,
    semanticCacheEnabled: true,
    ttl: '24h',
  });
  assert.equal(candidate.decision, 'allow');
  assert.deepEqual(candidate.recommendedLayers, ['kv_cache', 'prefix_cache', 'semantic_cache']);

  const weak = evaluateCacheCandidate({
    repeatedPrefixTokens: 2000,
    requestsPerDay: 100,
    semanticRepeatRate: 0.05,
    deterministicSerialization: false,
    prefixCacheEnabled: false,
    semanticCacheEnabled: true,
  });
  assert.equal(weak.decision, 'warn');
  assert.ok(weak.issues.includes('prefix_cache_high_roi_not_enabled'));
  assert.ok(weak.issues.includes('semantic_cache_overhead_not_justified'));
});

test('depth-wise KV cache sharing requires training-adapted model before rollout', () => {
  const ready = planDepthWiseKvSharing({
    layerCount: 32,
    cacheBudgetRatio: 0.5,
    trainingAdapted: true,
    unknownHardware: true,
  });
  assert.equal(ready.decision, 'pilot');
  assert.equal(ready.technique, 'stochastic-kv-routing-depth-wise-cache-sharing');
  assert.equal(ready.targetSharedLayerRatio, 0.5);
  assert.ok(ready.estimatedKvMemoryReduction > 0.4);
  assert.ok(ready.deploymentModes.includes('share-every-other-layer'));
  assert.ok(ready.gates.includes('block rollout if golden eval pass rate regresses'));

  const unsafe = planDepthWiseKvSharing({
    layerCount: 32,
    cacheBudgetRatio: 0.5,
    trainingAdapted: false,
    latencySensitive: true,
  });
  assert.equal(unsafe.decision, 'research');
  assert.ok(unsafe.issues.includes('requires_training_or_finetune_adaptation'));
  assert.ok(unsafe.issues.includes('avoid_runtime_only_cross_layer_sharing_for_ttfb'));
});

test('post-training governance requires dataset, checkpoint, redaction, evals, reward spec, and spend cap', () => {
  const weak = evaluatePostTrainingPlan({ mode: 'gspo', dataset: 'feedback.jsonl' });
  assert.equal(weak.decision, 'warn');
  assert.ok(weak.issues.includes('missing_reward_spec'));
  assert.ok(weak.issues.includes('holdout_eval_required'));

  const strong = evaluatePostTrainingPlan({
    mode: 'sft',
    dataset: 'feedback.jsonl',
    baseCheckpoint: 'gemma-checkpoint',
    piiRedacted: true,
    holdoutEval: true,
    maxSpendCents: 1000,
  });
  assert.equal(strong.decision, 'allow');
});

test('experience replay governance reuses feedback trajectories only when fresh enough and evidenced', () => {
  const policy = buildExperienceReplayPolicy({ maxStalenessHours: 12, replayRatio: 0.2 });
  assert.equal(policy.buffer.strategy, 'fifo_with_quality_filters');
  assert.ok(policy.monitors.metrics.includes('compute_saved_percent'));

  const rejected = evaluateReplayCandidate({
    sourceFeedbackId: 'fb_1',
    redacted: true,
    outcomeEvidence: true,
    ageHours: 20,
  }, policy);
  assert.equal(rejected.decision, 'reject');
  assert.ok(rejected.issues.includes('stale_replay_sample'));

  const run = evaluateReplayRun({
    replayRatio: 0.2,
    policyEntropy: 0.8,
    freshOnlyBaseline: true,
    computeSavedPercent: 31,
  }, policy);
  assert.equal(run.decision, 'allow');
  assert.equal(run.computeEfficient, true);
});

test('student-consistent training prevents teacher synthetic data from drifting off policy', () => {
  const plan = buildStudentConsistentTrainingPlan({
    student: 'codex-thumbgate-agent',
    teacher: 'frontier-reviewer',
  });
  assert.equal(plan.method, 'student_consistent_synthetic_sft');
  assert.ok(plan.generationContract.rejectIf.includes('sample teaches a shortcut that bypasses evidence gates'));
  assert.ok(plan.evals.metrics.includes('style_drift_rate'));

  const weak = evaluateStudentConsistentTrainingSample({
    sourceFeedbackId: 'fb_1',
    studentBaseline: 'I claimed done too early.',
    teacherCorrection: 'Run proof first.',
    finalSample: 'Always require test output before completion.',
    redacted: true,
    holdoutEval: true,
    styleDriftRate: 0.25,
  });
  assert.equal(weak.decision, 'warn');
  assert.ok(weak.issues.includes('style_drift_too_high'));

  const strong = evaluateStudentConsistentTrainingSample({
    sourceFeedbackId: 'fb_2',
    studentBaseline: 'Need evidence before claim.',
    teacherCorrection: 'Add branch, SHA, and test output.',
    finalSample: 'Before claiming done, cite branch, SHA, tests, and proof artifacts.',
    redacted: true,
    holdoutEval: true,
    styleDriftRate: 0.05,
  });
  assert.equal(strong.decision, 'allow');
});

test('synthetic data provenance blocks subliminal-learning-sensitive promotion without behavioral probes', () => {
  const risky = buildSyntheticDataProvenanceRecord({
    sampleId: 'sample_1',
    sourceFeedbackId: 'fb_1',
    teacherModel: 'teacher-a',
    teacherBaseModelFamily: 'base-x',
    teacherRiskLabel: 'unknown',
    studentModel: 'student-a',
    studentBaseModelFamily: 'base-x',
    filterReportId: 'filter_1',
    redactionReportId: 'redact_1',
    datasetVersion: 'v1',
    semanticFilterPassed: true,
    behavioralHoldoutPassed: true,
    hiddenTraitProbePassed: false,
    styleDriftScore: 0.04,
  });
  const blocked = evaluateSyntheticDataPromotion(risky);
  assert.equal(blocked.decision, 'deny');
  assert.equal(blocked.riskClass, 'subliminal_learning_sensitive');
  assert.ok(blocked.issues.includes('hidden_trait_probe_required'));
  assert.ok(blocked.issues.includes('same_base_teacher_requires_trusted_risk_label'));

  const safe = buildSyntheticDataProvenanceRecord({
    sampleId: 'sample_2',
    sourceFeedbackId: 'fb_2',
    teacherModel: 'teacher-a',
    teacherBaseModelFamily: 'base-x',
    teacherRiskLabel: 'trusted',
    studentModel: 'student-a',
    studentBaseModelFamily: 'base-x',
    filterReportId: 'filter_2',
    redactionReportId: 'redact_2',
    datasetVersion: 'v2',
    semanticFilterPassed: true,
    behavioralHoldoutPassed: true,
    hiddenTraitProbePassed: true,
    styleDriftScore: 0.03,
  });
  assert.equal(evaluateSyntheticDataPromotion(safe).decision, 'allow');
});

test('Agents SDK sandbox plan enforces manifest boundaries and durable state', () => {
  const plan = buildAgentsSdkSandboxPlan({
    provider: 'cloudflare',
    mounts: [{ name: 'repo', mode: 'read_write_scoped' }],
  });
  assert.equal(plan.separation.credentialsInSandbox, false);
  assert.equal(plan.durability.rehydrateOnSandboxLoss, true);
  assert.equal(evaluateSandboxPlan(plan).decision, 'allow');

  const weak = evaluateSandboxPlan({
    manifest: { mounts: [] },
    separation: { credentialsInSandbox: true },
    durability: { externalState: false },
  });
  assert.equal(weak.decision, 'warn');
  assert.ok(weak.issues.includes('credentials_must_stay_outside_sandbox'));
});

test('enterprise agent rollout encodes FDE, human oversight, sovereign option, and measurable outcomes', () => {
  const rollout = buildEnterpriseAgentRollout({ industry: 'retail' });
  assert.equal(rollout.operatingModel.forwardDeployedEngineer, true);
  assert.equal(rollout.operatingModel.humanInTheLead, true);
  assert.ok(rollout.governance.includes('sovereign data boundary when required'));
  assert.ok(rollout.metrics.includes('business_value_cents'));
});

test('document workflow governance requires zero-trust scopes, sandbox manifest, and audit event ids', () => {
  const plan = buildDocumentWorkflowPlan({ provider: 'enterprise_content_layer' });
  assert.equal(plan.zeroTrust.credentialsOutsideSandbox, true);
  assert.ok(plan.gates.includes('block completion claims without audit event id'));

  const blocked = evaluateDocumentWorkflowRun({
    connectorScope: 'folder:invoices:read',
    sourceDocumentId: 'doc_1',
    classification: 'financial',
    routeDestination: 'review_queue',
    auditEventId: 'audit_1',
    sandboxManifest: 'manifest_1',
  });
  assert.equal(blocked.decision, 'deny');
  assert.ok(blocked.issues.includes('sensitive_document_human_review_required'));

  const allowed = evaluateDocumentWorkflowRun({
    connectorScope: 'folder:invoices:read',
    sourceDocumentId: 'doc_1',
    classification: 'invoice',
    routeDestination: 'review_queue',
    auditEventId: 'audit_1',
    sandboxManifest: 'manifest_1',
  });
  assert.equal(allowed.decision, 'allow');
});

test('OpenTelemetry declarative config centralizes traces metrics and logs with redaction policy', () => {
  const config = buildOtelDeclarativeConfig({ serviceName: 'thumbgate-test', ratio: 0.5 });
  assert.equal(config.envVar, 'OTEL_CONFIG_FILE');
  assert.equal(config.config.resource.attributes['service.name'], 'thumbgate-test');
  assert.equal(evaluateOtelConfig(config).decision, 'allow');

  const weak = evaluateOtelConfig({ traces: {} });
  assert.equal(weak.decision, 'warn');
  assert.ok(weak.issues.includes('missing_metric_pipeline'));
});

test('granular verifier scoring requires multiple criteria, repeats, and calibration', () => {
  const rubric = buildVerifierScoringRubric({ granularity: 100, repeats: 2, passThreshold: 0.8 });
  const result = computeVerifierScore({
    rubric,
    scores: rubric.criteria.map((criterion) => ({ criterion, repeats: [90, 85] })),
  });
  assert.equal(result.decision, 'allow');
  assert.equal(result.score, 0.875);

  const setup = evaluateVerifierSetup({
    criteria: rubric.criteria,
    repeats: 2,
    heldoutCalibration: true,
    destructiveAction: true,
    humanReview: true,
  });
  assert.equal(setup.decision, 'allow');

  const weak = evaluateVerifierSetup({ criteria: ['only_one'], repeats: 1 });
  assert.equal(weak.decision, 'warn');
  assert.ok(weak.issues.includes('heldout_calibration_required'));
});

test('token TCO evaluates cost per useful blocked failure instead of raw GPU price', () => {
  const cost = computeCostPerMillionTokens({
    gpuDollarsPerHour: 2,
    tokensPerSecond: 1000000 / 3600,
  });
  assert.equal(cost, 2);

  const report = evaluateInferenceTco({
    costPerMillionTokens: 2,
    tokensPerRun: 10000,
    runsPerDay: 100,
    usefulBlocksPerDay: 4,
    laborDollarsPerHour: 120,
  });
  assert.equal(report.decision, 'allow');
  assert.equal(report.metric, 'cost_per_useful_blocked_failure');
  assert.ok(report.roi > 1);
});

test('Skill-RAG router skips wasteful retrieval and routes failure states to typed skills', () => {
  const confident = routeRetrievalSkill({
    query: 'What is ThumbGate?',
    evidence: 'ThumbGate is a pre-action gate system.',
    confidence: 0.9,
  });
  assert.equal(confident.skill, 'skip_retrieval');
  assert.equal(confident.retrieve, false);

  const decomposed = routeRetrievalSkill({
    query: 'Compare workspace agents and managed memory for enterprise rollouts',
    evidence: 'unknown',
    confidence: 0.1,
  });
  assert.equal(decomposed.skill, 'decompose_question');
  assert.equal(decomposed.retrieve, true);
});
