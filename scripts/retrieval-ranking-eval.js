#!/usr/bin/env node
'use strict';

/**
 * Rank a self-contained golden corpus with the same scoring stack gates use
 * (scoreRelevance + field-weighted BM25 rerank) and compute Recall@k / MRR / nDCG.
 *
 * This is the ranking evaluation path — distinct from skill-pack keyword smoke.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  scoreRanking,
  aggregateRankingScores,
} = require('./ir-metrics');

const DEFAULT_GOLDEN_PATH = path.join(
  __dirname,
  '..',
  'config',
  'evals',
  'retrieval-ranking-golden.json',
);

function loadGolden(goldenPath = DEFAULT_GOLDEN_PATH) {
  const raw = fs.readFileSync(goldenPath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.corpus) || !Array.isArray(data.queries)) {
    throw new TypeError('retrieval golden must include corpus[] and queries[]');
  }
  return data;
}

/**
 * Build a memory-shaped record so lesson-retrieval scorers accept it.
 */
function corpusToMemory(doc) {
  return {
    id: doc.id,
    title: doc.title || '',
    content: doc.content || '',
    signal: doc.signal || '',
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    metadata: { ...(doc.metadata || {}) },
    structuredRule: doc.structuredRule || null,
    whatWentWrong: /MISTAKE|NEVER|negative/i.test(`${doc.title} ${doc.signal}`)
      ? doc.content
      : '',
    whatToChange: doc.content,
    timestamp: doc.timestamp || new Date().toISOString(),
  };
}

/**
 * Rank corpus for one query using pragmatic multi-stage hybrid
 * (turbopuffer-style: multi-query features + attribute boost + RRF-capable + BM25 rerank).
 */
function rankCorpusForQuery(corpus, queryCase, options = {}) {
  const { buildActionSignature } = require('./lesson-retrieval');
  const { pragmaticHybridSearch } = require('./pragmatic-hybrid-search');

  const toolName = queryCase.toolName || options.toolName || 'Bash';
  const actionContext = String(queryCase.query || '');
  const topK = options.topK || 10;
  const memories = (corpus || []).map(corpusToMemory);

  const { results, meta } = pragmaticHybridSearch({
    corpus: memories,
    query: actionContext,
    toolName,
    options: {
      topK,
      pool: Math.min(50, memories.length),
      diversify: options.diversify !== false,
      denseRankedIds: options.denseRankedIds || queryCase.denseRankedIds || [],
    },
  });

  return {
    ranked: results,
    signature: typeof buildActionSignature === 'function'
      ? buildActionSignature(toolName, actionContext)
      : null,
    poolSize: meta.fused || meta.lexicalPool || results.length,
    meta,
  };
}

function evaluateRankingGolden(options = {}) {
  const goldenPath = options.goldenPath || DEFAULT_GOLDEN_PATH;
  const golden = options.golden || loadGolden(goldenPath);
  const kValues = golden.kValues || [1, 5, 10];
  const topK = options.topK || Math.max(...kValues, 10);
  const thresholds = { ...(golden.thresholds || {}), ...(options.thresholds || {}) };

  const perQuery = [];
  const bySlice = {};

  for (const q of golden.queries) {
    const { ranked, poolSize } = rankCorpusForQuery(golden.corpus, q, { topK });
    const metrics = scoreRanking(ranked, q.qrels || {}, { kValues });
    const row = {
      id: q.id,
      slice: q.slice || 'default',
      query: q.query,
      toolName: q.toolName || '',
      poolSize,
      rankedIds: ranked.map((r) => r.id),
      metrics,
    };
    perQuery.push(row);
    const slice = row.slice;
    if (!bySlice[slice]) bySlice[slice] = [];
    bySlice[slice].push(metrics);
  }

  const summary = aggregateRankingScores(
    perQuery.map((r) => r.metrics),
    { kValues },
  );
  summary.queries = perQuery.length;

  const sliceSummary = {};
  for (const [slice, scores] of Object.entries(bySlice)) {
    sliceSummary[slice] = aggregateRankingScores(scores, { kValues });
    sliceSummary[slice].queries = scores.length;
  }

  const failures = [];
  if (summary.queries < (thresholds.minQueries || 1)) {
    failures.push(`queries ${summary.queries} < ${thresholds.minQueries}`);
  }
  if (thresholds.minMrr != null && summary.mrr < thresholds.minMrr) {
    failures.push(`mrr ${summary.mrr.toFixed(3)} < ${thresholds.minMrr}`);
  }
  if (thresholds.minRecallAt5 != null && summary['recall@5'] < thresholds.minRecallAt5) {
    failures.push(`recall@5 ${summary['recall@5'].toFixed(3)} < ${thresholds.minRecallAt5}`);
  }
  if (thresholds.minNdcgAt5 != null && summary['ndcg@5'] < thresholds.minNdcgAt5) {
    failures.push(`ndcg@5 ${summary['ndcg@5'].toFixed(3)} < ${thresholds.minNdcgAt5}`);
  }
  if (thresholds.minExactMrr != null && sliceSummary.exact) {
    if (sliceSummary.exact.mrr < thresholds.minExactMrr) {
      failures.push(
        `exact-slice mrr ${sliceSummary.exact.mrr.toFixed(3)} < ${thresholds.minExactMrr}`,
      );
    }
  }

  return {
    goldenPath,
    kValues,
    thresholds,
    summary,
    sliceSummary,
    perQuery,
    passed: failures.length === 0,
    failures,
  };
}

