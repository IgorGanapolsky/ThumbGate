const test = require('node:test');
const assert = require('node:assert/strict');

const {
  explainClassifierRoute,
  loadClassifierRoutingConfig,
  routeClassifier,
} = require('../scripts/classifier-routing');

test('classifier routing config exposes all enforcement lanes', () => {
  const config = loadClassifierRoutingConfig();
  for (const lane of ['deterministic', 'semantic_cache', 'local_classical', 'local_semantic', 'llm_judge', 'rubric_gate', 'human_review']) {
    assert.ok(config.lanes[lane], `${lane} lane missing`);
    assert.equal(typeof config.lanes[lane].description, 'string');
  }
});

test('semantic equivalent repeats reuse cached decisions without a provider call', () => {
  const decision = routeClassifier({
    semanticCacheHit: true,
    risk: 'high',
    ambiguity: 0.9,
    allowCloud: true,
    latencyBudgetMs: 10000,
  });

  assert.equal(decision.lane, 'semantic_cache');
  assert.equal(decision.cloudAllowed, false);
});

test('rubric failures and missing dataset provenance block completion claims', () => {
  const rubricDecision = routeClassifier({
    rubricFailed: true,
    risk: 'medium',
  });
  const provenanceDecision = routeClassifier({
    structuredDataset: true,
    missingProvenance: true,
    risk: 'high',
  });

  assert.equal(rubricDecision.lane, 'rubric_gate');
  assert.equal(provenanceDecision.lane, 'rubric_gate');
  assert.equal(provenanceDecision.requiresEvidence, true);
});

test('hard rules always route to deterministic checks', () => {
  const decision = routeClassifier({
    hasHardRule: true,
    risk: 'critical',
    ambiguity: 1,
    allowCloud: true,
    latencyBudgetMs: 10000,
  });

  assert.equal(decision.lane, 'deterministic');
  assert.equal(decision.cloudAllowed, false);
});

test('large low-ambiguity labeled batches use cheap local classification', () => {
  const decision = routeClassifier({
    labelCount: 120,
    batchRows: 500,
    ambiguity: 0.08,
    latencyBudgetMs: 150,
    risk: 'medium',
  });

  assert.equal(decision.lane, 'local_classical');
  assert.equal(decision.cloudAllowed, false);
});

test('sparse or fuzzy lessons use local semantic recall before any LLM', () => {
  const decision = routeClassifier({
    labelCount: 6,
    ambiguity: 0.42,
    latencyBudgetMs: 800,
    risk: 'medium',
  });

  assert.equal(decision.lane, 'local_semantic');
  assert.equal(decision.cloudAllowed, false);
});

test('high-risk semantic ambiguity can use an evidence-requiring LLM judge only when cloud and budget are allowed', () => {
  const decision = routeClassifier({
    risk: 'high',
    ambiguity: 0.82,
    allowCloud: true,
    latencyBudgetMs: 5000,
  });

  assert.equal(decision.lane, 'llm_judge');
  assert.equal(decision.requiresEvidence, true);
  assert.equal(decision.cloudAllowed, true);
});

test('private high-risk ambiguous actions require human review instead of cloud routing', () => {
  const decision = routeClassifier({
    risk: 'high',
    ambiguity: 0.72,
    privacySensitive: true,
    allowCloud: false,
    latencyBudgetMs: 5000,
  });

  assert.equal(decision.lane, 'human_review');
  assert.equal(decision.requiresEvidence, true);
  assert.equal(decision.cloudAllowed, false);
});

test('route explanations include buyer-readable rationale and lane use cases', () => {
  const decision = explainClassifierRoute({
    exactPolicyMatch: true,
    risk: 'high',
  });

  assert.equal(decision.lane, 'deterministic');
  assert.match(decision.description, /Regex|allow\/deny|protected paths/i);
  assert.ok(decision.useFor.length > 0);
});
