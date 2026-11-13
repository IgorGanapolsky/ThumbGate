'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EXTRACTION_PATTERNS,
  buildHypergraph,
  scoreGraphR1HypergraphReward,
  runAgenticGraphRagSearch,
} = require('../scripts/graphrag-schema-first-multi-hop');

const {
  allocateDualModelSplitWorkflow,
  evaluateCrossProviderGatewayFailover,
  evaluateDualModelMoaAndAgenticGraphRagPlaybook,
} = require('../scripts/dual-model-moa-graphrag-playbook');

const { createApiServer } = require('../src/api/server');

test('Pillar 1: Split Workflow allocates multimodal/1M-context tasks to Gemini Strategist and atomic CLI edits to Claude Executor', () => {
  const strategistRun = allocateDualModelSplitWorkflow({
    taskType: 'global_review_and_multimodal_wireframe',
    estimatedContextTokens: 420000,
    hasMultimodalAssets: true,
    targetFiles: ['public/index.html', 'src/api/server.js'],
    claudeTerminalTrace: '✔ 77/77 tests passed',
  });
  assert.equal(strategistRun.primaryRole, 'strategist_global_ingester');
  assert.equal(strategistRun.primaryProvider, 'google');
  assert.equal(strategistRun.primaryModel, 'gemini-4-argon');
  assert.equal(strategistRun.secondaryRole, 'tactical_executor');
  assert.equal(strategistRun.secondaryProvider, 'anthropic');
  assert.match(strategistRun.strategistHandoffMarkdown, /Split-Workflow Architectural Handoff/);
  assert.equal(strategistRun.terminalTraceSyncCapsule.tracePresent, true);
  assert.match(strategistRun.terminalTraceSyncCapsule.syncPrompt, /SPLIT-WORKFLOW-SYNC sha256=/);

  const tacticalRun = allocateDualModelSplitWorkflow({
    taskType: 'atomic_code_edit',
    estimatedContextTokens: 32000,
    hasMultimodalAssets: false,
  });
  assert.equal(tacticalRun.primaryRole, 'tactical_executor');
  assert.equal(tacticalRun.primaryProvider, 'anthropic');
  assert.equal(tacticalRun.primaryModel, 'claude-opus-4-7');
});

test('Pillar 2: Pattern C Graph-R1 Hypergraphs score format + F1 reward and trigger rethink search on multi-hop queries', () => {
  assert.equal(EXTRACTION_PATTERNS.pattern_a_open.productionAllowedForGovernance, false);
  assert.equal(EXTRACTION_PATTERNS.pattern_b_schema_constrained.productionAllowedForGovernance, true);
  assert.equal(EXTRACTION_PATTERNS.pattern_c_graph_r1_hypergraph.productionAllowedForGovernance, true);

  const reward = scoreGraphR1HypergraphReward({
    extractedEntities: ['Acme Corporation', 'Stripe', 'ThumbGate'],
    goldEntities: ['acme corp', 'stripe', 'thumbgate', 'github'],
    validFormat: true,
  });
  assert.equal(reward.formatReward, 1.0);
  assert.equal(reward.precision, 1.0);
  assert.equal(reward.recall, 0.75);
  assert.ok(reward.f1Reward > 0.85);
  assert.ok(reward.combinedReward > 0.88);

  const lessons = [
    {
      id: 'L-HG-1',
      title: 'gateway outage on anthropic claude endpoint',
      domain: 'claude',
      rootCause: 'regional rate limit spike',
      tags: ['vendor'],
    },
    {
      id: 'L-HG-2',
      title: 'cross provider parity failover rule',
      domain: 'claude',
      rootCause: 'competing provider switch',
      tags: ['guard', 'policy'],
      receipt: 'CI-998877',
    },
  ];
  const hg = buildHypergraph(lessons);
  assert.equal(hg.patternId, 'pattern_c_graph_r1_hypergraph');
  assert.equal(hg.hyperedges.length, 2);
  assert.ok(hg.hyperedges[0].members.length >= 3);

  // Querying "gateway outage" hits L-HG-1 first (which lacks receipt/guard), triggering rethink to hop via 'claude' into L-HG-2
  const search = runAgenticGraphRagSearch(hg, 'gateway outage', { maxDepth: 2 });
  assert.equal(search.rethinkTriggered, true);
  assert.equal(search.traversalDepthUsed, 2);
  assert.ok(search.citations.includes('L-HG-1'));
  assert.ok(search.citations.includes('L-HG-2'));
  assert.match(search.citedContextBlock, /\[source:L-HG-2\]/);
});

