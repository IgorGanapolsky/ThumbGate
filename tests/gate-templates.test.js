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
  assert.ok(templates.every((template) => template.category));
  assert.ok(templates.every((template) => template.problem));
  assert.ok(templates.every((template) => template.roi));
  assert.ok(templates.every((template) => template.rollout));
});

test('gate template library summary groups templates by category and action', () => {
  const summary = summarizeGateTemplates();

  assert.equal(summary.total, 6);
  assert.equal(summary.categories['Git Safety'], 1);
  assert.equal(summary.categories['Verification'], 1);
  assert.equal(summary.byAction.block, 4);
  assert.equal(summary.byAction.warn, 1);
  assert.equal(summary.byAction.allow, 1);
});
