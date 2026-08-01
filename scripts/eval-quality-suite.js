#!/usr/bin/env node
'use strict';

/**
 * Unified bounded offline evaluation suite:
 *   1) IR ranking — Recall@k / MRR / nDCG / Precision@k (retrieval-ranking-golden)
 *   2) Generation quality — faithfulness / groundedness / answer_relevance (offline)
 *
 * Exit 0 only when both floors pass. Offline by default (no API key required).
 *
 *   npm run eval:quality
 *   node scripts/eval-quality-suite.js --json
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  evaluateRankingGolden,
  formatRankingReport,
} = require('./retrieval-ranking-eval');
const {
  evaluateGenerationGolden,
  METRICS_VERSION,
} = require('./ragas-style-metrics');

const ROOT = path.join(__dirname, '..');
const GEN_GOLDEN = path.join(ROOT, 'config', 'evals', 'generation-quality-golden.json');
const REPORT_MD = path.join(ROOT, 'reports', 'eval-quality-suite.md');
const REPORT_JSON = path.join(ROOT, 'reports', 'eval-quality-suite.json');
const SUITE_VERSION = '2026-07-31.a-plus.1';

function loadGenerationGolden() {
  return JSON.parse(fs.readFileSync(GEN_GOLDEN, 'utf8'));
}

/**
 * Drop expectFail / known-bad demos from floor means (still reported in rows).
 */
function filterGenerationCases(golden) {
  const cases = (golden.cases || []).filter((c) => !c.expectFail);
  return { ...golden, cases };
}

function runSuite(options = {}) {
  const ranking = evaluateRankingGolden({
    goldenPath: options.rankingGoldenPath,
    thresholds: options.rankingThresholds,
  });

  const genGoldenRaw = options.generationGolden || loadGenerationGolden();
  const genGolden = filterGenerationCases(genGoldenRaw);
  const generation = evaluateGenerationGolden(genGolden, {
    thresholds: options.generationThresholds,
  });

  // Also score known-bad cases for diagnostics (must score worse on faithfulness)
  const badCases = (genGoldenRaw.cases || []).filter((c) => c.expectFail || c.id === 'ungrounded-contradiction');
  const badScores = badCases.map((c) => require('./ragas-style-metrics').scoreGenerationCase(c));

  const failures = [
    ...(ranking.passed ? [] : ranking.failures.map((f) => `ranking: ${f}`)),
    ...(generation.passed ? [] : generation.failures.map((f) => `generation: ${f}`)),
  ];

  // Integrity: bad contradiction sample should not beat good faithfulness mean
  if (badScores.length > 0 && generation.summary.faithfulness > 0) {
    const badFaith = badScores.reduce((s, r) => s + r.faithfulness, 0) / badScores.length;
    if (badFaith >= generation.summary.faithfulness) {
      failures.push(
        `integrity: bad-case faithfulness ${badFaith.toFixed(3)} >= good mean ${generation.summary.faithfulness}`,
      );
    }
  }

  const report = {
    suiteVersion: SUITE_VERSION,
    metricsVersion: METRICS_VERSION,
    passed: failures.length === 0,
    failures,
    ranking: {
      passed: ranking.passed,
      failures: ranking.failures,
      summary: ranking.summary,
      thresholds: ranking.thresholds,
      queryCount: ranking.perQuery?.length || 0,
    },
    generation: {
      passed: generation.passed,
      failures: generation.failures,
      summary: generation.summary,
      thresholds: generation.thresholds,
      caseCount: generation.rows?.length || 0,
      badCaseDiagnostics: badScores,
    },
    grades: {
      recallAtK: ranking.passed ? 'A+' : 'fail',
      mrr: ranking.passed ? 'A+' : 'fail',
      ndcg: ranking.passed ? 'A+' : 'fail',
      precisionAtK: ranking.passed ? 'A+' : 'fail',
      faithfulness: generation.passed ? 'A+' : 'fail',
      groundedness: generation.passed ? 'A+' : 'fail',
      answerRelevance: generation.passed ? 'A+' : 'fail',
      overall: failures.length === 0 ? 'A+' : 'fail',
    },
  };

  return { report, ranking, generation };
}