test('Pillar 3: Dual-LLM Gateway blocks same-provider regional fallback, fails over on invalid schema, and caps hop loops', () => {
  // 1. Same-provider fallback ('anthropic' -> 'anthropic') is overridden to competing provider ('google:gemini-4-argon')
  const outageFailover = evaluateCrossProviderGatewayFailover({
    primaryProvider: 'anthropic',
    primaryModel: 'claude-opus-4-7',
    fallbackProvider: 'anthropic',
    fallbackModel: 'claude-opus-4-7-us-west',
    primaryStatus: 'rate_limited_429',
    responsePayload: '{"ok":true,"action":"ALLOW"}',
    hopCount: 0,
    maxHops: 2,
  });
  assert.equal(outageFailover.ok, true);
  assert.equal(outageFailover.action, 'FAILOVER_COMPETING_PROVIDER');
  assert.equal(outageFailover.sameProviderRegionFallbackBlocked, true);
  assert.equal(outageFailover.routedProvider, 'google');
  assert.equal(outageFailover.routedModel, 'gemini-4-argon');
  assert.equal(outageFailover.hopCount, 1);

  // 2. Unparseable JSON or missing required schema keys triggers LOGICAL_TIMEOUT_SCHEMA_FAILOVER
  const schemaFailover = evaluateCrossProviderGatewayFailover({
    primaryProvider: 'google',
    primaryModel: 'gemini-4-argon',
    fallbackProvider: 'anthropic',
    fallbackModel: 'claude-opus-4-7',
    primaryStatus: 'ok',
    responsePayload: '{"unexpected":"missing_required_keys"}',
    requiredSchemaKeys: ['ok', 'action'],
    hopCount: 0,
    maxHops: 2,
  });
  assert.equal(schemaFailover.ok, true);
  assert.equal(schemaFailover.action, 'FAILOVER_COMPETING_PROVIDER');
  assert.equal(schemaFailover.triggerReason, 'LOGICAL_TIMEOUT_SCHEMA_FAILOVER');
  assert.equal(schemaFailover.schemaValid, false);
  assert.equal(schemaFailover.routedProvider, 'anthropic');
  assert.equal(schemaFailover.routedModel, 'claude-opus-4-7');

  // 3. Hop cap exceeded blocks recursive billing loops
  const recursiveLoopBlocked = evaluateCrossProviderGatewayFailover({
    primaryProvider: 'anthropic',
    primaryModel: 'claude-opus-4-7',
    primaryStatus: 'timeout',
    hopCount: 2,
    maxHops: 2,
  });
  assert.equal(recursiveLoopBlocked.ok, false);
  assert.equal(recursiveLoopBlocked.action, 'DENY');
  assert.equal(recursiveLoopBlocked.reasonCode, 'RECURSIVE_FALLBACK_LOOP_BLOCKED');
});

test('HTTP API route /v1/cloud/moa-graphrag-playbook/gate serves unified Playbook evaluation', async () => {
  const origAllowInsecure = process.env.THUMBGATE_ALLOW_INSECURE;
  process.env.THUMBGATE_ALLOW_INSECURE = 'true';
  const server = createApiServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/cloud/moa-graphrag-playbook/gate`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.action, 'ALLOW');
    assert.equal(body.playbookId, 'dual-model-moa-agentic-graphrag-2026');
    assert.equal(body.pillars.dualModelSplitWorkflow.primaryProvider, 'google');
    assert.equal(body.pillars.agenticGraphRagHypergraph.patternGovernanceAllowed, true);
    assert.equal(body.monetization.outboundCashSpendUsd, 0);

    // Verify Pattern A open extraction is denied for production governance
    const denyRes = await fetch(`http://127.0.0.1:${port}/v1/cloud/moa-graphrag-playbook/gate?extractionPattern=pattern_a_open`);
    assert.equal(denyRes.status, 200);
    const denyBody = await denyRes.json();
    assert.equal(denyBody.ok, false);
    assert.equal(denyBody.action, 'DENY');
  } finally {
    if (origAllowInsecure !== undefined) {
      process.env.THUMBGATE_ALLOW_INSECURE = origAllowInsecure;
    } else {
      delete process.env.THUMBGATE_ALLOW_INSECURE;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});
