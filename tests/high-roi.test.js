const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * High-ROI integration smoke test.
 * Verifies that key high-ROI modules load and export expected APIs.
 */

test('decision-trace module exports expected API', () => {
  const dt = require('../scripts/decision-trace');
  assert.equal(typeof dt.traceEvaluation, 'function');
  assert.equal(typeof dt.summarizeSessionTraces, 'function');
  assert.equal(typeof dt.formatTraceSummary, 'function');
});

test('gate-eval module exports expected API', () => {
  const ge = require('../scripts/gate-eval');
  assert.equal(typeof ge.runEvalSuite, 'function');
  assert.equal(typeof ge.computeEffectivenessMetrics, 'function');
  assert.equal(typeof ge.compareSpecVersions, 'function');
});

test('gate-coherence module exports expected API', () => {
  const gc = require('../scripts/gate-coherence');
  assert.equal(typeof gc.runCoherenceAnalysis, 'function');
  assert.equal(typeof gc.computeCoherenceMetrics, 'function');
  assert.equal(typeof gc.analyzeCoherence, 'function');
});

test('workflow-gate-checkpoint module exports expected API', () => {
  const wgc = require('../scripts/workflow-gate-checkpoint');
  assert.equal(typeof wgc.createCheckpoint, 'function');
  assert.equal(typeof wgc.saveCheckpoint, 'function');
  assert.equal(typeof wgc.loadCheckpoint, 'function');
  assert.equal(typeof wgc.advanceCheckpoint, 'function');
  assert.equal(typeof wgc.shouldHaltWorkflow, 'function');
});

test('model-candidates module exports expected API', () => {
  const modelCandidates = require('../scripts/model-candidates');
  assert.equal(typeof modelCandidates.loadCatalog, 'function');
  assert.equal(typeof modelCandidates.recommendCandidates, 'function');
  assert.equal(typeof modelCandidates.buildModelCandidatesReport, 'function');
  assert.equal(typeof modelCandidates.writeModelCandidatesReport, 'function');
});

test('autonomous-workflow module exports expected API', () => {
  const workflow = require('../scripts/autonomous-workflow');
  assert.equal(typeof workflow.runAutonomousWorkflow, 'function');
  assert.equal(typeof workflow.resumeAutonomousWorkflow, 'function');
  assert.equal(typeof workflow.readWorkflowReport, 'function');
  assert.equal(typeof workflow.writeWorkflowReport, 'function');
});

test('ai-engineering-stack-guardrails module exports expected API', () => {
  const stack = require('../scripts/ai-engineering-stack-guardrails');
  assert.equal(typeof stack.buildAiEngineeringStackGuardrailsPlan, 'function');
  assert.equal(typeof stack.formatAiEngineeringStackGuardrailsPlan, 'function');
  assert.equal(typeof stack.normalizeOptions, 'function');
});

test('memory-scope-readiness module exports expected API', () => {
  const readiness = require('../scripts/memory-scope-readiness');
  assert.equal(typeof readiness.buildMemoryScopeReadinessReport, 'function');
  assert.equal(typeof readiness.selectRecordsForScope, 'function');
  assert.equal(typeof readiness.normalizeScope, 'function');
  assert.equal(typeof readiness.memoryScopeKey, 'function');
});

// NEW: Enhanced agent-memory-lifecycle with pyramid classification
test('agent-memory-lifecycle pyramid classification exports expected API', () => {
  const ml = require('../scripts/agent-memory-lifecycle');
  assert.equal(typeof ml.classifyPyramidLayer, 'function');
  assert.equal(typeof ml.distillMemoryPyramid, 'function');
  assert.equal(typeof ml.buildMemoryLifecyclePolicy, 'function');
  assert.equal(typeof ml.evaluateMemoryPromotion, 'function');
  assert.deepEqual(ml.PYRAMID_LAYERS, {
    L0_CONVERSATION: 'L0_CONVERSATION',
    L1_ATOM: 'L1_ATOM',
    L2_SCENARIO: 'L2_SCENARIO',
    L3_PERSONA_SOP: 'L3_PERSONA_SOP',
  });
});

// NEW: Embedding quality validation for RAG pipeline governance
test('gemini-embedding-policy produces valid rollout plans for claw agents', () => {
  const embedPolicy = require('../scripts/gemini-embedding-policy');
  assert.equal(typeof embedPolicy.buildGeminiEmbeddingRolloutPlan, 'function');
  
  const plan = embedPolicy.buildGeminiEmbeddingRolloutPlan({
    corpusItems: 1000,
    outputDimensionality: 768,
    task: 'code retrieval',
  });
  
  assert.equal(plan.model, embedPolicy.GEMINI_EMBEDDING_2_MODEL);
  assert.ok(Array.isArray(plan.rolloutSteps));
  assert.ok(plan.rolloutSteps.length > 0);
});

// NEW: Context footprint reduction for efficient agentic memory
test('context-footprint enables token-efficient agentic memory', () => {
  const footprint = require('../scripts/context-footprint');
  assert.equal(typeof footprint.buildContextFootprintReport, 'function');
  assert.equal(typeof footprint.renderSymbolicTaskCanvas, 'function');
  assert.equal(typeof footprint.measureFootprint, 'function');
});

// NEW: Hybrid supervisor for efficient retrieval routing
test('hybrid-supervisor-agent enables efficient retrieval decomposition', () => {
  const hybrid = require('../scripts/hybrid-supervisor-agent');
  assert.equal(typeof hybrid.buildHybridSupervisorPlan, 'function');
  assert.equal(typeof hybrid.classifyHybridQuery, 'function');
  assert.equal(typeof hybrid.evaluateHybridSupervisorRun, 'function');
});

test('temporal decay halves score at one half-life and penalizes invalid dates', () => {
  const decay = require('../scripts/temporal-decay-weighting');
  const now = Date.now;
  Date.now = () => Date.parse('2026-08-11T00:00:00Z');
  try {
    const timestamp = '2026-07-12T00:00:00Z';
    assert.equal(decay.applyTemporalDecay(0.8, timestamp), 0.4);
    assert.ok(Math.abs(decay.applyTemporalDecay(0.8, 'invalid') - 0.08) < Number.EPSILON);
    assert.equal(decay.applyTemporalDecay(0, timestamp), 0);
    assert.throws(() => decay.applyTemporalDecay(1, timestamp, 0), /positive finite/);
  } finally {
    Date.now = now;
  }
});

test('temporal contextual scoring applies tag, active-mode, and reranker policy', () => {
  const decay = require('../scripts/temporal-decay-weighting');
  const now = Date.now;
  Date.now = () => Date.parse('2026-08-11T00:00:00Z');
  try {
    const lesson = { timestamp: '2026-07-12T00:00:00Z', tags: ['rag', 'roi'] };
    const decayed = decay.computeContextualScore(0.8, lesson);
    const tagged = decay.computeContextualScore(0.8, lesson, {
      metadataFilters: { tags: ['rag'] },
      activeMode: true,
    });
    const reranked = decay.computeContextualScore(0.9, {
      timestamp: '2026-08-11T00:00:00Z',
    }, {
      rerankThreshold: 0.5,
      rrfBoost: 2,
      rrfPenalty: 0.2,
    });
    assert.equal(decayed, 0.4);
    assert.ok(tagged > decayed);
    assert.equal(reranked, 0.8889);
    assert.equal(decay.rrfDecay(0.8), 0.8);
    assert.equal(decay.computeContextualScore(0.5, null), 0.05);
  } finally {
    Date.now = now;
  }
});
