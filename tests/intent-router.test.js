const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const {
  DEFAULT_TOKEN_BUDGET,
  loadPolicyBundle,
  listIntents,
  planIntent,
  resolveTokenBudget,
  decomposeActions,
  scoreActions,
  rankActions,
  ACTION_CATEGORY_MAP,
} = require('../scripts/intent-router');
const { createInitialModel, updateModel, saveModel } = require('../scripts/thompson-sampling');

test('loads default policy bundle', () => {
  const bundle = loadPolicyBundle('default-v1');
  assert.equal(bundle.bundleId, 'default-v1');
  assert.ok(Array.isArray(bundle.intents));
  assert.ok(bundle.intents.length >= 3);
});

test('listIntents returns approval metadata for profile', () => {
  const catalog = listIntents({ bundleId: 'default-v1', mcpProfile: 'locked' });
  assert.equal(catalog.bundleId, 'default-v1');
  assert.equal(catalog.mcpProfile, 'locked');
  const mediumIntent = catalog.intents.find((i) => i.id === 'improve_response_quality');
  assert.equal(mediumIntent.requiresApproval, true);
});

test('listIntents normalizes partner profile and exposes partner strategy', () => {
  const catalog = listIntents({
    bundleId: 'default-v1',
    mcpProfile: 'default',
    partnerProfile: 'strict-reviewer',
  });
  assert.equal(catalog.partnerProfile, 'strict_reviewer');
  assert.equal(catalog.partnerStrategy.verificationMode, 'evidence_first');
  assert.ok(Array.isArray(catalog.partnerStrategy.recommendedChecks));
});

test('high-risk intent requires approval by default profile', () => {
  const plan = planIntent({
    bundleId: 'default-v1',
    mcpProfile: 'default',
    intentId: 'publish_dpo_training_data',
    approved: false,
  });
  assert.equal(plan.status, 'checkpoint_required');
  assert.equal(plan.requiresApproval, true);
  assert.ok(plan.checkpoint);
});