function formatRankingReport(result) {
  const s = result.summary;
  const lines = [
    '## Ranking metrics (Recall@k / MRR / nDCG)',
    '',
    `**System under test:** pragmatic hybrid (lexical+attribute first-stage, optional dense multi-query, RRF, BM25 rerank, diversify) — turbopuffer-inspired, local-only`,
    `**Golden:** \`${path.relative(process.cwd(), result.goldenPath) || result.goldenPath}\``,
    `**Queries:** ${s.queries}`,
    `**Gate:** ${result.passed ? 'PASS' : 'FAIL'}`,
    '',
    '| Metric | Value |',
    '|---|---|',
    `| MRR | ${(s.mrr * 100).toFixed(1)}% |`,
    `| Recall@1 | ${((s['recall@1'] || 0) * 100).toFixed(1)}% |`,
    `| Recall@5 | ${((s['recall@5'] || 0) * 100).toFixed(1)}% |`,
    `| Recall@10 | ${((s['recall@10'] || 0) * 100).toFixed(1)}% |`,
    `| Precision@5 | ${((s['precision@5'] || 0) * 100).toFixed(1)}% |`,
    `| nDCG@5 | ${((s['ndcg@5'] || 0) * 100).toFixed(1)}% |`,
    `| nDCG@10 | ${((s['ndcg@10'] || 0) * 100).toFixed(1)}% |`,
    '',
    '### By slice',
    '',
    '| Slice | Queries | MRR | Recall@5 | nDCG@5 |',
    '|---|---|---|---|---|',
  ];
  for (const [slice, stats] of Object.entries(result.sliceSummary || {})) {
    lines.push(
      `| ${slice} | ${stats.queries} | ${(stats.mrr * 100).toFixed(1)}% | ${((stats['recall@5'] || 0) * 100).toFixed(1)}% | ${((stats['ndcg@5'] || 0) * 100).toFixed(1)}% |`,
    );
  }
  lines.push('', '### Per query', '', '| ID | Slice | MRR | R@5 | nDCG@5 | Top-3 |', '|---|---|---|---|---|---|');
  for (const row of result.perQuery) {
    const m = row.metrics;
    lines.push(
      `| ${row.id} | ${row.slice} | ${(m.mrr * 100).toFixed(0)}% | ${((m['recall@5'] || 0) * 100).toFixed(0)}% | ${((m['ndcg@5'] || 0) * 100).toFixed(0)}% | ${(row.rankedIds || []).slice(0, 3).join(', ')} |`,
    );
  }
  if (!result.passed) {
    lines.push('', '### Ranking gate failures', '', ...result.failures.map((f) => `- ${f}`));
  }
  lines.push('');
  return lines.join('\n');
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
}

if (isMain()) {
  const result = evaluateRankingGolden();
  console.log(formatRankingReport(result));
  console.log(JSON.stringify({
    passed: result.passed,
    summary: result.summary,
    failures: result.failures,
  }, null, 2));
  process.exitCode = result.passed ? 0 : 1;
}

module.exports = {
  DEFAULT_GOLDEN_PATH,
  loadGolden,
  corpusToMemory,
  rankCorpusForQuery,
  evaluateRankingGolden,
  formatRankingReport,
};
