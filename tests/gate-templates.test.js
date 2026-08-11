'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listGateTemplates,
  summarizeGateTemplates,
} = require('../scripts/gate-templates');

test('gate template library exposes curated templates with shared rollout metadata', () => {
  const templates = listGateTemplates();

  assert.equal(Array.isArray(templates), true);
  assert.ok(templates.length >= 6);
  assert.ok(templates.some((template) => template.id === 'never-force-push-main'));
  assert.ok(templates.some((template) => template.id === 'protect-production-sql'));
  assert.ok(templates.some((template) => template.id === 'require-diff-impact-before-central-edit'));
  assert.ok(templates.some((template) => template.category === 'Knowledge Graph Safety'));
  assert.ok(templates.some((template) => template.id === 'block-package-lifecycle-secret-harvest'));
  assert.ok(templates.some((template) => template.id === 'require-local-dependency-vulnerability-scan'));
  assert.ok(templates.some((template) => template.category === 'Supply Chain Safety'));
  assert.ok(templates.some((template) => template.category === 'Document RAG Safety'));
  assert.ok(templates.some((template) => template.id === 'require-image-pointer-grounding'));
  assert.ok(templates.some((template) => template.category === 'Sparse Attention Runtime Safety'));
  assert.ok(templates.some((template) => template.id === 'require-hybrid-prefix-cache-coherence-eval'));
  assert.ok(templates.some((template) => template.category === 'AI Engineering Stack Safety'));
  assert.ok(templates.some((template) => template.id === 'require-ai-gateway-control-plane'));
  assert.ok(templates.some((template) => template.id === 'require-agent-context-freshness'));
  assert.ok(templates.some((template) => template.id === 'require-human-in-the-loop-pause'));
  assert.ok(templates.some((template) => template.category === 'Nous Research Hermes Agent Governance'));
  assert.ok(templates.some((template) => template.id === 'block-unauthorized-multi-channel-posts'));
  assert.ok(templates.some((template) => template.id === 'careful-mode'));
  assert.ok(templates.some((template) => template.id === 'freeze-mode'));
  assert.ok(templates.some((template) => template.category === 'On-Demand Dynamic Gating'));

  // vlt / JavaScript Package Registry Governance templates
  assert.ok(templates.some((template) => template.category === 'JavaScript Package Registry Governance'));
  assert.ok(templates.some((template) => template.id === 'block-vlt-install-vulnerable-deps'));
  assert.ok(templates.some((template) => template.id === 'require-review-vlt-registry-override'));
  assert.ok(templates.some((template) => template.id === 'enforce-vlt-workspace-dep-pinning'));
  assert.ok(templates.some((template) => template.id === 'gate-vlt-package-publishing'));
  assert.ok(templates.some((template) => template.id === 'block-vlt-private-registry-bypass'));

  // All three categories of vlt gate severity
  assert.ok(templates.some((template) => template.id === 'block-vlt-install-vulnerable-deps' && template.severity === 'critical'));
  assert.ok(templates.some((template) => template.id === 'enforce-vlt-workspace-dep-pinning' && template.severity === 'high'));

  // context-engineering gate template
  assert.ok(templates.some((template) => template.id === 'validate-context-before-codegen'));
  assert.ok(templates.some((template) => template.category === 'AI Engineering Stack Safety' && template.id === 'validate-context-before-codegen'));

  // Nemotron / NeMo Switchyard multi-model routing governance
  assert.ok(templates.some((template) => template.id === 'require-multi-model-routing-for-complex-tasks'));
  assert.ok(templates.some((template) => template.id === 'checkpoint-model-step-routing-decision'));
  assert.ok(templates.some((template) => template.id === 'require-routing-evidence-for-cost-savings'));
  assert.ok(templates.some((template) => template.id === 'recommend-specialized-models-by-task'));
  // Qwen Agent Governance templates
  assert.ok(templates.some((template) => template.category === 'Qwen Agent Governance'));
  assert.ok(templates.some((template) => template.id === 'gate-qwen-model-studio-egress'));
  assert.ok(templates.some((template) => template.id === 'block-unverified-qwen-gui-actions'));
||||||| f1b48e78a

  assert.ok(templates.every((template) => template.category));
  assert.ok(templates.every((template) => template.problem));
  assert.ok(templates.every((template) => template.roi));
  assert.ok(templates.every((template) => template.rollout));
});

test('gate template library summary groups templates by category and action', () => {
  const templates = listGateTemplates();
  const summary = summarizeGateTemplates();

  assert.equal(summary.total, templates.length);
  assert.equal(summary.categories['Git Safety'], 1);
  assert.equal(summary.categories['Verification'], 1);
  assert.equal(summary.categories['Knowledge Graph Safety'], 3);
  assert.equal(summary.categories['Supply Chain Safety'], 5);
  assert.equal(summary.categories['Document RAG Safety'], 7);
  assert.equal(summary.categories['Sparse Attention Runtime Safety'], 6);
  assert.equal(summary.categories['AI Engineering Stack Safety'], 7);
  assert.equal(summary.categories['On-Demand Dynamic Gating'], 2);
  assert.equal(summary.categories['JavaScript Package Registry Governance'], 5);
  assert.equal(summary.byAction.block, templates.filter((template) => template.defaultAction === 'block').length);
  assert.equal(summary.byAction.warn, templates.filter((template) => template.defaultAction === 'warn').length);
  assert.equal(summary.byAction.allow, templates.filter((template) => template.defaultAction === 'allow').length);
});
