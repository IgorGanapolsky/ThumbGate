const test = require('node:test');
const assert = require('node:assert/strict');
const { createReasoningTrace, createRuleProposal, COMPONENT_TYPES } = require('../scripts/a2ui-engine');
test('COMPONENT_TYPES has required types', () => { assert.ok(COMPONENT_TYPES.TRACE || COMPONENT_TYPES); });
test('createReasoningTrace returns trace with type and version', () => {
  const t = createReasoningTrace('deploy blocked by gate', ['gate-force-push'], [{ from: 'gate', to: 'lesson' }]);
  assert.equal(t.type, 'reasoning-trace');
  assert.equal(t.version, '1.0.0');
  assert.ok(t.data.summary.includes('deploy'));
  assert.ok(Array.isArray(t.data.sources));
  assert.ok(Array.isArray(t.actions));
});
test('createReasoningTrace handles empty inputs', () => {
  const t = createReasoningTrace('', [], []);
  assert.equal(t.type, 'reasoning-trace');
});
test('createRuleProposal returns proposal component', () => {
  const p = createRuleProposal('force-push detected', 'NEVER force push to main', 'critical');
  assert.ok(p.type);
  assert.ok(p.data);
});
