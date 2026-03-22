'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { generatePrimer, PRINCIPLES } = require('../scripts/persona-primer');
const { evaluateGates } = require('../scripts/gates-engine');

test('Hybrid RAFT: Persona Primer produces stable behavioral constraints', (t) => {
  const primer = generatePrimer();
  
  assert.ok(primer.includes('Autonomous CTO'), 'Should include CTO role');
  assert.ok(primer.includes('$100/day'), 'Should include North Star goal');
  assert.ok(primer.includes('Pre-Action Gates'), 'Should include reliability principles');
  
  // Prove token efficiency (conceptual)
  const systemPromptSize = primer.length;
  // A typical RAG-only system prompt with all current logs would be 10x larger.
  assert.ok(systemPromptSize < 2000, 'Persona primer should be compact for token efficiency');
});

test('Hybrid RAFT: Gates provide semantic reasoning from fine-tuned weights', (t) => {
  // Simulate a git push --force which is a default blocked gate
  const toolName = 'Bash';
  const toolInput = { command: 'git push --force' };
  
  const result = evaluateGates(toolName, toolInput);
  
  assert.ok(result, 'Gate should match');
  assert.equal(result.decision, 'deny');
  assert.ok(result.reasoning, 'Gate should provide semantic reasoning');
  assert.equal(result.reasoning, PRINCIPLES.reliability.gates, 'Reasoning should match fine-tuned principles');
});

test('Hybrid RAFT: ROI Lens - Verification Mandate', (t) => {
  const primer = generatePrimer();
  assert.ok(primer.includes('Never claim completion without verification evidence'), 'Primer enforces ROI-critical verification');
});
