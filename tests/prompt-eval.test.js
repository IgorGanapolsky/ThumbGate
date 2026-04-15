const test = require('node:test');
const assert = require('node:assert/strict');

const {
  UNSAFE_CASES,
  SAFE_CASES,
  runPromptEval,
  computeRubricScores,
  computeDomainBreakdown,
  formatReport,
} = require('../scripts/prompt-eval');

// ---------------------------------------------------------------------------
// Corpus validation
// ---------------------------------------------------------------------------

test('corpus has exactly 25 unsafe and 25 safe cases', () => {
  assert.equal(UNSAFE_CASES.length, 25, `Expected 25 unsafe cases, got ${UNSAFE_CASES.length}`);
  assert.equal(SAFE_CASES.length, 25, `Expected 25 safe cases, got ${SAFE_CASES.length}`);
});

test('all cases have required fields', () => {
  for (const tc of [...UNSAFE_CASES, ...SAFE_CASES]) {
    assert.ok(tc.id, `Case missing id`);
    assert.ok(tc.tool, `Case ${tc.id} missing tool`);
    assert.ok(tc.input, `Case ${tc.id} missing input`);
    assert.ok(tc.domain, `Case ${tc.id} missing domain`);
    assert.ok(tc.reason, `Case ${tc.id} missing reason`);
  }
});

test('case ids are unique', () => {
  const ids = [...UNSAFE_CASES, ...SAFE_CASES].map(tc => tc.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, 'Duplicate case IDs found');
});

test('domains cover git, npm, sql, deploy', () => {
  const domains = new Set([...UNSAFE_CASES, ...SAFE_CASES].map(tc => tc.domain));
  for (const expected of ['git', 'npm', 'sql', 'deploy']) {
    assert.ok(domains.has(expected), `Missing domain: ${expected}`);
  }
});

// ---------------------------------------------------------------------------
// Eval runner
// ---------------------------------------------------------------------------

test('runPromptEval returns a complete report', () => {
  const report = runPromptEval();

  assert.equal(report.totalCases, 50);
  assert.equal(report.unsafeCases, 25);
  assert.equal(report.safeCases, 25);

  // Metrics shape
  assert.ok('blockAccuracy' in report.metrics);
  assert.ok('falsePositiveRate' in report.metrics);
  assert.ok('precision' in report.metrics);
  assert.ok('recall' in report.metrics);
  assert.ok('f1' in report.metrics);
  assert.ok('truePositives' in report.metrics);
  assert.ok('trueNegatives' in report.metrics);
  assert.ok('falsePositives' in report.metrics);
  assert.ok('falseNegatives' in report.metrics);

  // Rubric shape
  assert.ok(report.rubric.weightedScore >= 1 && report.rubric.weightedScore <= 5);
  assert.ok(['A', 'B', 'C', 'D'].includes(report.rubric.grade));

  // Domain breakdown
  for (const domain of ['git', 'npm', 'sql', 'deploy']) {
    assert.ok(domain in report.domainBreakdown, `Missing domain breakdown: ${domain}`);
  }

  // Case results
  assert.equal(report.caseResults.length, 50);
});

test('metrics are within valid ranges', () => {
  const report = runPromptEval();
  const m = report.metrics;

  assert.ok(m.blockAccuracy >= 0 && m.blockAccuracy <= 1);
  assert.ok(m.falsePositiveRate >= 0 && m.falsePositiveRate <= 1);
  assert.ok(m.precision >= 0 && m.precision <= 1);
  assert.ok(m.recall >= 0 && m.recall <= 1);
  assert.ok(m.f1 >= 0 && m.f1 <= 1);
  assert.equal(m.truePositives + m.falseNegatives, 25);
  assert.equal(m.trueNegatives + m.falsePositives, 25);
});

// ---------------------------------------------------------------------------
// Rubric scoring
// ---------------------------------------------------------------------------

test('computeRubricScores produces valid scores', () => {
  const mockResults = [
    { expect: 'block', correct: true, domain: 'git', id: 'git-force-push' },
    { expect: 'block', correct: false, domain: 'npm', id: 'npm-publish-public' },
    { expect: 'pass', correct: true, domain: 'deploy', id: 'ls-project' },
    { expect: 'pass', correct: false, domain: 'sql', id: 'sql-select' },
  ];

  const scores = computeRubricScores(mockResults);
  assert.ok(scores.threatDetection.score >= 1 && scores.threatDetection.score <= 5);
  assert.ok(scores.falsePositiveControl.score >= 1 && scores.falsePositiveControl.score <= 5);
  assert.ok(scores.domainCoverage.score >= 1 && scores.domainCoverage.score <= 5);
  assert.ok(scores.severityAlignment.score >= 1 && scores.severityAlignment.score <= 5);
  assert.ok(scores.weightedScore >= 1 && scores.weightedScore <= 5);
});

// ---------------------------------------------------------------------------
// Domain breakdown
// ---------------------------------------------------------------------------

test('computeDomainBreakdown covers all domains', () => {
  const report = runPromptEval();
  const breakdown = report.domainBreakdown;

  for (const domain of ['git', 'npm', 'sql', 'deploy']) {
    assert.ok(breakdown[domain].total > 0, `Domain ${domain} has no cases`);
    assert.ok(breakdown[domain].accuracy >= 0 && breakdown[domain].accuracy <= 1);
  }
});

// ---------------------------------------------------------------------------
// Report formatter
// ---------------------------------------------------------------------------

test('formatReport produces readable text', () => {
  const report = runPromptEval();
  const text = formatReport(report);

  assert.ok(text.includes('ThumbGate Prompt Eval Report'));
  assert.ok(text.includes('Block Accuracy'));
  assert.ok(text.includes('False Positive Rate'));
  assert.ok(text.includes('LLM Rubric'));
  assert.ok(text.includes('Domain Breakdown'));
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('each case result has expected fields', () => {
  const report = runPromptEval();

  for (const cr of report.caseResults) {
    assert.ok(cr.id);
    assert.ok(cr.tool);
    assert.ok(['block', 'pass', 'warn'].includes(cr.actual));
    assert.ok(['block', 'pass'].includes(cr.expect));
    assert.ok(typeof cr.correct === 'boolean');
  }
});
