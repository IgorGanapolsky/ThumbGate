const test = require('node:test');
const assert = require('node:assert/strict');
const { createReasoningTrace, createRuleProposal, COMPONENT_TYPES } = require('../scripts/a2ui-engine');
test('COMPONENT_TYPES exists', () => { assert.ok(COMPONENT_TYPES); });
test('createReasoningTrace returns trace object', () => {
  const t = createReasoningTrace('deploy blocked', ['gate-1'], []);
  assert.ok(t.id);
  assert.ok(t.type);
});
test('createReasoningTrace handles empty args', () => {
  const t = createReasoningTrace('', [], []);
  assert.ok(t.id);
});
test('createRuleProposal returns proposal', () => {
  const p = createRuleProposal('force-push', 'NEVER force push', 'critical');
  assert.ok(p.id);
});
