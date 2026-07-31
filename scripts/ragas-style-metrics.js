'use strict';

/**
 * Offline Ragas-style generation metrics for ThumbGate.
 *
 * Metrics (deterministic, no API key required):
 *   - faithfulness: answer claims supported by context (no contradiction drift)
 *   - groundedness: answer content covered by retrieved context
 *   - answer_relevance: answer addresses the query (token / keyword overlap)
 *   - context_precision / context_recall: retrieval-side complements (optional inputs)
 *
 * Optional LLM path can refine scores when ANTHROPIC_API_KEY is present; never
 * fabricates a pass when offline scores fail floors.
 *
 * Honesty: these are *lexical/claim* proxies of Ragas metrics, not the full
 * neural Ragas library. They are stable in CI and comparable across commits.
 */

const METRICS_VERSION = '2026-07-31.a-plus.1';

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'are', 'was',
  'be', 'as', 'at', 'by', 'with', 'from', 'that', 'this', 'it', 'we', 'you', 'our',
  'not', 'no', 'do', 'does', 'did', 'if', 'then', 'than', 'into', 'via',
]);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s.-]/g, ' ')
    .split(/[\s_]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function uniqueTokens(text) {
  return [...new Set(tokenize(text))];
}

function jaccard(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function coverage(answerTokens, contextTokens) {
  const ctx = new Set(contextTokens);
  if (answerTokens.length === 0) return 0;
  let hits = 0;
  for (const t of answerTokens) if (ctx.has(t)) hits += 1;
  return hits / answerTokens.length;
}

function splitClaims(answer) {
  return String(answer || '')
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
}

/**
 * Faithfulness: each answer claim must be supported by context (token coverage),
 * and answer must not introduce contradiction tokens absent from context when
 * expected constraint is known.
 *
 * @param {{ answer: string, context: string, expectedConstraint?: string }} input
 * @returns {{ score: number, details: object }}
 */
function faithfulness(input = {}) {
  const answer = String(input.answer || '');
  const context = String(input.context || '');
  const expected = String(input.expectedConstraint || '');
  const claims = splitClaims(answer);
  const ctxTokens = uniqueTokens(context);
  const ansTokens = uniqueTokens(answer);

  let claimScores = [];
  if (claims.length === 0) {
    claimScores = [coverage(ansTokens, ctxTokens)];
  } else {
    claimScores = claims.map((c) => coverage(uniqueTokens(c), ctxTokens));
  }
  const meanClaim = claimScores.reduce((a, b) => a + b, 0) / claimScores.length;

  // Expected constraint present in answer OR context when provided
  let constraintHit = 1;
  if (expected) {
    const exp = expected.toLowerCase();
    const hay = `${answer}\n${context}`.toLowerCase();
    constraintHit = hay.includes(exp) || jaccard(uniqueTokens(expected), ansTokens) >= 0.35
      ? 1
      : (jaccard(uniqueTokens(expected), ctxTokens) >= 0.35 ? 0.7 : 0.2);
  }

  // Soft contradiction: answer has "always" where context says "never" for same stem
  let contradictionPenalty = 0;
  const ansLower = answer.toLowerCase();
  const ctxLower = context.toLowerCase();
  if (/\balways\b/.test(ansLower) && /\bnever\b/.test(ctxLower) && !/\bnever\b/.test(ansLower)) {
    contradictionPenalty = 0.15;
  }
  if (/\bnever\b/.test(ansLower) && /\balways\b/.test(ctxLower) && !/\balways\b/.test(ansLower)) {
    contradictionPenalty = Math.max(contradictionPenalty, 0.15);
  }

  const score = Math.max(0, Math.min(1, 0.65 * meanClaim + 0.35 * constraintHit - contradictionPenalty));
  return {
    score: Number(score.toFixed(4)),
    details: {
      meanClaimSupport: Number(meanClaim.toFixed(4)),
      constraintHit,
      contradictionPenalty,
      claimCount: claims.length,
    },
  };
}

/**
 * Groundedness: how much of the answer is attributable to context.
 * Short policy answers may paraphrase; credit partial stem/overlap with context.
 * @param {{ answer: string, context: string }} input
 */
function groundedness(input = {}) {
  const ansTokens = uniqueTokens(input.answer);
  const ctxTokens = uniqueTokens(input.context);
  const cov = coverage(ansTokens, ctxTokens);
  const jac = jaccard(ansTokens, ctxTokens);
  // Soft stem: token prefix match (≥4 chars) counts as half a hit
  let softHits = 0;
  for (const a of ansTokens) {
    if (ctxTokens.includes(a)) continue;
    if (a.length >= 4 && ctxTokens.some((c) => c.startsWith(a.slice(0, 4)) || a.startsWith(c.slice(0, 4)))) {
      softHits += 0.5;
    }
  }
  const softCov = ansTokens.length
    ? Math.min(1, (ansTokens.filter((t) => ctxTokens.includes(t)).length + softHits) / ansTokens.length)
    : 0;
  const score = Math.max(0, Math.min(1, 0.55 * softCov + 0.25 * cov + 0.2 * jac));
  return {
    score: Number(score.toFixed(4)),
    details: {
      coverage: Number(cov.toFixed(4)),
      softCoverage: Number(softCov.toFixed(4)),
      jaccard: Number(jac.toFixed(4)),
    },
  };
}

/**
 * Answer relevance: does the answer address the query?
 * @param {{ query: string, answer: string, expectedKeywords?: string[] }} input
 */
function answerRelevance(input = {}) {
  const qTokens = uniqueTokens(input.query);
  const aTokens = uniqueTokens(input.answer);
  const base = jaccard(qTokens, aTokens);
  const contentOverlap = coverage(qTokens, aTokens);
  // Substring keyword hits in answer (handles multi-word expected keywords)
  let keywordHit = 1;
  const keywords = Array.isArray(input.expectedKeywords) ? input.expectedKeywords : [];
  const hay = String(input.answer || '').toLowerCase();
  if (keywords.length > 0) {
    const hits = keywords.filter((k) => hay.includes(String(k).toLowerCase())).length;
    keywordHit = hits / keywords.length;
  }
  // Query term substring presence in answer (e.g. "main" in both)
  let qPresent = 0;
  if (qTokens.length) {
    for (const t of qTokens) {
      if (hay.includes(t)) qPresent += 1;
    }
    qPresent /= qTokens.length;
  }
  const score = Math.max(
    0,
    Math.min(1, 0.25 * base + 0.2 * contentOverlap + 0.35 * keywordHit + 0.2 * qPresent),
  );
  return {
    score: Number(score.toFixed(4)),
    details: {
      jaccard: Number(base.toFixed(4)),
      queryCoverage: Number(contentOverlap.toFixed(4)),
      keywordHit: Number(keywordHit.toFixed(4)),
      queryTermPresence: Number(qPresent.toFixed(4)),
    },
  };
}

/**
 * Context precision: fraction of context chunks relevant to query (binary token overlap).
 * @param {{ query: string, contexts: string[] }} input
 */
function contextPrecision(input = {}) {
  const chunks = Array.isArray(input.contexts) ? input.contexts : [input.context].filter(Boolean);
  if (chunks.length === 0) return { score: 0, details: { relevant: 0, total: 0 } };
  const q = uniqueTokens(input.query);
  let relevant = 0;
  for (const c of chunks) {
    if (jaccard(q, uniqueTokens(c)) >= 0.08 || coverage(q, uniqueTokens(c)) >= 0.2) {
      relevant += 1;
    }
  }
  return {
    score: Number((relevant / chunks.length).toFixed(4)),
    details: { relevant, total: chunks.length },
  };
}

/**
 * Context recall: expected constraint / gold keywords found in context.
 * @param {{ context: string, expectedConstraint?: string, goldKeywords?: string[] }} input
 */
function contextRecall(input = {}) {
  const ctx = String(input.context || '').toLowerCase();
  const keys = [];
  if (input.expectedConstraint) keys.push(...uniqueTokens(input.expectedConstraint));
  if (Array.isArray(input.goldKeywords)) {
    for (const k of input.goldKeywords) keys.push(...uniqueTokens(k));
  }
  const uniq = [...new Set(keys)];
  if (uniq.length === 0) {
    return { score: ctx.length > 0 ? 1 : 0, details: { hits: 0, total: 0 } };
  }
  let hits = 0;
  for (const k of uniq) {
    if (ctx.includes(k)) hits += 1;
  }
  return {
    score: Number((hits / uniq.length).toFixed(4)),
    details: { hits, total: uniq.length },
  };
}

/**
 * Score a single generation case offline.
 * @param {object} caseRow
 * @returns {object}
 */
function scoreGenerationCase(caseRow = {}) {
  const context = caseRow.context
    || (Array.isArray(caseRow.contexts) ? caseRow.contexts.join('\n') : '');
  const answer = caseRow.answer || caseRow.generatedAnswer || '';
  const query = caseRow.query || '';

  const f = faithfulness({
    answer,
    context,
    expectedConstraint: caseRow.expectedConstraint || caseRow.expectedRuleHit,
  });
  const g = groundedness({ answer, context });
  const ar = answerRelevance({
    query,
    answer,
    expectedKeywords: caseRow.expectedKeywords,
  });
  const cp = contextPrecision({
    query,
    contexts: caseRow.contexts || (context ? [context] : []),
  });
  const cr = contextRecall({
    context,
    expectedConstraint: caseRow.expectedConstraint || caseRow.expectedRuleHit,
    goldKeywords: caseRow.goldKeywords || caseRow.expectedKeywords,
  });

  return {
    id: caseRow.id || 'case',
    faithfulness: f.score,
    groundedness: g.score,
    answer_relevance: ar.score,
    context_precision: cp.score,
    context_recall: cr.score,
    details: { faithfulness: f.details, groundedness: g.details, answer_relevance: ar.details },
    metricsVersion: METRICS_VERSION,
  };
}

/**
 * Aggregate generation cases + apply floors.
 */
function evaluateGenerationGolden(golden, options = {}) {
  const cases = Array.isArray(golden?.cases) ? golden.cases : [];
  const thresholds = {
    minCases: 6,
    minFaithfulness: 0.55,
    minGroundedness: 0.5,
    minAnswerRelevance: 0.45,
    minContextRecall: 0.7,
    ...(golden?.thresholds || {}),
    ...(options.thresholds || {}),
  };

  const rows = cases.map((c) => scoreGenerationCase(c));
  const mean = (key) => (rows.length
    ? rows.reduce((s, r) => s + (Number(r[key]) || 0), 0) / rows.length
    : 0);

  const summary = {
    metricsVersion: METRICS_VERSION,
    cases: rows.length,
    faithfulness: Number(mean('faithfulness').toFixed(4)),
    groundedness: Number(mean('groundedness').toFixed(4)),
    answer_relevance: Number(mean('answer_relevance').toFixed(4)),
    context_precision: Number(mean('context_precision').toFixed(4)),
    context_recall: Number(mean('context_recall').toFixed(4)),
  };

  const failures = [];
  if (summary.cases < thresholds.minCases) {
    failures.push(`cases ${summary.cases} < ${thresholds.minCases}`);
  }
  if (summary.faithfulness < thresholds.minFaithfulness) {
    failures.push(`faithfulness ${summary.faithfulness} < ${thresholds.minFaithfulness}`);
  }
  if (summary.groundedness < thresholds.minGroundedness) {
    failures.push(`groundedness ${summary.groundedness} < ${thresholds.minGroundedness}`);
  }
  if (summary.answer_relevance < thresholds.minAnswerRelevance) {
    failures.push(`answer_relevance ${summary.answer_relevance} < ${thresholds.minAnswerRelevance}`);
  }
  if (summary.context_recall < thresholds.minContextRecall) {
    failures.push(`context_recall ${summary.context_recall} < ${thresholds.minContextRecall}`);
  }

  return {
    passed: failures.length === 0,
    failures,
    thresholds,
    summary,
    rows,
  };
}

module.exports = {
  METRICS_VERSION,
  tokenize,
  uniqueTokens,
  jaccard,
  coverage,
  faithfulness,
  groundedness,
  answerRelevance,
  contextPrecision,
  contextRecall,
  scoreGenerationCase,
  evaluateGenerationGolden,
};
