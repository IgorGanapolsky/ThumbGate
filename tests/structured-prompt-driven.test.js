'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPromptSyncPlan,
  buildReasonsCanvas,
  evaluateReasonsCanvas,
  formatReasonsCanvas,
} = require('../scripts/structured-prompt-driven');

test('buildReasonsCanvas creates a REASONS artifact from a request and evidence', () => {
  const document = buildReasonsCanvas({
    request: 'Add a single-use credential gate for agent purchases.',
    entities: ['CredentialGrant', 'ApprovalEvidence'],
    approach: 'Plan before minting any credential.',
    files: ['scripts/single-use-credential-gate.js'],
    operations: ['Implement evaluateCredentialUse and test denied cases.'],
    tests: ['npm run test:single-use-credential-gate'],
  });

  assert.equal(document.canvas.requirements[0], 'Add a single-use credential gate for agent purchases.');
  assert.ok(document.canvas.structure.includes('scripts/single-use-credential-gate.js'));
  assert.ok(document.canvas.safeguards.some((item) => item.includes('Verification: npm run test:single-use-credential-gate')));
});

test('evaluateReasonsCanvas blocks incomplete prompts before code generation', () => {
  const evaluation = evaluateReasonsCanvas({
    requirements: [],
    entities: ['User'],
    approach: [],
    structure: [],
    operations: ['Think about it'],
    norms: [],
    safeguards: ['Be careful'],
  });

  assert.equal(evaluation.allowed, false);
  assert.ok(evaluation.gates.some((gate) => gate.id === 'missing-requirements' && gate.severity === 'block'));
  assert.ok(evaluation.gates.some((gate) => gate.id === 'operations-not-testable'));
  assert.ok(evaluation.gates.some((gate) => gate.id === 'safeguards-without-verification'));
});

test('evaluateReasonsCanvas warns when changed code drifts from prompt structure', () => {
  const document = buildReasonsCanvas({
    request: 'Add prompt canvas checker.',
    entities: ['PromptCanvas'],
    approach: ['Use REASONS fields.'],
    structure: ['scripts/structured-prompt-driven.js'],
    operations: ['Implement evaluation gates.'],
    safeguards: ['Verify with node --test tests/structured-prompt-driven.test.js'],
  });
  const evaluation = evaluateReasonsCanvas(document, {
    changedFiles: ['scripts/other-file.js'],
  });

  assert.equal(evaluation.allowed, true);
  assert.ok(evaluation.gates.some((gate) => gate.id === 'code-prompt-drift'));
});

test('buildPromptSyncPlan turns prompt drift into review checklist work', () => {
  const document = buildReasonsCanvas({
    request: 'Ship governed prompt artifacts.',
    entities: ['PromptArtifact'],
    approach: ['Store the canvas with the PR evidence.'],
    structure: ['docs/prompts/governed-prompts.reasons.md'],
    operations: ['Update prompt artifact before code review.'],
    safeguards: ['Evidence gate requires tests before completion claim.'],
  });
  const plan = buildPromptSyncPlan(document, {
    changedFiles: ['scripts/structured-prompt-driven.js'],
  });

  assert.ok(plan.requiredUpdates.includes('sync-structure-with-changed-files'));
  assert.ok(plan.requiredUpdates.includes('add-verification-evidence'));
  assert.ok(plan.reviewChecklist.includes('Update the canvas when implementation reality diverges.'));
});

test('formatReasonsCanvas renders reviewable markdown', () => {
  const document = buildReasonsCanvas({
    request: 'Make AI-generated changes reviewable.',
    entities: ['Canvas'],
    approach: ['Use structured prompt fields.'],
    structure: ['scripts/structured-prompt-driven.js'],
    operations: ['Return gates with score.'],
    safeguards: ['Run focused tests before merge.'],
  });
  const markdown = formatReasonsCanvas(document);

  assert.match(markdown, /Requirements/);
  assert.match(markdown, /Safeguards/);
  assert.match(markdown, /Readiness: ready/);
});
