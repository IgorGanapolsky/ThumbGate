'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectRepositoryEvidence,
  evaluateReadiness,
  formatMarkdown,
  isCliEntrypoint,
} = require('../scripts/a-plus-evidence-scorecard');

function allRepositoryEvidence() {
  return Object.fromEntries(
    Object.keys(collectRepositoryEvidence()).map((key) => [key, true]),
  );
}

function completeLiveEvidence() {
  return {
    production: {
      candidateBuildSha: 'abcdef1234567890',
      deployedBuildSha: 'abcdef1234567890',
      landingVerified: true,
      feedbackLoopVerified: true,
      providerTraceVerified: true,
      loadTestPassed: true,
      p95LatencyMs: 240,
      cacheAndBatchingMeasured: true,
    },
    retrieval: {
      queryTransformationHoldoutPassed: true,
      neuralRerankHoldoutPassed: true,
      llmRerankFailureModesPassed: true,
      externalHoldoutCases: 100,
      judgeCalibrationPassed: true,
    },
    security: {
      tenantPenTestPassed: true,
      failureDrillPassed: true,
    },
    commercial: {
      buyerConversations: 10,
      paymentAsks: 3,
      externalPayments: 1,
      providerRevenueVerified: true,
    },
  };
}

test('scorecard fails closed when live and commercial evidence is absent', () => {
  const report = evaluateReadiness({ repo: allRepositoryEvidence() });
  assert.equal(report.atTarget, false);
  assert.notEqual(report.grade, 'A+');
  assert.ok(report.blockers.some((row) => row.evidenceClass === 'production'));
  assert.ok(report.blockers.some((row) => row.evidenceClass === 'provider'));
});

test('a deployed SHA mismatch cannot receive full landing credit', () => {
  const live = completeLiveEvidence();
  live.production.deployedBuildSha = 'different1234567';
  const report = evaluateReadiness({ repo: allRepositoryEvidence(), live });
  const landing = report.areas.find((area) => area.id === 'landing_conversion');
  assert.ok(landing.score < 10);
  assert.equal(report.atTarget, false);
});

test('A+ and 10/10 require every evidence surface', () => {
  const report = evaluateReadiness({
    repo: allRepositoryEvidence(),
    live: completeLiveEvidence(),
  });
  assert.equal(report.score, 10);
  assert.equal(report.grade, 'A+');
  assert.equal(report.atTarget, true);
  assert.equal(report.blockers.length, 0);
});

test('current repository evidence is collected and rendered', () => {
  const repo = collectRepositoryEvidence();
  assert.equal(repo.landingVisualLoop, true);
  assert.equal(repo.deterministicMultiQuery, true);
  assert.equal(repo.commandPositionHardening, true);
  assert.equal(repo.rawFrameworkDecisionDefended, true);
  const markdown = formatMarkdown(evaluateReadiness({ repo }));
  assert.match(markdown, /Target verified: \*\*NO\*\*/);
  assert.match(markdown, /Remaining evidence blockers/);
});

test('CLI entrypoint detection is path-based and import-safe', () => {
  assert.equal(isCliEntrypoint(['node', require.resolve('../scripts/a-plus-evidence-scorecard')]), true);
  assert.equal(isCliEntrypoint(['node', __filename]), false);
  assert.equal(isCliEntrypoint(['node']), false);
});