test('approved high-risk intent becomes ready', () => {
  const plan = planIntent({
    bundleId: 'default-v1',
    mcpProfile: 'default',
    intentId: 'publish_dpo_training_data',
    approved: true,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.requiresApproval, true);
  assert.equal(plan.checkpoint, null);
});

test('unknown intent throws', () => {
  assert.throws(() => planIntent({
    bundleId: 'default-v1',
    mcpProfile: 'default',
    intentId: 'does_not_exist',
  }), /Unknown intent/);
});

test('invalid mcp profile is rejected', () => {
  assert.throws(() => listIntents({
    bundleId: 'default-v1',
    mcpProfile: 'not-a-profile',
  }), /Unknown MCP profile/);
});

test('ACTION_CATEGORY_MAP covers known action names', () => {
  assert.ok(ACTION_CATEGORY_MAP.capture_feedback);
  assert.ok(ACTION_CATEGORY_MAP.feedback_summary);
  assert.ok(ACTION_CATEGORY_MAP.search_lessons);
  assert.ok(ACTION_CATEGORY_MAP.search_thumbgate);
  assert.ok(ACTION_CATEGORY_MAP.export_dpo_pairs);
  assert.ok(ACTION_CATEGORY_MAP.export_databricks_bundle);
});

test('scoreActions returns scored and sorted actions', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-test-'));
  const modelPath = path.join(tmpDir, 'feedback_model.json');
  try {
    const model = createInitialModel();
    for (let i = 0; i < 20; i++) {
      updateModel(model, { signal: 'positive', timestamp: new Date().toISOString(), categories: ['debugging'] });
    }
    for (let i = 0; i < 20; i++) {
      updateModel(model, { signal: 'negative', timestamp: new Date().toISOString(), categories: ['code_edit'] });
    }
    saveModel(model, modelPath);

    const actions = [
      { kind: 'mcp_tool', name: 'capture_feedback' },
      { kind: 'mcp_tool', name: 'feedback_summary' },
    ];
    const scored = scoreActions(actions, modelPath);
    assert.equal(scored.length, 2);
    assert.ok(scored[0].score >= scored[1].score);
    assert.equal(scored[0].action.name, 'feedback_summary');
    scored.forEach((s) => {
      assert.ok(s.score >= 0 && s.score <= 1);
      assert.ok(s.category);
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('rankActions returns ranked array and scores metadata', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-rank-'));
  const modelPath = path.join(tmpDir, 'feedback_model.json');
  try {
    saveModel(createInitialModel(), modelPath);
    const actions = [
      { kind: 'mcp_tool', name: 'capture_feedback' },
      { kind: 'mcp_tool', name: 'prevention_rules' },
      { kind: 'mcp_tool', name: 'export_dpo_pairs' },
      { kind: 'mcp_tool', name: 'export_databricks_bundle' },
    ];
    const result = rankActions(actions, { modelPath });
    assert.equal(result.ranked.length, 4);
    assert.equal(result.scores.length, 4);
    result.scores.forEach((s) => {
      assert.ok(s.name);
      assert.ok(s.category);
      assert.ok(typeof s.score === 'number');
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scoreActions handles unknown action name gracefully', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-unk-'));
  const modelPath = path.join(tmpDir, 'feedback_model.json');
  try {
    saveModel(createInitialModel(), modelPath);
    const actions = [{ kind: 'mcp_tool', name: 'totally_unknown_action' }];
    const scored = scoreActions(actions, modelPath);
    assert.equal(scored.length, 1);
    assert.equal(scored[0].category, 'uncategorized');
    assert.ok(typeof scored[0].score === 'number');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/* ── Planning Decomposition Tests ──────────────────────────────── */

test('decomposeActions groups same-kind actions into phases', () => {
  const actions = [
    { kind: 'mcp_tool', name: 'a' },
    { kind: 'mcp_tool', name: 'b' },
    { kind: 'shell', name: 'c' },
    { kind: 'mcp_tool', name: 'd' },
  ];
  const phases = decomposeActions(actions);
  assert.equal(phases.length, 3);
  assert.equal(phases[0].parallel, true);
  assert.equal(phases[0].actions.length, 2);
  assert.equal(phases[1].parallel, false);
  assert.equal(phases[2].parallel, false);
  phases.forEach((p, i) => assert.equal(p.phaseIndex, i));
});

test('decomposeActions returns empty array for no actions', () => {
  assert.deepEqual(decomposeActions([]), []);
  assert.deepEqual(decomposeActions(null), []);
});

test('planIntent includes phases and tokenBudget', () => {
  const plan = planIntent({
    bundleId: 'default-v1',
    mcpProfile: 'default',
    intentId: 'improve_response_quality',
    approved: false,
  });
  assert.ok(Array.isArray(plan.phases));
  assert.ok(plan.phases.length >= 1);
  assert.ok(plan.tokenBudget);
  assert.equal(plan.tokenBudget.total, DEFAULT_TOKEN_BUDGET.total);
  assert.equal(plan.tokenBudget.perAction, DEFAULT_TOKEN_BUDGET.perAction);
});

test('planIntent accepts custom token budget', () => {
  const plan = planIntent({
    bundleId: 'default-v1',
    mcpProfile: 'default',
    intentId: 'capture_feedback_loop',
    tokenBudget: { total: 8000, perAction: 2000 },
  });
  assert.equal(plan.tokenBudget.total, 8000);
  assert.equal(plan.tokenBudget.perAction, 2000);
  assert.equal(plan.tokenBudget.contextPack, DEFAULT_TOKEN_BUDGET.contextPack);
});

test('planIntent applies partner-aware token budget and action scoring', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-plan-partner-'));
  const modelPath = path.join(tmpDir, 'feedback_model.json');
  try {
    const model = createInitialModel();
    for (let i = 0; i < 20; i++) {
      updateModel(model, { signal: 'positive', timestamp: new Date().toISOString(), categories: ['architecture'] });
    }
    saveModel(model, modelPath);

    const plan = planIntent({
      bundleId: 'default-v1',
      mcpProfile: 'default',
      intentId: 'incident_postmortem',
      partnerProfile: 'strict-reviewer',
      tokenBudget: { total: 10000, perAction: 3000, contextPack: 5000 },
      modelPath,
    });

    assert.equal(plan.partnerProfile, 'strict_reviewer');
    assert.equal(plan.partnerStrategy.verificationMode, 'evidence_first');
    assert.ok(plan.tokenBudget.contextPack > 5000);
    assert.equal(plan.actionScores.length, 3);
    assert.ok(
      ['construct_context_pack', 'context_provenance'].includes(plan.actions[0].name),
      `expected evidence action first, got ${plan.actions[0].name}`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('rankActions front-loads evidence producers for strict reviewers', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-rank-partner-'));
  const modelPath = path.join(tmpDir, 'feedback_model.json');
  try {
    saveModel(createInitialModel(), modelPath);
    const result = rankActions([
      { kind: 'mcp_tool', name: 'evaluate_context_pack' },
      { kind: 'mcp_tool', name: 'construct_context_pack' },
      { kind: 'mcp_tool', name: 'context_provenance' },
    ], {
      modelPath,
      partnerProfile: 'strict-reviewer',
    });

    const rankedNames = result.ranked.map((action) => action.name);
    assert.equal(rankedNames[2], 'evaluate_context_pack');
    assert.deepEqual(
      new Set(rankedNames.slice(0, 2)),
      new Set(['construct_context_pack', 'context_provenance']),
    );
    assert.deepEqual(
      result.scores.map((score) => score.partnerPriority),
      [0, 0, 1],
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('planIntent adds codegraph impact and structural verification checks for coding workflows', () => {
  const previous = process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
  process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = JSON.stringify({
    source: 'stub',
    symbols: ['planIntent'],
    callers: ['src/api/server.js -> planIntent'],
    callees: ['rankActions'],
    deadCode: ['legacyIntentPlanner'],
  });

  try {
    const plan = planIntent({
      bundleId: 'default-v1',
      mcpProfile: 'default',
      intentId: 'incident_postmortem',
      context: 'Refactor `planIntent` in scripts/intent-router.js',
    });

    assert.equal(plan.codegraphImpact.enabled, true);
    assert.equal(plan.codegraphImpact.source, 'stub');
    assert.equal(plan.codegraphImpact.evidence.deadCodeCount, 1);
    assert.ok(
      plan.partnerStrategy.recommendedChecks.some((check) => /dead code/i.test(check)),
      'expected structural dead-code verification check',
    );
  } finally {
    if (previous === undefined) delete process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
    else process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = previous;
  }
});

/* ── Token Budget Tests ────────────────────────────────────────── */

test('resolveTokenBudget returns defaults when no overrides', () => {
  const budget = resolveTokenBudget();
  assert.deepEqual(budget, DEFAULT_TOKEN_BUDGET);
});

test('resolveTokenBudget merges partial overrides', () => {
  const budget = resolveTokenBudget({ total: 5000 });
  assert.equal(budget.total, 5000);
  assert.equal(budget.perAction, DEFAULT_TOKEN_BUDGET.perAction);
});

test('resolveTokenBudget ignores invalid values', () => {
  const budget = resolveTokenBudget({ total: -1, perAction: 'bad' });
  assert.deepEqual(budget, DEFAULT_TOKEN_BUDGET);
});
