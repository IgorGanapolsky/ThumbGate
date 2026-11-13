'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { StateTransitionTracker } = require('../src/state-transition-tracker');
const { NicheTrendScanner } = require('../scripts/niche-trend-scanner');

test('StateTransitionTracker tracks entity property versions and cascades staleness', () => {
  const tracker = new StateTransitionTracker();

  // Register that task-99 depends on user_123:role
  tracker.registerDependency('task-99', 'user_123', 'role');

  // Initial state transition
  const res1 = tracker.recordTransition({
    entityId: 'user_123',
    property: 'role',
    newValue: 'admin',
    mutatedBy: 'billing_webhook',
  });

  assert.equal(res1.transition.version, 1);
  assert.deepEqual(res1.invalidatedDependents, ['task-99']);
  assert.equal(tracker.isDecisionStale('task-99'), true);

  // Materialized state returns current truth in O(1)
  const mat = tracker.getMaterializedState('user_123');
  assert.equal(mat.role, 'admin');

  // Second mutation: role changed to 'suspended'
  const res2 = tracker.recordTransition({
    entityId: 'user_123',
    property: 'role',
    newValue: 'suspended',
    mutatedBy: 'admin_action',
  });

  assert.equal(res2.transition.version, 2);
  assert.equal(res2.transition.oldValue, 'admin');
  assert.equal(tracker.getMaterializedState('user_123').role, 'suspended');

  // Resolving stale decision
  tracker.resolveStaleDecision('task-99');
  assert.equal(tracker.isDecisionStale('task-99'), false);
});

test('NicheTrendScanner scores incoming content for defensible moats', () => {
  const scanner = new NicheTrendScanner();
  const text = 'We need automated mutation testing and zero-downtime database migration for our enterprise AI coding harness.';
  const scores = scanner.scoreTextForNiches(text);

  assert.ok(scores.regulated_enterprise_governance);
  assert.ok(scores.regulated_enterprise_governance.isHighSignalOpportunity);
  assert.ok(scores.regulated_enterprise_governance.score >= 2);

  const brief = scanner.generateMediaBrief('regulated_enterprise_governance', 'The 2026 Enterprise Moat Stack');
  assert.ok(brief.headline);
  assert.ok(brief.callToAction.includes('https://thumbgate.ai/diagnostic'));
});
