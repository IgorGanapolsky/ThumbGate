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

test('autonomous-workflow module exports expected API', () => {
  const workflow = require('../scripts/autonomous-workflow');
  assert.equal(typeof workflow.runAutonomousWorkflow, 'function');
  assert.equal(typeof workflow.resumeAutonomousWorkflow, 'function');
  assert.equal(typeof workflow.readWorkflowReport, 'function');
  assert.equal(typeof workflow.writeWorkflowReport, 'function');
});
