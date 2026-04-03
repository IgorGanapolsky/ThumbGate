#!/usr/bin/env node
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  augmentDpoExport,
  extractPrinciple,
  generateScenarioVariations,
  buildContrastivePairs,
  truncate,
} = require('../scripts/synthetic-dpo');
const { withUnlicensedEnvironment } = require('./helpers/unlicensed-environment');

// ── Test fixtures ──────────────────────────────────────────────────

const MOCK_DPO_EXPORT = {
  pairs: [
    {
      prompt: 'Task domain: verification, feedback. How should the agent handle this scenario?',
      chosen: 'Run tests and include output before saying complete.',
      rejected: 'Claimed completion without running tests.',
      metadata: {
        errorId: 'E1',
        learningId: 'L1',
        matchScore: 3,
        overlapScore: 2,
        matchedKeys: ['verification', 'feedback'],
        errorTitle: 'MISTAKE: Claimed done with no test proof',
        learningTitle: 'SUCCESS: Always run tests before completion claims',
        rubric: { learningWeightedScore: 0.89, errorWeightedScore: 0.32, weightedDelta: 0.57 },
        distractorCount: 0,
      },
    },
  ],
  unpairedErrors: [
    {
      id: 'E2',
      title: 'MISTAKE: Force-pushed to main',
      content: 'Force-pushed to main branch without review.',
      category: 'error',
      tags: ['git', 'force-push'],
    },
    {
      id: 'E3',
      title: 'MISTAKE: Dropped production table',
      content: 'Ran DROP TABLE on production without backup.',
      category: 'error',
      tags: ['database', 'production'],
    },
  ],
  unpairedLearnings: [
    {
      id: 'L2',
      title: 'SUCCESS: Used branch protection rules',
      content: 'Branch protection prevented accidental force-push to main.',
      category: 'learning',
      tags: ['git', 'protection'],
    },
  ],
  errors: [],
  learnings: [],
};

// ── Unit tests ─────────────────────────────────────────────────────

