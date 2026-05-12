'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluatePromptReadiness,
  formatPromptingPlan,
  planPromptingRun,
} = require('../scripts/prompting-operating-system');

test('planPromptingRun routes research prompts to deep research with citation checks', () => {
  const plan = planPromptingRun({
    request: 'Create a well-researched report with latest sources on agent governance.',
  });

  assert.equal(plan.mode, 'deep-research');
  assert.equal(plan.reasoningBudget, 'deep');
  assert.ok(plan.tools.includes('web-search'));
  assert.ok(plan.trustChecks.includes('cite primary or authoritative sources'));
});

test('decision-support prompts block when high-stakes context is missing', () => {
  const plan = planPromptingRun({
    request: 'Help me choose what job to take.',
  });
  const readiness = evaluatePromptReadiness(plan);

  assert.equal(plan.mode, 'decision-support');
  assert.equal(readiness.allowed, false);
  assert.ok(readiness.hardBlocks.some((gate) => gate.id === 'missing-high-stakes-context'));
});

test('build prompts require code context and focused tests', () => {
  const plan = planPromptingRun({
    request: 'Implement the feature in scripts/foo.js and verify with npm test.',
  });

  assert.equal(plan.mode, 'build');
  assert.ok(plan.tools.includes('repo-inspection'));
  assert.ok(plan.providedContext.includes('target files'));
  assert.ok(plan.providedContext.includes('verification command'));
  assert.ok(plan.trustChecks.includes('run focused tests'));
});

test('attachments add image, document, and data context tools', () => {
  const plan = planPromptingRun({
    request: 'Analyze this material.',
    attachments: [
      { name: 'screenshot.png' },
      { name: 'report.pdf' },
      { name: 'metrics.csv' },
    ],
  });

  assert.ok(plan.tools.includes('vision'));
  assert.ok(plan.tools.includes('document-parser'));
  assert.ok(plan.tools.includes('data-parser'));
  assert.ok(plan.providedContext.includes('image context'));
});

test('formatPromptingPlan renders gates and prompt template', () => {
  const plan = planPromptingRun({ request: 'Compare tools with sources.' });
  const markdown = formatPromptingPlan(plan);

  assert.match(markdown, /Prompting Operating Plan/);
  assert.match(markdown, /Prompt Template/);
});
