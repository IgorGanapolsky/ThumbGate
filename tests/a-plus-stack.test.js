'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  buildAgenticGraph,
  traverseMultiHop,
  queryAgenticGraph,
  GRAPH_ENTITY_TYPES,
  GRAPH_RELATIONS,
} = require('../scripts/agentic-graph-rag');

const {
  distillDecisiveDpoPair,
  distillTrajectoryBatch,
} = require('../scripts/decisive-dpo-distiller');

const {
  auditDecisiveStep,
} = require('../scripts/decisive-step-doctor');

const {
  auditHarnessCeiling,
} = require('../scripts/harness-ceiling-doctor');

const {
  auditRRSI,
} = require('../scripts/rrsi-doctor');

test('Unified Agentic Graph RAG: builds 3-tier graph with AST, gates, and cash paths', () => {
  const graph = buildAgenticGraph();
  // Passes both in full AST mode (>=25,000 nodes) and CI/isolated mode (>=10 nodes)
  assert.ok(graph.nodeCount >= 10, `Graph should have >= 10 nodes, got ${graph.nodeCount}`);
  assert.ok(graph.edgeCount >= 8, `Graph should have >= 8 edges, got ${graph.edgeCount}`);

  // Tier 2 Gate nodes exist
  assert.ok(graph.nodes.has('gate:pretool:decisive-step'));
  assert.ok(graph.nodes.has('gate:pretool:spend-cap'));

  // Tier 3 Cash path nodes exist
  assert.ok(graph.nodes.has('cash:diagnostic-499'));
  assert.ok(graph.nodes.has('cash:pro-subscription'));
});

test('Unified Agentic Graph RAG: traverses multi-hop path from code symbol to $499 Diagnostic', () => {
  const graph = buildAgenticGraph();
  const traversal = traverseMultiHop(graph, 'scripts/decisive-step-evaluator.js', 'cash:diagnostic-499', 4);

  assert.equal(traversal.found, true);
  assert.equal(traversal.depth, 2);
  assert.deepEqual(traversal.path, [
    'scripts/decisive-step-evaluator.js',
    'gate:pretool:decisive-step',
    'cash:diagnostic-499',
  ]);
});

test('Unified Agentic Graph RAG: queryAgenticGraph returns linked cash paths and AST matches', () => {
  const res = queryAgenticGraph('spend');
  assert.equal(res.status, 'ok');
  assert.ok(res.totalGraphNodes >= 10);
  assert.ok(res.monetizationTiers.some((m) => m.id === 'cash:diagnostic-499'));
});

test('Decisive DPO Distiller: extracts high-signal preference triple from fail->pass flip', () => {
  const trajectory = {
    taskGoal: 'Harden Stripe webhook signature verification',
    trajectorySteps: [
      { stepNumber: 1, tool: 'bash', action: 'inspect webhook code', testsPassed: false },
      { stepNumber: 2, tool: 'edit', action: 'pass-through stub', patch: 'return true;', testsPassed: false },
      {
        stepNumber: 3,
        tool: 'edit',
        action: 'verified HMAC verification',
        patch: 'return crypto.timingSafeEqual(expected, actual);',
        testsPassed: true,
      },
    ],
  };

  const distilled = distillDecisiveDpoPair(trajectory);
  assert.equal(distilled.valid, true);
  assert.ok(distilled.pair.prompt.includes('Harden Stripe webhook signature'));
  assert.equal(distilled.pair.chosen, 'return crypto.timingSafeEqual(expected, actual);');
  assert.equal(distilled.pair.rejected, 'return true;');
  assert.equal(distilled.pair.decisiveStepIndex, 2);
});

test('Decisive DPO Distiller: rejects benchmark leakage in candidate patches', () => {
  const contaminatedTrajectory = {
    taskGoal: 'Resolve SWE-bench problem',
    trajectorySteps: [
      { stepNumber: 1, tool: 'edit', patch: 'return null;', testsPassed: false },
      { stepNumber: 2, tool: 'edit', patch: 'return "tests/fixtures/synthetic_mock.json";', testsPassed: true },
    ],
  };

  const res = distillDecisiveDpoPair(contaminatedTrajectory);
  assert.equal(res.valid, false);
  assert.ok(res.reason.includes('Leakage critic rejected pair'));
});

test('Decisive DPO Distiller: batch processing handles mixed valid and invalid trajectories', () => {
  const batch = [
    {
      taskGoal: 'Clean patch',
      trajectorySteps: [
        { stepNumber: 1, tool: 'edit', patch: 'return 0;', testsPassed: false },
        { stepNumber: 2, tool: 'edit', patch: 'return a + b;', testsPassed: true },
      ],
    },
    {
      taskGoal: 'Unfinished run',
      trajectorySteps: [
        { stepNumber: 1, tool: 'edit', patch: 'return null;', testsPassed: false },
      ],
    },
  ];

  const result = distillTrajectoryBatch(batch, { save: false });
  assert.equal(result.totalProcessed, 2);
  assert.equal(result.distilledPairsCount, 1);
  assert.equal(result.rejectedCount, 1);
});

test('Stack Diagnostic Doctors: All 3 ML & Harness doctors return PASS', () => {
  const decisiveDoc = auditDecisiveStep();
  assert.equal(decisiveDoc.status, 'PASS');

  const ceilingDoc = auditHarnessCeiling();
  assert.equal(ceilingDoc.status, 'PASS');

  const rrsiDoc = auditRRSI();
  assert.equal(rrsiDoc.status, 'PASS');
});