function formatMarkdown(report) {
  const r = report.ranking.summary || {};
  const g = report.generation.summary || {};
  const lines = [
    '# Evaluation quality suite (bounded offline)',
    '',
    `Suite version: \`${report.suiteVersion}\``,
    `Overall: **${report.passed ? 'PASS' : 'FAIL'}** · grade **${report.grades.overall}**`,
    '',
    '## IR ranking (Recall@k / MRR / nDCG / Precision@k)',
    '',
    `| Metric | Value |`,
    `|--------|------:|`,
    `| Queries | ${report.ranking.queryCount} |`,
    `| MRR | ${((r.mrr || 0) * 100).toFixed(1)}% |`,
    `| Recall@5 | ${((r['recall@5'] || 0) * 100).toFixed(1)}% |`,
    `| Precision@5 | ${((r['precision@5'] || 0) * 100).toFixed(1)}% |`,
    `| nDCG@5 | ${((r['ndcg@5'] || 0) * 100).toFixed(1)}% |`,
    `| Ranking gate | ${report.ranking.passed ? 'PASS' : 'FAIL'} |`,
    '',
    '## Generation quality (offline Ragas-style)',
    '',
    `| Metric | Value |`,
    `|--------|------:|`,
    `| Cases | ${report.generation.caseCount} |`,
    `| Faithfulness | ${((g.faithfulness || 0) * 100).toFixed(1)}% |`,
    `| Groundedness | ${((g.groundedness || 0) * 100).toFixed(1)}% |`,
    `| Answer relevance | ${((g.answer_relevance || 0) * 100).toFixed(1)}% |`,
    `| Context recall | ${((g.context_recall || 0) * 100).toFixed(1)}% |`,
    `| Context precision | ${((g.context_precision || 0) * 100).toFixed(1)}% |`,
    `| Generation gate | ${report.generation.passed ? 'PASS' : 'FAIL'} |`,
    '',
    '## Grades',
    '',
    Object.entries(report.grades).map(([k, v]) => `- **${k}**: ${v}`).join('\n'),
    '',
  ];
  if (report.failures.length) {
    lines.push('## Failures', '', ...report.failures.map((f) => `- ${f}`), '');
  }
  lines.push(
    '## Honesty',
    '',
    '- IR metrics use graded qrels on a self-contained golden corpus.',
    '- Generation metrics are offline lexical/claim proxies (not neural Ragas).',
    '- Optional LLM judges may refine scores but cannot invent a pass when floors fail.',
    '',
  );
  return lines.join('\n');
}

function writeReports(report) {
  fs.mkdirSync(path.dirname(REPORT_MD), { recursive: true });
  fs.writeFileSync(REPORT_MD, formatMarkdown(report));
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + '\n');
}

function main() {
  const json = process.argv.includes('--json');
  const { report, ranking } = runSuite();
  writeReports(report);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatMarkdown(report));
    // Also print ranking detail when verbose
    if (process.argv.includes('--verbose') && ranking) {
      console.log('\n' + formatRankingReport(ranking));
    }
    console.error(report.passed
      ? 'eval-quality-suite: PASS (bounded offline floors met)'
      : `eval-quality-suite: FAIL — ${report.failures.join('; ')}`);
  }
  process.exit(report.passed ? 0 : 1);
}

function isCliEntrypoint(argv = process.argv) {
  return Boolean(argv[1]) && path.resolve(argv[1]) === path.resolve(__filename);
}

if (isCliEntrypoint()) {
  main();
}

module.exports = {
  SUITE_VERSION,
  runSuite,
  formatMarkdown,
  loadGenerationGolden,
  GEN_GOLDEN,
  REPORT_MD,
  REPORT_JSON,
  isCliEntrypoint,
};
