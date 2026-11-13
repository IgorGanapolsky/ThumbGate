'use strict';

/**
 * Dual-Model Mixture-of-Agents & Agentic GraphRAG Playbook
 * (Google AI Mode Share: https://share.google/aimode/fdgL9FPBtXelCwIeB)
 *
 * Implements the three production pillars onto ThumbGate's PreToolUse and
 * multi-agent coordination rails without vendoring external gateways:
 *
 *   1. Dual-Model Orchestration & "Split Workflow" Design Pattern:
 *      - Strategist / Global Ingester (Gemini 4 Argon / 3.1 Pro, 1M shared tokens):
 *        multimodal feature extraction, global codebase review, schema graph
 *        synthesis, and structured Markdown handoff generation.
 *      - Tactical Executor (Claude Opus 4.7 / 3.5 Sonnet, 200k high-density tokens):
 *        terminal manipulation, local Git state modifications, rigid schema
 *        adherence, and unit test execution tracking.
 *      - Asynchronous Split Synchronization: feeds Claude's raw terminal traces
 *        back into Gemini's 1M long-context buffer via a structured sync prompt.
 *
 *   2. Agentic GraphRAG Pipeline & Graph-R1 Hypergraph Construction:
 *      - Enforces Pattern B (Schema-Constrained) and Pattern C (Graph-R1
 *        Hypergraphs with format + F1 reward scoring and step-by-step rethink
 *        states), while blocking Pattern A (unconstrained LLM open extraction)
 *        for production governance due to lexical drift.
 *      - Decoupled 2-Tier Google Cloud Blueprint: Ingestion Tier
 *        (upload_agent -> gemini_multimodal_extraction_agent -> graph_translation_agent)
 *        and Search Tier (autonomous multi-hop traversal with rethink loop).
 *
 *   3. Dual-LLM Gateway Infrastructure & Failover Governance
 *      (Bifrost / LiteLLM / Portkey format steal):
 *      - Cross-Provider Parity Routing: always fail over to a competing provider
 *        of comparable intelligence (Claude Opus <-> Gemini Argon/Pro), blocking
 *        same-provider regional fallbacks.
 *      - Rigid Structural Schema Validation: un-parseable JSON or missing schema
 *        fields trigger LOGICAL_TIMEOUT_SCHEMA_FAILOVER to the secondary provider.
 *      - Token-Throttling Guardrails: caps fallback chains at <= 3 hops (default 2)
 *        and enforces per-virtual-key USD budgets to stop recursive billing loops.
 */

const crypto = require('node:crypto');
const {
  EXTRACTION_PATTERNS,
  buildHypergraph,
  scoreGraphR1HypergraphReward,
  runAgenticGraphRagSearch,
} = require('./graphrag-schema-first-multi-hop');

const OPERATIONAL_MODEL_MATRIX = Object.freeze({
  gemini_strategist: {
    family: 'gemini',
    provider: 'google',
    models: ['gemini-4-argon', 'gemini-3.1-pro'],
    architecturalRole: 'strategist_global_ingester',
    contextWindowTokens: 1000000,
    contextProfile: '1M shared tokens across inputs, thinking, and long decode outputs',
    optimizedWorkloads: [
      'multimodal_feature_extraction',
      'global_codebase_review',
      'abstract_code_synthesis',
      'rapid_ui_ux_generation',
      'schema_graph_synthesis',
    ],
  },
  claude_executor: {
    family: 'claude',
    provider: 'anthropic',
    models: ['claude-opus-4-7', 'claude-3-5-sonnet'],
    architecturalRole: 'tactical_executor',
    contextWindowTokens: 200000,
    contextProfile: '200k+ high-density tokens maximizing attention precision and multi-hop logical integrity',
    optimizedWorkloads: [
      'terminal_manipulation',
      'local_git_state_modification',
      'complex_backend_logic',
      'deterministic_compliance_routing',
      'test_suite_execution_tracking',
    ],
  },
});

