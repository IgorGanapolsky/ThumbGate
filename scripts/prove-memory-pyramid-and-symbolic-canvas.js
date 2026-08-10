#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  PYRAMID_LAYERS,
  classifyPyramidLayer,
  distillMemoryPyramid,
} = require('./agent-memory-lifecycle');
const {
  renderSymbolicTaskCanvas,
  compactSymbolicTaskCanvas,
  buildContextFootprintReport,
} = require('./context-footprint');

function proveMemoryPyramidAndSymbolicCanvas() {
  console.log('--- Proving High-ROI Memory Pyramid & Symbolic Task Canvas ---');

  // 1. Prove Semantic Memory Pyramid Classification & Distillation
  const sampleMemories = [
    {
      type: 'preference',
      tags: ['sop', 'guardrail'],
      content: 'NEVER approve PR or satisfy branch protection without human review',
    },
    {
      type: 'procedural',
      tags: ['workflow'],
      content: 'Multi-agent parallel execution sequence and lock coordination',
    },
    {
      type: 'semantic',
      whatWentWrong: 'Passed raw 500KB transcript to prompt',
      whatWorked: 'Compacted with Symbolic Task Canvas',
    },
    {
      type: 'working',
      content: 'Raw subagent output chunk #14',
    },
  ];

  const pyramidReport = distillMemoryPyramid(sampleMemories);
  assert.strictEqual(pyramidReport.kind, 'semantic-memory-pyramid');
  assert.strictEqual(pyramidReport.totalMemories, 4);
  assert.strictEqual(pyramidReport.layers.L3_PERSONA_SOP.count, 1);
  assert.strictEqual(pyramidReport.layers.L2_SCENARIO.count, 1);
  assert.strictEqual(pyramidReport.layers.L1_ATOM.count, 1);
  assert.strictEqual(pyramidReport.layers.L0_CONVERSATION.count, 1);
  console.log('✔ Semantic Memory Pyramid (L0-L3) classification & distillation verified');


  // 2. Prove Symbolic Task Canvas Generation
  const canvas = renderSymbolicTaskCanvas({
    activeTask: 'Refactor Context Engine',
    milestones: [
      { name: 'Implement L0-L3 Pyramid Classifier', status: 'completed' },
      { name: 'Wire Symbolic Task Canvas Generator', status: 'completed' },
      { name: 'Verify Token Savings', status: 'in_progress' },
    ],
    blockers: [],
  });

  assert.strictEqual(canvas.milestoneCount, 3);
  assert.match(canvas.mermaidDiagram, /graph TD/);

  assert.match(canvas.mermaidDiagram, /Implement L0-L3 Pyramid Classifier \[DONE\]/);
  console.log('✔ Symbolic Task Canvas (Mermaid state graph) generation verified');

  // 3. Prove Token Footprint Compaction & Report Integration
  const verboseTrace = Array.from({ length: 15 }, (_, i) => ({
    step: i,
    rawLog: `Verbose interaction step ${i} with heavy transcript chatter and raw tool calls`,
  }));

  const footprintReport = buildContextFootprintReport({
    entries: verboseTrace,
    symbolicCanvas: true,
    activeTask: 'Proof Task',
  });

  assert.ok(footprintReport.symbolicTaskCanvas);
  assert.ok(footprintReport.symbolicTaskCanvas.footprint.savings.estimatedTokens > 0);
  console.log(
    `✔ Context Footprint Compaction verified: Saved ${footprintReport.symbolicTaskCanvas.footprint.savings.estimatedTokens} tokens (${footprintReport.symbolicTaskCanvas.footprint.savings.reductionPercent}% reduction)`,
  );

  console.log('--- ALL HIGH-ROI PROOFS PASSED CLEANLY ---');
  return true;
}

if (process.argv[1] && require('node:path').resolve(process.argv[1]) === require('node:path').resolve(__filename)) {
  proveMemoryPyramidAndSymbolicCanvas();
}

module.exports = { proveMemoryPyramidAndSymbolicCanvas };