describe('synthetic-dpo', () => {
  test('truncate shortens strings and adds ellipsis', () => {
    assert.equal(truncate('short', 10), 'short');
    assert.equal(truncate('a long string that exceeds', 10), 'a long ...');
    assert.equal(truncate('exactly10!', 10), 'exactly10!');
  });

  test('extractPrinciple generates domain-specific principle', () => {
    const pair = MOCK_DPO_EXPORT.pairs[0];
    const principle = extractPrinciple(pair);

    assert.ok(principle.domain.includes('verification'), 'domain includes matched key');
    assert.ok(principle.anti_pattern.length > 0, 'has anti-pattern');
    assert.ok(principle.correct_pattern.length > 0, 'has correct pattern');
    assert.ok(principle.principle.includes('verification'), 'principle mentions domain');
    assert.ok(principle.principle.includes('avoid'), 'principle uses avoid framing');
    assert.ok(principle.principle.includes('instead'), 'principle uses instead framing');
  });

  test('extractPrinciple truncates long content', () => {
    const longPair = {
      ...MOCK_DPO_EXPORT.pairs[0],
      rejected: 'A'.repeat(200),
      chosen: 'B'.repeat(200),
    };
    const principle = extractPrinciple(longPair);
    assert.ok(principle.anti_pattern.length <= 123, 'anti-pattern truncated');
    assert.ok(principle.correct_pattern.length <= 123, 'correct-pattern truncated');
  });

  test('generateScenarioVariations creates 2 variations with matched keys', () => {
    const pair = MOCK_DPO_EXPORT.pairs[0];
    const variations = generateScenarioVariations(pair);

    assert.equal(variations.length, 2, 'generates 2 variations with matched keys');

    // Both keep same chosen/rejected
    for (const v of variations) {
      assert.equal(v.chosen, pair.chosen, 'preserves chosen');
      assert.equal(v.rejected, pair.rejected, 'preserves rejected');
      assert.equal(v.metadata.synthetic, true, 'marked as synthetic');
      assert.equal(v.metadata.syntheticType, 'scenario_variation');
    }

    assert.equal(variations[0].metadata.syntheticVariant, 'avoidance_framing');
    assert.equal(variations[1].metadata.syntheticVariant, 'best_practice_framing');
  });

  test('generateScenarioVariations creates 1 variation without matched keys', () => {
    const pair = {
      ...MOCK_DPO_EXPORT.pairs[0],
      metadata: { ...MOCK_DPO_EXPORT.pairs[0].metadata, matchedKeys: [] },
    };
    const variations = generateScenarioVariations(pair);
    assert.equal(variations.length, 1, 'only avoidance framing without matched keys');
  });

  test('buildContrastivePairs matches unpaired errors and learnings', () => {
    const pairs = buildContrastivePairs(
      MOCK_DPO_EXPORT.unpairedErrors,
      MOCK_DPO_EXPORT.unpairedLearnings,
    );

    // E2 (git, force-push) should match L2 (git, protection) on "git"
    assert.equal(pairs.length, 1, 'builds 1 contrastive pair');
    assert.equal(pairs[0].metadata.errorId, 'E2');
    assert.equal(pairs[0].metadata.learningId, 'L2');
    assert.equal(pairs[0].metadata.synthetic, true, 'marked synthetic');
    assert.equal(pairs[0].metadata.syntheticType, 'contrastive_pair');
    assert.ok(pairs[0].metadata.matchedKeys.includes('git'), 'matched on "git"');
  });

  test('buildContrastivePairs returns empty for no overlap', () => {
    const errors = [{ id: 'X1', title: 'ERROR: alpha', content: 'nothing', tags: ['xyz'] }];
    const learnings = [{ id: 'Y1', title: 'SUCCESS: beta', content: 'nothing', tags: ['abc'] }];
    const pairs = buildContrastivePairs(errors, learnings);
    assert.equal(pairs.length, 0, 'no pairs when no overlap');
  });

  // ── Integration tests ──────────────────────────────────────────

  test('augmentDpoExport increases total pair count', () => {
    const result = augmentDpoExport(MOCK_DPO_EXPORT, { skipProCheck: true });

    assert.equal(result.originalPairs, 1, 'preserves original count');
    assert.ok(result.syntheticPairs > 0, `generated ${result.syntheticPairs} synthetic pairs`);
    assert.equal(result.totalPairs, result.originalPairs + result.syntheticPairs);
    assert.equal(result.pairs.length, result.totalPairs, 'pairs array matches total');
  });

  test('augmentDpoExport extracts principles', () => {
    const result = augmentDpoExport(MOCK_DPO_EXPORT, { skipProCheck: true });

    assert.equal(result.principles.length, 1, '1 principle per original pair');
    assert.ok(result.principles[0].domain.includes('verification'));
    assert.ok(result.principles[0].principle.length > 0);
  });

  test('augmentDpoExport respects feature flags', () => {
    const noVariations = augmentDpoExport(MOCK_DPO_EXPORT, {
      scenarioVariations: false,
      contrastivePairing: false,
      principleExtraction: false,
      skipProCheck: true,
    });

    assert.equal(noVariations.syntheticPairs, 0, 'no synthetic pairs with all flags off');
    assert.equal(noVariations.principles.length, 0, 'no principles with flag off');
    assert.equal(noVariations.totalPairs, 1, 'only original pair');
  });

  test('augmentDpoExport returns proRequired when not licensed', () => {
    const result = withUnlicensedEnvironment(() => augmentDpoExport(MOCK_DPO_EXPORT, {
      skipProCheck: false,
    }), { prefix: 'thumbgate-synthetic-dpo-test-' });

    assert.equal(result.proRequired, true, 'proRequired flag set');
    assert.equal(result.syntheticPairs, 0, 'no synthetic pairs without Pro');
    assert.equal(result.totalPairs, 1, 'only original pairs returned');
  });

  test('augmentDpoExport handles empty DPO export', () => {
    const empty = { pairs: [], unpairedErrors: [], unpairedLearnings: [] };
    const result = augmentDpoExport(empty, { skipProCheck: true });

    assert.equal(result.originalPairs, 0);
    assert.equal(result.syntheticPairs, 0);
    assert.equal(result.totalPairs, 0);
    assert.equal(result.principles.length, 0);
  });

  test('augmentDpoExport synthetic pairs have correct metadata structure', () => {
    const result = augmentDpoExport(MOCK_DPO_EXPORT, { skipProCheck: true });

    const synthetics = result.pairs.filter((p) => p.metadata?.synthetic);
    assert.ok(synthetics.length > 0, 'has synthetic pairs');

    for (const s of synthetics) {
      assert.equal(s.metadata.synthetic, true, 'synthetic flag');
      assert.ok(['scenario_variation', 'contrastive_pair'].includes(s.metadata.syntheticType), 'valid type');
      assert.ok(s.prompt, 'has prompt');
      assert.ok(s.chosen, 'has chosen');
      assert.ok(s.rejected, 'has rejected');
    }
  });

  test('augmentDpoExport scenario + contrastive counts are correct', () => {
    const result = augmentDpoExport(MOCK_DPO_EXPORT, { skipProCheck: true });

    const scenarios = result.pairs.filter((p) => p.metadata?.syntheticType === 'scenario_variation');
    const contrastive = result.pairs.filter((p) => p.metadata?.syntheticType === 'contrastive_pair');

    // 1 original pair with 2 matched keys → 2 scenario variations
    assert.equal(scenarios.length, 2, '2 scenario variations from 1 pair with matched keys');
    // E2 (git) matches L2 (git) → 1 contrastive pair
    assert.equal(contrastive.length, 1, '1 contrastive pair from unpaired');
    // Total synthetic = 2 + 1 = 3
    assert.equal(result.syntheticPairs, 3, 'total synthetic = 3');
  });
});