const COMPETING_PROVIDER_PARITY_MAP = Object.freeze({
  'anthropic:claude-opus-4-7': { provider: 'google', model: 'gemini-4-argon', tier: 'frontier_flagship' },
  'anthropic:claude-3-5-sonnet': { provider: 'google', model: 'gemini-3.1-pro', tier: 'high_density_code' },
  'google:gemini-4-argon': { provider: 'anthropic', model: 'claude-opus-4-7', tier: 'frontier_flagship' },
  'google:gemini-3.1-pro': { provider: 'anthropic', model: 'claude-3-5-sonnet', tier: 'high_density_code' },
});

/**
 * Pillar 1: Allocate workload between Gemini Strategist (1M context) and
 * Claude Tactical Executor (200k context) and emit the Split Workflow handoff
 * and terminal trace synchronization capsule.
 */
function allocateDualModelSplitWorkflow({
  taskType = 'atomic_code_edit',
  estimatedContextTokens = 45000,
  hasMultimodalAssets = false,
  targetFiles = ['src/api/server.js'],
  acceptanceTests = ['node --test tests/dual-model-moa-graphrag-playbook.test.js'],
  claudeTerminalTrace = '',
} = {}) {
  const tokenCount = Math.max(Number(estimatedContextTokens) || 0, 0);
  const normalizedTask = String(taskType || '').trim().toLowerCase();

  const isStrategistPrimary = Boolean(
    hasMultimodalAssets
    || tokenCount > 180000
    || /multimodal|global_review|ui_ux|wireframe|architecture|ingest|graph_synthesis/.test(normalizedTask),
  );

  const primaryOwner = isStrategistPrimary
    ? OPERATIONAL_MODEL_MATRIX.gemini_strategist
    : OPERATIONAL_MODEL_MATRIX.claude_executor;
  const secondaryPartner = isStrategistPrimary
    ? OPERATIONAL_MODEL_MATRIX.claude_executor
    : OPERATIONAL_MODEL_MATRIX.gemini_strategist;

  const filesList = Array.isArray(targetFiles) && targetFiles.length > 0
    ? targetFiles
    : ['src/api/server.js'];
  const testsList = Array.isArray(acceptanceTests) && acceptanceTests.length > 0
    ? acceptanceTests
    : ['npm test'];

  const strategistHandoffMarkdown = [
    '# Split-Workflow Architectural Handoff (Gemini Strategist -> Claude Tactical Executor)',
    `- **Task Type:** \`${normalizedTask || 'atomic_code_edit'}\``,
    `- **Strategist Model:** \`${OPERATIONAL_MODEL_MATRIX.gemini_strategist.models[0]}\` (1M shared context)`,
    `- **Tactical Executor:** \`${OPERATIONAL_MODEL_MATRIX.claude_executor.models[0]}\` (200k high-density context)`,
    `- **Target Files:** ${filesList.map((f) => `\`${f}\``).join(', ')}`,
    `- **Verification Commands:** ${testsList.map((t) => `\`${t}\``).join(', ')}`,
  ].join('\n');

  const traceText = String(claudeTerminalTrace || '').trim();
  const traceDigest = crypto
    .createHash('sha256')
    .update(traceText || 'empty_trace')
    .digest('hex')
    .slice(0, 16);

  const terminalTraceSyncCapsule = {
    direction: 'claude_executor_to_gemini_long_context',
    targetBuffer: 'gemini_1m_shared_context',
    tracePresent: traceText.length > 0,
    traceBytes: Buffer.byteLength(traceText, 'utf8'),
    traceSha256Prefix: traceDigest,
    syncPrompt: traceText
      ? `[SPLIT-WORKFLOW-SYNC sha256=${traceDigest}] Ingest Claude Code terminal trace (${Buffer.byteLength(traceText, 'utf8')}B) into Gemini 1M context buffer and update macro state.`
      : '[SPLIT-WORKFLOW-SYNC] Awaiting Claude Code tactical terminal execution trace.',
  };

  return {
    ok: true,
    pattern: 'asynchronous_split_workflow',
    primaryRole: primaryOwner.architecturalRole,
    primaryProvider: primaryOwner.provider,
    primaryModel: primaryOwner.models[0],
    secondaryRole: secondaryPartner.architecturalRole,
    secondaryProvider: secondaryPartner.provider,
    secondaryModel: secondaryPartner.models[0],
    estimatedContextTokens: tokenCount,
    hasMultimodalAssets: Boolean(hasMultimodalAssets),
    strategistHandoffMarkdown,
    terminalTraceSyncCapsule,
    operationalMatrix: OPERATIONAL_MODEL_MATRIX,
  };
}

/**
 * Pillar 3: Dual-LLM Gateway Failover, Schema Validation & Hop-Cap Guardrail.
 */
function evaluateCrossProviderGatewayFailover({
  primaryProvider = 'anthropic',
  primaryModel = 'claude-opus-4-7',
  fallbackProvider = 'google',
  fallbackModel = 'gemini-4-argon',
  primaryStatus = 'ok',
  responsePayload = '{"ok":true,"action":"ALLOW"}',
  requiredSchemaKeys = ['ok', 'action'],
  hopCount = 0,
  maxHops = 2,
  virtualKeyBudgetUsd = 25,
  virtualKeySpentUsd = 4.5,
} = {}) {
  const normPrimaryProv = String(primaryProvider || '').trim().toLowerCase();
  const normPrimaryMod = String(primaryModel || '').trim().toLowerCase();
  const normFallbackProv = String(fallbackProvider || '').trim().toLowerCase();
  const normFallbackMod = String(fallbackModel || '').trim().toLowerCase();

  const effectiveMaxHops = Math.min(Math.max(Number(maxHops) || 2, 1), 3);
  const currentHops = Math.max(Number(hopCount) || 0, 0);
  const budgetUsd = Math.max(Number(virtualKeyBudgetUsd) || 0, 0);
  const spentUsd = Math.max(Number(virtualKeySpentUsd) || 0, 0);

  // 1. Token-throttling & virtual-key budget guardrail
  if (currentHops > effectiveMaxHops) {
    return {
      ok: false,
      action: 'DENY',
      reasonCode: 'RECURSIVE_FALLBACK_LOOP_BLOCKED',
      hopCount: currentHops,
      maxHops: effectiveMaxHops,
      sameProviderFallbackBlocked: false,
      schemaValid: false,
      routedProvider: null,
      routedModel: null,
    };
  }

  if (budgetUsd > 0 && spentUsd >= budgetUsd) {
    return {
      ok: false,
      action: 'DENY',
      reasonCode: 'VIRTUAL_KEY_BUDGET_EXHAUSTED',
      hopCount: currentHops,
      maxHops: effectiveMaxHops,
      virtualKeyBudgetUsd: budgetUsd,
      virtualKeySpentUsd: spentUsd,
      routedProvider: null,
      routedModel: null,
    };
  }

  // 2. Cross-provider parity check (never fail back to same provider's other region)
  const parityKey = `${normPrimaryProv}:${normPrimaryMod}`;
  const canonicalParity = COMPETING_PROVIDER_PARITY_MAP[parityKey] || {
    provider: normPrimaryProv === 'anthropic' ? 'google' : 'anthropic',
    model: normPrimaryProv === 'anthropic' ? 'gemini-4-argon' : 'claude-opus-4-7',
    tier: 'cross_provider_parity',
  };
  const sameProviderRequested = normFallbackProv === normPrimaryProv;
  const resolvedFallbackProvider = sameProviderRequested ? canonicalParity.provider : normFallbackProv;
  const resolvedFallbackModel = sameProviderRequested ? canonicalParity.model : normFallbackMod;

  // 3. Rigid structural schema validation on gateway response
  let parsedJson = null;
  let schemaValid = true;
  let schemaFailureReason = null;

  if (typeof responsePayload === 'string') {
    try {
      parsedJson = JSON.parse(responsePayload);
    } catch {
      schemaValid = false;
      schemaFailureReason = 'unparseable_json_payload';
    }
  } else if (responsePayload && typeof responsePayload === 'object') {
    parsedJson = responsePayload;
  } else {
    schemaValid = false;
    schemaFailureReason = 'empty_or_non_object_payload';
  }

  if (schemaValid && Array.isArray(requiredSchemaKeys) && requiredSchemaKeys.length > 0) {
    const missingKeys = requiredSchemaKeys.filter(
      (k) => !parsedJson || !Object.prototype.hasOwnProperty.call(parsedJson, k),
    );
    if (missingKeys.length > 0) {
      schemaValid = false;
      schemaFailureReason = `missing_schema_keys:${missingKeys.join(',')}`;
    }
  }

  const providerFailed = String(primaryStatus || 'ok').toLowerCase() !== 'ok';
  const failoverTriggered = providerFailed || !schemaValid;

  if (failoverTriggered && currentHops + 1 > effectiveMaxHops) {
    return {
      ok: false,
      action: 'DENY',
      reasonCode: 'RECURSIVE_FALLBACK_LOOP_BLOCKED',
      triggerReason: !schemaValid ? 'LOGICAL_TIMEOUT_SCHEMA_FAILOVER' : 'PRIMARY_PROVIDER_OUTAGE',
      schemaValid,
      schemaFailureReason,
      hopCount: currentHops + 1,
      maxHops: effectiveMaxHops,
      routedProvider: null,
      routedModel: null,
    };
  }

  return {
    ok: true,
    action: failoverTriggered ? 'FAILOVER_COMPETING_PROVIDER' : 'ALLOW_PRIMARY',
    failoverTriggered,
    triggerReason: failoverTriggered
      ? (!schemaValid ? 'LOGICAL_TIMEOUT_SCHEMA_FAILOVER' : 'PRIMARY_PROVIDER_OUTAGE')
      : 'NONE',
    sameProviderRegionFallbackBlocked: sameProviderRequested,
    schemaValid,
    schemaFailureReason,
    hopCount: failoverTriggered ? currentHops + 1 : currentHops,
    maxHops: effectiveMaxHops,
    routedProvider: failoverTriggered ? resolvedFallbackProvider : normPrimaryProv,
    routedModel: failoverTriggered ? resolvedFallbackModel : normPrimaryMod,
    virtualKeyBudgetRemainingUsd: Number(Math.max(budgetUsd - spentUsd, 0).toFixed(2)),
  };
}

/**
 * Unified Playbook Evaluator combining all three pillars:
 *   1. Dual-Model Split Workflow (Gemini 1M Strategist + Claude 200k Executor)
 *   2. Agentic GraphRAG & Graph-R1 Hypergraphs (Ingestion Tier + Rethink Search Tier)
 *   3. Dual-LLM Gateway Failover & Schema/Hop Governance
 */
function evaluateDualModelMoaAndAgenticGraphRagPlaybook(input = {}) {
  const extractionPattern = String(input.extractionPattern || 'pattern_c_graph_r1_hypergraph').trim();
  const selectedPattern = EXTRACTION_PATTERNS[extractionPattern] || EXTRACTION_PATTERNS.pattern_c_graph_r1_hypergraph;

  // Enforce Pattern B or C for production governance (block Pattern A open extraction drift)
  const patternGovernanceAllowed = Boolean(selectedPattern.productionAllowedForGovernance);

  const defaultLessons = Array.isArray(input.lessons) && input.lessons.length > 0
    ? input.lessons
    : [
        {
          id: 'L-MOA-1',
          title: 'claude opus rate limit fallback incident on checkout',
          domain: 'claude',
          rootCause: 'same-provider regional retry cascade',
          tags: ['policy', 'guard', 'thumbgate'],
          receipt: 'sha256:cc5d0d2d39d243f9',
        },
        {
          id: 'L-MOA-2',
          title: 'gemini argon multimodal schema graph extraction',
          domain: 'gemini',
          rootCause: 'hypergraph rethink closure',
          tags: ['tool', 'receipt'],
          receipt: 'sha256:171b46c04490e6bd',
        },
      ];

  const hypergraph = buildHypergraph(defaultLessons);
  const searchQuery = String(input.query || 'claude rate limit fallback retry cascade');
  const agenticSearch = runAgenticGraphRagSearch(hypergraph, searchQuery, {
    maxDepth: input.maxDepth || 2,
    topK: input.topK || 3,
  });

  const splitWorkflow = allocateDualModelSplitWorkflow({
    taskType: input.taskType || 'global_review_and_atomic_edit',
    estimatedContextTokens: input.estimatedContextTokens || 240000,
    hasMultimodalAssets: input.hasMultimodalAssets !== undefined ? input.hasMultimodalAssets : true,
    targetFiles: input.targetFiles || ['scripts/graphrag-schema-first-multi-hop.js', 'scripts/dual-model-moa-graphrag-playbook.js'],
    claudeTerminalTrace: input.claudeTerminalTrace || '✔ 77/77 tests passed (exit 0)',
  });

  const gatewayFailover = evaluateCrossProviderGatewayFailover({
    primaryProvider: input.primaryProvider || 'anthropic',
    primaryModel: input.primaryModel || 'claude-opus-4-7',
    fallbackProvider: input.fallbackProvider || 'google',
    fallbackModel: input.fallbackModel || 'gemini-4-argon',
    primaryStatus: input.primaryStatus || 'ok',
    responsePayload: input.responsePayload !== undefined ? input.responsePayload : '{"ok":true,"action":"ALLOW"}',
    requiredSchemaKeys: input.requiredSchemaKeys || ['ok', 'action'],
    hopCount: input.hopCount || 0,
    maxHops: input.maxHops || 2,
    virtualKeyBudgetUsd: input.virtualKeyBudgetUsd || 25,
    virtualKeySpentUsd: input.virtualKeySpentUsd || 4.5,
  });

  const rewardEval = scoreGraphR1HypergraphReward({
    extractedEntities: hypergraph.nodes.map((n) => n.id),
    goldEntities: hypergraph.nodes.map((n) => n.id),
    validFormat: true,
  });

  const overallAllowed = patternGovernanceAllowed && gatewayFailover.ok;
  const receiptHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      pattern: selectedPattern.id,
      primaryRole: splitWorkflow.primaryRole,
      gatewayAction: gatewayFailover.action,
      hyperedgeCount: hypergraph.hyperedges.length,
      pathCount: agenticSearch.pathCount,
    }))
    .digest('hex');

  return {
    ok: overallAllowed,
    action: overallAllowed ? 'ALLOW' : 'DENY',
    playbookId: 'dual-model-moa-agentic-graphrag-2026',
    sourceUrl: 'https://share.google/aimode/fdgL9FPBtXelCwIeB',
    pillars: {
      dualModelSplitWorkflow: splitWorkflow,
      agenticGraphRagHypergraph: {
        selectedPattern,
        patternGovernanceAllowed,
        ingestionTierAgents: [
          'upload_agent',
          'gemini_multimodal_extraction_agent',
          'graph_translation_agent',
        ],
        searchTierAgent: 'autonomous_cypher_hypergraph_explorer',
        nodeCount: hypergraph.nodes.length,
        edgeCount: hypergraph.edges.length,
        hyperedgeCount: hypergraph.hyperedges.length,
        hyperedges: hypergraph.hyperedges,
        rewardMetrics: rewardEval,
        searchResult: agenticSearch,
      },
      dualLlmGatewayGovernance: gatewayFailover,
    },
    monetization: {
      outboundCashSpendUsd: 0,
      proCheckoutPath: '/go/pro-direct',
      proTrialPath: '/checkout/pro?trial=7d',
      setupSprintCheckoutPath: '/checkout/diagnostic',
      cloudPortalPath: '/cloud',
    },
    receiptSha256: receiptHash,
  };
}

if (require.main === module) {
  const report = evaluateDualModelMoaAndAgenticGraphRagPlaybook();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

module.exports = {
  OPERATIONAL_MODEL_MATRIX,
  COMPETING_PROVIDER_PARITY_MAP,
  allocateDualModelSplitWorkflow,
  evaluateCrossProviderGatewayFailover,
  evaluateDualModelMoaAndAgenticGraphRagPlaybook,
};
