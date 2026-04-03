'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMPONENT_TYPES,
  createReasoningTrace,
  createRuleProposal,
} = require('../scripts/a2ui-engine');

test('A2UI exposes the expected component types', () => {
  assert.deepEqual(COMPONENT_TYPES, {
    REASONING_TRACE: 'reasoning-trace',
    RULE_PROPOSAL: 'rule-proposal',
    CONFLICT_VETO: 'conflict-veto',
    METRIC_DYNAMIC: 'metric-dynamic',
  });
});

test('createReasoningTrace maps sources and graph links into renderable payloads', () => {
  const result = createReasoningTrace(
    'The same merge failure repeated twice.',
    [
      { id: 'fb_1', context: 'Merged before CI was green.', signal: 'negative' },
      { id: 'fb_2', content: 'Added exact-main verification step.' },
    ],
    [
      { sourceId: 'fb_1', targetId: 'fb_2', relation: 'corrected-by' },
    ],
  );

  assert.equal(result.type, COMPONENT_TYPES.REASONING_TRACE);
  assert.equal(result.version, '1.0.0');
  assert.equal(result.data.summary, 'The same merge failure repeated twice.');
  assert.deepEqual(result.data.sources, [
    { id: 'fb_1', text: 'Merged before CI was green.', signal: 'negative' },
    { id: 'fb_2', text: 'Added exact-main verification step.', signal: 'neutral' },
  ]);
  assert.deepEqual(result.data.graph, [
    { from: 'fb_1', to: 'fb_2', label: 'corrected-by' },
  ]);
  assert.deepEqual(result.actions, [
    { id: 'view-logs', label: 'View Raw Logs', type: 'primary' },
  ]);
});

test('createRuleProposal returns an approval-ready proposal card', () => {
  const result = createRuleProposal(
    'merge-before-green',
    'NEVER merge before exact main CI is green.',
    'high',
  );

  assert.equal(result.type, COMPONENT_TYPES.RULE_PROPOSAL);
  assert.equal(result.version, '1.0.0');
  assert.deepEqual(result.data, {
    pattern: 'merge-before-green',
    suggestedRule: 'NEVER merge before exact main CI is green.',
    severity: 'high',
  });
  assert.deepEqual(result.actions, [
    { id: 'approve', label: 'Approve ALWAYS/NEVER', type: 'success' },
    { id: 'refine', label: 'Tweak Wording', type: 'secondary' },
    { id: 'veto', label: 'Veto Rule', type: 'danger' },
  ]);
});
