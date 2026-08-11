'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  describeNemotronLightning,
  pickModelForStep,
  routeAgentSteps,
  evaluateRoutingAlgorithm,
  buildAlwaysOnAgentPlan,
  DEFAULT_POOL,
} = require('../scripts/switchyard-router');

const {
  buildNemotronConfig,
  planAlwaysOnAgent,
  NEMOTRON_MODELS,
} = require('../adapters/nvidia');

test('Nemotron 3.5 Lightning is 30B MoE with 3B active', () => {
  const n = describeNemotronLightning();
  assert.equal(n.totalParamsB, 30);
  assert.equal(n.activeParamsB, 3);
  assert.equal(n.architecture, 'MoE');
  assert.equal(n.open, true);
  assert.ok(DEFAULT_POOL.some((m) => m.id === 'nvidia/nemotron-3.5-lightning'));
});

test('intent and gate steps prefer Nemotron Lightning (cheap always-on specialist)', () => {
  const intent = pickModelForStep({ type: 'intent-detect', tags: ['always-on'] });
  assert.equal(intent.role, 'intent');
  assert.equal(intent.modelId, 'nvidia/nemotron-3.5-lightning');

  const gate = pickModelForStep({ type: 'pretool-gate', tags: ['gate'] });
  assert.equal(gate.role, 'gate');
  assert.equal(gate.modelId, 'nvidia/nemotron-3.5-lightning');
});

test('coding and high-risk review use specialized / quality models', () => {
  const code = pickModelForStep({ type: 'coding-implement', tags: ['coding', 'high-output'], highOutput: true });
  assert.equal(code.role, 'code');
  assert.ok(
    code.modelId === 'alibaba/qwen3.8-max' || code.provider === 'model-studio' || code.provider === 'anthropic',
    `expected coding specialist, got ${code.modelId}`,
  );

  const reason = pickModelForStep({ type: 'architecture-review', riskLevel: 'high', tags: ['architecture'] });
  assert.equal(reason.role, 'reason');
  assert.equal(reason.provider, 'anthropic');
});

test('sensitive steps force local pool member', () => {
  const priv = pickModelForStep({ type: 'coding', sensitive: true, privacyRoute: 'local' });
  assert.equal(priv.provider, 'local');
  assert.equal(priv.modelId, 'local/frontier');
});

test('always-on agent plan is multi-model (Switchyard anti single-model)', () => {
  const routed = routeAgentSteps(buildAlwaysOnAgentPlan({ highVolume: true }));
  assert.equal(routed.architecture, 'switchyard-multi-model');
  assert.ok(routed.steps.length >= 4);
  assert.equal(routed.multiModel, true);
  assert.ok(routed.distinctModels.includes('nvidia/nemotron-3.5-lightning'));
  assert.equal(routed.singleModelAntiPattern, false);
});

test('evaluateRoutingAlgorithm fails closed without cost+quality evidence', () => {
  const blocked = evaluateRoutingAlgorithm({
    baseline: { costUsd: 1 },
    candidate: { costUsd: 0.5 },
  });
  assert.equal(blocked.pass, false);
  assert.equal(blocked.action, 'block');

  const ok = evaluateRoutingAlgorithm({
    baseline: { costUsd: 1.0, qualityScore: 0.9, latencyMs: 2000 },
    candidate: { costUsd: 0.5, qualityScore: 0.91, latencyMs: 1500 },
  });
  assert.equal(ok.pass, true);
  assert.ok(ok.deltas.costSavingsPercent >= 10);

  const qualityDrop = evaluateRoutingAlgorithm({
    baseline: { costUsd: 1.0, qualityScore: 0.95 },
    candidate: { costUsd: 0.4, qualityScore: 0.8 },
  });
  assert.equal(qualityDrop.pass, false);
});

test('adapters/nvidia config and always-on plan', () => {
  assert.equal(NEMOTRON_MODELS.LIGHTNING_35, 'nemotron-3.5-lightning');
  const cfg = buildNemotronConfig({ apiKey: 'test-nim-key' });
  assert.equal(cfg.isConfigured, true);
  assert.equal(cfg.isOpenAICompatible, true);
  assert.equal(cfg.lightning.activeParamsB, 3);

  const plan = planAlwaysOnAgent({ highVolume: true });
  assert.equal(plan.multiModel, true);
});
