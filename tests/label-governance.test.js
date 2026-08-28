'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  CANONICAL_PREFIXES,
  CANONICAL_TAXONOMIES,
  STANDARD_GITHUB_LABELS,
  classifyLabel,
  auditLabels,
  suggestLabels,
  formatLabelAuditReport,
} = require('../scripts/label-governance');

describe('Label Governance & Archiving Engine', () => {
  test('classifyLabel correctly identifies canonical fleet labels', () => {
    const res1 = classifyLabel('priority:p0');
    assert.equal(res1.category, 'canonical');
    assert.equal(res1.isArchived, false);

    const res2 = classifyLabel('area:gateway');
    assert.equal(res2.category, 'canonical');

    const res3 = classifyLabel('status:ready');
    assert.equal(res3.category, 'canonical');

    const res4 = classifyLabel('type:bug');
    assert.equal(res4.category, 'canonical');
  });

  test('classifyLabel identifies standard GitHub labels and explicitly archived labels', () => {
    const std = classifyLabel('bug');
    assert.equal(std.category, 'standard');
    assert.equal(std.isArchived, false);

    const archived = classifyLabel({ name: 'old-campaign-2025', isArchived: true });
    assert.equal(archived.category, 'archived');
    assert.equal(archived.isArchived, true);
  });

  test('classifyLabel flags ad-hoc unmanaged labels as candidate for archiving', () => {
    const adhoc = classifyLabel('temp-hack-testing');
    assert.equal(adhoc.category, 'archived_candidate');
    assert.equal(adhoc.isArchived, false);
  });

  test('auditLabels computes taxonomy conformance score and recommendations', () => {
    const sampleLabels = [
      { name: 'priority:p0' },
      { name: 'area:security' },
      { name: 'bug' },
      { name: 'documentation' },
      { name: 'ad-hoc-promo-tag' },
      { name: 'old-q1-experiment', isArchived: true },
    ];

    const result = auditLabels(sampleLabels);
    assert.equal(result.total, 6);
    assert.equal(result.canonicalCount, 2);
    assert.equal(result.standardCount, 2);
    assert.equal(result.archivedCount, 1);
    assert.equal(result.candidateCount, 1);
    assert.equal(result.conformanceRate, 66.7);
    assert.equal(result.candidateLabels[0], 'ad-hoc-promo-tag');
    assert.ok(result.recommendations.length > 0);
  });

  test('suggestLabels deterministically infers labels from title, files, and content', () => {
    const suggestions1 = suggestLabels({
      title: 'fix(server): resolve dashboard crash on startup',
      files: ['public/dashboard.html', 'src/api/server.js'],
    });

    assert.ok(suggestions1.suggestedLabels.includes('type:bug'));
    assert.ok(suggestions1.suggestedLabels.includes('area:dashboard'));
    assert.ok(suggestions1.suggestedLabels.includes('area:control-plane'));
    assert.ok(suggestions1.suggestedLabels.includes('status:ready'));

    const suggestions2 = suggestLabels({
      title: 'feat(webmcp): add origin trial token for security gateway',
      files: ['tests/webmcp-governance.test.js'],
      isReviewReady: true,
    });

    assert.ok(suggestions2.suggestedLabels.includes('type:feature'));
    assert.ok(suggestions2.suggestedLabels.includes('area:webmcp'));
    assert.ok(suggestions2.suggestedLabels.includes('area:security'));
    assert.ok(suggestions2.suggestedLabels.includes('status:review'));
  });

  test('formatLabelAuditReport renders clean markdown report', () => {
    const sampleLabels = [
      { name: 'priority:p1' },
      { name: 'stale-campaign' },
    ];
    const audit = auditLabels(sampleLabels);
    const report = formatLabelAuditReport(audit);

    assert.match(report, /GitHub Label Governance & Archiving Audit/);
    assert.match(report, /Taxonomy Conformance/);
    assert.match(report, /Candidate Labels for GitHub Archiving/);
  });
});
