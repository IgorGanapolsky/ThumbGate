'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  PYRAMID_LAYERS,
  classifyPyramidLayer,
  distillMemoryPyramid,
  buildMemoryLifecyclePolicy,
  buildMemoryLifecycleView,
  evaluateMemoryPromotion,
  extractMemoryEntities,
  inferMemoryScope,
  normalizeMemoryType,
  scoreHybridMemoryMatch,
  scoreMemoryDecay,
} = require('../scripts/agent-memory-lifecycle');

describe('agent-memory-lifecycle', () => {
  it('normalizes memory types correctly', () => {
    assert.equal(normalizeMemoryType('semantic'), 'semantic');
    assert.equal(normalizeMemoryType('UNKNOWN_TYPE'), 'episodic');
  });

  it('classifies memory items into semantic pyramid layers (L0-L3)', () => {
    // L3 Persona / SOP / Guardrail rule
    const l3Rule = classifyPyramidLayer({
      type: 'preference',
      tags: ['sop', 'rule'],
      content: 'Always require human review before publishing',
    });
    assert.equal(l3Rule, PYRAMID_LAYERS.L3_PERSONA_SOP);

    // L2 Scenario / Workflow
    const l2Workflow = classifyPyramidLayer({
      type: 'procedural',
      tags: ['workflow'],
      content: 'Multi-step deployment sequence for Railway backend',
    });
    assert.equal(l2Workflow, PYRAMID_LAYERS.L2_SCENARIO);

    // L1 Atomic Fact / Lesson
    const l1Lesson = classifyPyramidLayer({
      type: 'semantic',
      whatWentWrong: 'Passed non-serializable object',
      whatWorked: 'Use JSON payload string',
    });
    assert.equal(l1Lesson, PYRAMID_LAYERS.L1_ATOM);

    // L0 Conversation / Working Memory
    const l0Raw = classifyPyramidLayer({
      type: 'working',
      content: 'Temporary stdout logs from run_command task 12',
    });
    assert.equal(l0Raw, PYRAMID_LAYERS.L0_CONVERSATION);
  });

  it('distills memory pyramid layers and calculates estimated token metrics', () => {
    const memories = [
      { type: 'preference', content: 'SOP rule 1' },
      { type: 'procedural', content: 'Workflow step 1' },
      { type: 'semantic', whatWorked: 'Lesson 1' },
      { type: 'working', content: 'Log transcript line' },
    ];

    const distillation = distillMemoryPyramid(memories);
    assert.equal(distillation.kind, 'semantic-memory-pyramid');
    assert.equal(distillation.totalMemories, 4);
    assert.equal(distillation.layers.L3_PERSONA_SOP.count, 1);
    assert.equal(distillation.layers.L2_SCENARIO.count, 1);
    assert.equal(distillation.layers.L1_ATOM.count, 1);
    assert.equal(distillation.layers.L0_CONVERSATION.count, 1);
  });

  it('evaluates memory promotion policies', () => {
    const validMemory = {
      type: 'semantic',
      content: 'Proven deployment pattern',
      source: 'commit f31dcdbbe',
      outcome: 'success',
    };
    const evalResult = evaluateMemoryPromotion(validMemory);
    assert.equal(evalResult.decision, 'promote');
    assert.equal(evalResult.retrievalEligible, true);

    const secretMemory = {
      type: 'semantic',
      content: 'API Key is api_key_12345 secret token',
      source: 'test',
      outcome: 'success',
    };
    const secretEval = evaluateMemoryPromotion(secretMemory);
    assert.equal(secretEval.decision, 'hold');
    assert.ok(secretEval.issues.includes('secret_like_content'));
  });

  it('extracts entities and infers memory scope', () => {
    const memory = {
      title: 'Stripe deployment issue on Railway',
      content: 'Updated `npm run build` for Claude Code session',
    };

    const entities = extractMemoryEntities(memory);
    const scope = inferMemoryScope(memory);

    assert.ok(entities.some((e) => e.name === 'Stripe'));
    assert.ok(entities.some((e) => e.name === 'Railway'));
    assert.ok(scope === 'project' || scope === 'task');
  });
});
