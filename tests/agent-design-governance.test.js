'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAgentDesignGovernancePlan,
  normalizeOptions,
  scoreToolRisk,
} = require('../scripts/agent-design-governance');

test('agent design governance keeps simple workflows single-agent while requiring evals', () => {
  const plan = buildAgentDesignGovernancePlan({
    workflow: 'lesson recall before PR review',
    tools: ['search_lessons', 'prevention_rules', 'dashboard'],
    docs: true,
    examples: true,
    'edge-cases': true,
    'exit-condition': true,
  });

  assert.equal(plan.recommendation.architecture, 'single_agent');
  assert.equal(plan.instructionQuality.score, 100);
  assert.equal(plan.status, 'needs_work');
  assert.ok(plan.blockers.some((blocker) => blocker.id === 'baseline_evals_required'));
});

test('agent design governance recommends manager pattern for tool overload', () => {
  const plan = buildAgentDesignGovernancePlan({
    workflow: 'support automation',
    'tool-count': 14,
    'similar-tool-count': 5,
    'conditional-branches': 10,
    'baseline-evals': true,
    docs: true,
    examples: true,
    'edge-cases': true,
    'exit-condition': true,
    'tool-approvals': true,
    'reversible-actions': true,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.recommendation.architecture, 'manager');
  assert.ok(plan.recommendation.triggers.includes('tool_overload'));
  assert.ok(plan.recommendation.triggers.includes('instruction_complexity'));
});

test('agent design governance blocks high-risk tools without approvals', () => {
  const options = normalizeOptions({
    tools: ['stripe_refund', 'send_email'],
    'write-tools': 'stripe_refund,send_email',
  });
  const risk = scoreToolRisk(options);
  const plan = buildAgentDesignGovernancePlan({
    workflow: 'billing recovery agent',
    tools: ['stripe_refund', 'send_email'],
    'write-tools': 'stripe_refund,send_email',
    'baseline-evals': true,
  });

  assert.equal(risk.risk, 'high');
  assert.equal(plan.status, 'blocked');
  assert.ok(plan.blockers.some((blocker) => blocker.id === 'tool_approval_required'));
});
