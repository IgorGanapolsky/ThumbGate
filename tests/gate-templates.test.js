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
  assert.ok(templates.some((template) => template.category === 'Supply Chain Safety'));
  assert.ok(templates.some((template) => template.category === 'Document RAG Safety'));
  assert.ok(templates.some((template) => template.id === 'require-image-pointer-grounding'));
  assert.ok(templates.some((template) => template.category === 'Sparse Attention Runtime Safety'));
  assert.ok(templates.some((template) => template.id === 'require-hybrid-prefix-cache-coherence-eval'));
  assert.ok(templates.some((template) => template.category === 'AI Engineering Stack Safety'));
  assert.ok(templates.some((template) => template.id === 'require-ai-gateway-control-plane'));
  assert.ok(templates.some((template) => template.id === 'require-agent-context-freshness'));
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
  assert.equal(summary.categories['Supply Chain Safety'], 4);
  assert.equal(summary.categories['Document RAG Safety'], 7);
  assert.equal(summary.categories['Sparse Attention Runtime Safety'], 6);
  assert.equal(summary.categories['AI Engineering Stack Safety'], 5);
  assert.equal(summary.byAction.block, templates.filter((template) => template.defaultAction === 'block').length);
  assert.equal(summary.byAction.warn, templates.filter((template) => template.defaultAction === 'warn').length);
  assert.equal(summary.byAction.allow, 1);
});
