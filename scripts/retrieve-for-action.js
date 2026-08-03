#!/usr/bin/env node
'use strict';

/**
 * retrieve-for-action.js — single public contract for PreToolUse / gates RAG.
 *
 * Defended end-to-end path:
 *   1) Corpus: JSONL memory-log (source of truth) + SQLite FTS5 seed when available
 *   2) Lexical first-stage: keyword + char bigram-Jaccard (scoreRelevance)
 *   3) Multi-query: up to 3 variants when top lexical < rewriteBelowScore (default 0.6)
 *   4) Pragmatic hybrid (RRF + attribute boost + BM25F) via pragmatic-hybrid-search
 *   5) Rerank cascade: pairwise heuristic always; LLM listwise when key present (async)
 *   6) Caller gates the next tool call deterministically (hook / gates-engine)
 *
 * Provenance on every result so heuristic scores never masquerade as neural CE.
 */

const path = require('node:path');

const DEFAULT_REWRITE_BELOW = 0.6;
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_CANDIDATE_POOL = 20;

function envFlag(name, defaultTrue = true) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultTrue;
  return !['0', 'false', 'no', 'off'].includes(String(raw).toLowerCase());
}

/**
 * Convert lesson-db FTS rows into memory-log shaped objects for hybrid scoring.
 */
function ftsRowsToMemories(rows = []) {
  return (rows || []).map((row) => {
    const signal = row.signal === 'positive' ? 'positive' : 'negative';
    const titleBits = [
      signal === 'negative' ? 'MISTAKE' : 'SUCCESS',
      row.whatWentWrong || row.whatWorked || row.context || row.id,
    ].filter(Boolean);
    const contentBits = [
      row.context ? `Context: ${row.context}` : null,
      row.whatWentWrong ? `What went wrong: ${row.whatWentWrong}` : null,
      row.whatToChange ? `How to avoid: ${row.whatToChange}` : null,
      row.whatWorked ? `What worked: ${row.whatWorked}` : null,
      row.rootCause ? `Root cause: ${row.rootCause}` : null,
    ].filter(Boolean);
    return {
      id: row.id,
      title: titleBits.join(': ').slice(0, 200),
      content: contentBits.join('\n'),
      tags: [
        ...(Array.isArray(row.tags) ? row.tags : []),
        signal === 'negative' ? 'negative' : 'positive',
      ],
      signal,
      whatWentWrong: row.whatWentWrong || null,
      whatToChange: row.whatToChange || null,
      whatWorked: row.whatWorked || null,
      timestamp: row.timestamp || null,
      metadata: {
        domain: row.domain || null,
        source: 'sqlite-fts5',
        importance: row.importance || null,
        skill: row.skill || null,
      },
      ftsRank: row.rank,
    };
  });
}

/**
 * Seed / merge FTS5 hits into the JSONL corpus. Disabled when:
 * - LESSON_DB_SEARCH=0
 * - scope isolation requested (FTS lacks four-field scope contract)
 * - better-sqlite3 / DB unavailable
 */
function mergeFtsSeed(corpus, query, options = {}) {
  if (options.scope || options.requireScope) {
    return { corpus, fts: { applied: false, reason: 'scoped-isolation' } };
  }
  if (!envFlag('LESSON_DB_SEARCH', true) && options.useFts5 !== true) {
    return { corpus, fts: { applied: false, reason: 'disabled' } };
  }
  try {
    const { initDB, searchLessons, getStats } = require('./lesson-db');
    const db = options.db || initDB(options.dbPath);
    const stats = getStats(db);
    if (!stats || stats.total === 0) {
      return { corpus, fts: { applied: false, reason: 'empty-db', total: 0 } };
    }
    const rows = searchLessons(db, query || '', {
      limit: Math.max(20, options.ftsLimit || 40),
      signal: options.signal,
      domain: options.domain,
      tags: options.tags,
    });
    const ftsMemories = ftsRowsToMemories(rows);
    const byId = new Map();
    for (const mem of corpus || []) {
      if (mem && mem.id) byId.set(mem.id, mem);
    }
    let merged = 0;
    for (const mem of ftsMemories) {
      if (!mem.id) continue;
      if (byId.has(mem.id)) {
        byId.set(mem.id, { ...byId.get(mem.id), ...mem, metadata: {
          ...(byId.get(mem.id).metadata || {}),
          ...(mem.metadata || {}),
          ftsSeeded: true,
        } });
      } else {
        byId.set(mem.id, mem);
        merged += 1;
      }
    }
    return {
      corpus: [...byId.values()],
      fts: {
        applied: true,
        backend: 'sqlite-fts5',
        dbTotal: stats.total,
        hits: ftsMemories.length,
        newlyMerged: merged,
      },
    };
  } catch (err) {
    return {
      corpus,
      fts: { applied: false, reason: 'unavailable', error: String(err?.message || err).slice(0, 120) },
    };
  }
}

function probeTopLexical(corpus, toolName, actionContext) {
  const {
    scoreRelevance,
    buildActionSignature,
  } = require('./lesson-retrieval');
  const actionSig = buildActionSignature(toolName, actionContext);
  let top = 0;
  let topId = null;
  for (const mem of corpus || []) {
    const score = scoreRelevance(mem, toolName, actionContext, actionSig);
    if (score > top) {
      top = score;
      topId = mem.id || null;
    }
  }
  return { topLexical: top, topId };
}

function resolveQueryVariants(actionContext, topLexical, options = {}) {
  const threshold = Number.isFinite(options.rewriteBelowScore)
    ? options.rewriteBelowScore
    : DEFAULT_REWRITE_BELOW;
  if (options.queryRewrite === false || topLexical >= threshold) {
    return {
      variants: [String(actionContext || '').trim()].filter(Boolean),
      rewriteApplied: false,
      strategy: topLexical >= threshold ? 'original-only-strong-lexical' : 'original-only',
      rewriteBelowScore: threshold,
    };
  }
  const { buildQueryVariants } = require('./lesson-retrieval');
  const variants = buildQueryVariants(actionContext, options).slice(0, 3);
  return {
    variants: variants.length ? variants : [String(actionContext || '').trim()].filter(Boolean),
    rewriteApplied: variants.length > 1,
    strategy: variants.length > 1 ? 'deterministic-multi-query' : 'original-only',
    rewriteBelowScore: threshold,
  };
}

function shapeWithProvenance(lesson, meta = {}) {
  const stages = lesson.reranker?.stages || meta.rerankStages || ['first-stage', 'pairwise-heuristic'];
  const fallbacks = lesson.reranker?.fallbacks || [];
  const combined = lesson.combinedScore
    ?? lesson.rerankedScore
    ?? lesson.relevanceScore
    ?? 0;
  return {
    id: lesson.id,
    title: lesson.title,
    content: lesson.content,
    signal: lesson.signal
      || (lesson.tags?.includes('negative') ? 'negative' : 'positive'),
    whatToChange: lesson.whatToChange || null,
    howToAvoid: lesson.howToAvoid || lesson.whatToChange || null,
    whatWentWrong: lesson.whatWentWrong || null,
    tags: lesson.tags || [],
    rule: lesson.rule || lesson.structuredRule || null,
    relevanceScore: combined,
    combinedScore: combined,
    pairwiseHeuristicScore: lesson.pairwiseHeuristicScore ?? null,
    llmRerankScore: lesson.llmRerankScore ?? null,
    crossEncoderScore: lesson.crossEncoderScore ?? null,
    timestamp: lesson.timestamp,
    // Backward-compatible CE shape expected by retrieveWithRerankingSync callers/tests.
    reranker: lesson.reranker || {
      stages,
      fallbacks,
      elapsedMs: meta.elapsedMs || 0,
      llm: null,
    },
    retrieval: {
      ...meta,
      stages,
      fallbacks,
    },
  };
}

/**
 * Synchronous retrieve-for-action (PreToolUse hot path).
 * Always applies heuristic rerank; never blocks on network/LLM.
 */
function retrieveForAction(toolName, actionContext, options = {}) {
  const started = Date.now();
  const maxResults = options.maxResults || DEFAULT_MAX_RESULTS;
  const candidateCount = Math.max(maxResults, options.candidateCount || DEFAULT_CANDIDATE_POOL);

  const { getFeedbackPaths, readJSONL } = require('./feedback-loop');
  const {
    selectRetrievalMemories,
    scoreRelevance,
    buildActionSignature,
    dedupeSupersededLessons,
    filterTopP,
    resolveTopP,
    MAX_RETRIEVAL_MEMORY_LINES,
  } = require('./lesson-retrieval');
  const { pragmaticHybridSearch } = require('./pragmatic-hybrid-search');

  const pathMod = require('node:path');
  const feedbackDir = options.feedbackDir;
  const paths = feedbackDir
    ? { MEMORY_LOG_PATH: pathMod.join(feedbackDir, 'memory-log.jsonl') }
    : getFeedbackPaths();

  let corpus = selectRetrievalMemories(
    readJSONL(paths.MEMORY_LOG_PATH, {
      maxLines: Number(process.env.THUMBGATE_RETRIEVAL_MAX_LINES) || MAX_RETRIEVAL_MEMORY_LINES,
    }),
    options,
  );

  const ftsMerge = mergeFtsSeed(corpus, actionContext, options);
  corpus = ftsMerge.corpus;

  if (corpus.length === 0) {
    return {
      lessons: [],
      meta: {
        backend: ftsMerge.fts?.applied ? 'sqlite-fts5+jsonl' : 'jsonl',
        fts: ftsMerge.fts,
        topLexical: 0,
        rewriteApplied: false,
        queryVariants: [],
        strategy: 'empty-corpus',
        rerankStages: [],
        elapsedMs: Date.now() - started,
      },
    };
  }

  const probe = probeTopLexical(corpus, toolName, actionContext);
  const plan = resolveQueryVariants(actionContext, probe.topLexical, options);

  let results = [];
  let hybridMeta = {};
  try {
    const hybrid = pragmaticHybridSearch({
      corpus,
      query: actionContext,
      toolName,
      options: {
        topK: candidateCount,
        pool: Math.max(50, candidateCount),
        diversify: options.diversify !== false,
        perLimit: options.perLimit || 3,
        attribute: options.attribute,
        queryVariants: plan.variants,
      },
    });
    results = hybrid.results || [];
    hybridMeta = hybrid.meta || {};
  } catch {
    // Classic lexical fallback
    const actionSig = buildActionSignature(toolName, actionContext);
    results = corpus
      .map((mem) => ({
        ...mem,
        relevanceScore: scoreRelevance(mem, toolName, actionContext, actionSig),
      }))
      .filter((m) => m.relevanceScore > 0.1)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, candidateCount);
    hybridMeta = { strategy: 'classic-lexical-fallback' };
  }

  results = dedupeSupersededLessons(results);

  // Pairwise heuristic rerank (always-on; provenance honest)
  const query = `${toolName || ''} ${actionContext || ''}`.trim();
  const heuristic = results.map((candidate) => {
    const text = [
      candidate.title,
      candidate.content,
      candidate.whatWentWrong,
      candidate.whatToChange,
      candidate.howToAvoid,
    ].filter(Boolean).join(' ');
    // Prefer exported helper if combine is private — score inline
    try {
      const { heuristicPairScore: scoreFn } = require('./cross-encoder-reranker');
      return scoreFn(query, text);
    } catch {
      return 0;
    }
  });

  const firstStage = results.map((r) => Number(r.rerankedScore ?? r.relevanceScore ?? 0) || 0);
  const min = Math.min(...firstStage, 0);
  const max = Math.max(...firstStage, 1);
  const normFirst = firstStage.map((v) => (max === min ? 0.5 : (v - min) / (max - min)));

  const reranked = results.map((candidate, index) => {
    const combined = (normFirst[index] * 0.55) + (heuristic[index] * 0.45);
    return {
      ...candidate,
      pairwiseHeuristicScore: heuristic[index],
      combinedScore: Number(combined.toFixed(6)),
      relevanceScore: Number(combined.toFixed(6)),
      reranker: {
        stages: ['first-stage', 'pairwise-heuristic'],
        fallbacks: [],
        elapsedMs: 0,
        llm: null,
      },
    };
  }).sort((a, b) => b.combinedScore - a.combinedScore);

  const topP = typeof resolveTopP === 'function' ? resolveTopP(options) : 1;
  const selected = (typeof filterTopP === 'function'
    ? filterTopP(reranked, topP, { minKeep: options.minKeep })
    : reranked
  ).slice(0, maxResults);

  const meta = {
    backend: ftsMerge.fts?.applied ? 'sqlite-fts5+jsonl-hybrid' : 'jsonl-hybrid',
    fts: ftsMerge.fts,
    topLexical: probe.topLexical,
    topLexicalId: probe.topId,
    rewriteApplied: plan.rewriteApplied,
    rewriteBelowScore: plan.rewriteBelowScore,
    queryVariants: plan.variants,
    strategy: plan.strategy,
    hybrid: hybridMeta,
    rerankStages: ['first-stage', 'pairwise-heuristic'],
    mode: 'sync',
    elapsedMs: Date.now() - started,
  };

  return {
    lessons: selected.map((lesson) => shapeWithProvenance(lesson, meta)),
    meta,
  };
}

/**
 * Async path: same as sync + optional dense multi-query + LLM listwise when key present.
 */
async function retrieveForActionAsync(toolName, actionContext, options = {}) {
  const started = Date.now();
  const maxResults = options.maxResults || DEFAULT_MAX_RESULTS;
  const candidateCount = Math.max(maxResults, options.candidateCount || DEFAULT_CANDIDATE_POOL);

  // Prefer full cascade when available
  try {
    const { retrieveWithReranking } = require('./cross-encoder-reranker');
    // Ensure first-stage uses multi-query + FTS via retrieveRelevantLessonsAsync after our patches
    const useLLM = options.useLLM !== false && envFlag('THUMBGATE_LLM_RERANK', true);
    const lessons = await retrieveWithReranking(toolName, actionContext, {
      ...options,
      candidateCount,
      maxResults,
      useLLM,
      queryRewrite: options.queryRewrite,
      rewriteBelowScore: options.rewriteBelowScore ?? DEFAULT_REWRITE_BELOW,
    });

    // If CE path returned empty, fall back to sync unified path
    if (!lessons || lessons.length === 0) {
      const sync = retrieveForAction(toolName, actionContext, options);
      return {
        lessons: sync.lessons,
        meta: { ...sync.meta, mode: 'async-fallback-sync', elapsedMs: Date.now() - started },
      };
    }

    const probe = { topLexical: lessons[0]?.relevanceScore ?? 0 };
    return {
      lessons: lessons.map((lesson) => shapeWithProvenance(lesson, {
        mode: 'async',
        rewriteBelowScore: options.rewriteBelowScore ?? DEFAULT_REWRITE_BELOW,
      })),
      meta: {
        backend: 'async-cascade',
        topLexical: probe.topLexical,
        rewriteBelowScore: options.rewriteBelowScore ?? DEFAULT_REWRITE_BELOW,
        rerankStages: lessons[0]?.reranker?.stages || ['first-stage', 'pairwise-heuristic'],
        mode: 'async',
        useLLM,
        elapsedMs: Date.now() - started,
      },
    };
  } catch {
    const sync = retrieveForAction(toolName, actionContext, options);
    return {
      lessons: sync.lessons,
      meta: { ...sync.meta, mode: 'async-error-sync', elapsedMs: Date.now() - started },
    };
  }
}

/**
 * Format lessons as PreToolUse additionalContext with citations + scores.
 */
function assembleActionContext(lessons, extras = {}) {
  const lines = [
    '<system-reminder>',
    'ThumbGate retrieved prior lessons relevant to this tool call (defended RAG path).',
    'REVIEW BEFORE PROCEEDING — treat each item as a citation, not freeform advice:',
  ];
  (lessons || []).forEach((lesson, idx) => {
    const text = lesson.whatToChange
      || lesson.howToAvoid
      || lesson.content
      || lesson.title
      || '';
    if (!text) return;
    const tags = Array.isArray(lesson.tags) ? lesson.tags.slice(0, 4) : [];
    const tagSuffix = tags.length ? ` [${tags.join(', ')}]` : '';
    const score = Number(lesson.relevanceScore ?? lesson.combinedScore);
    const scoreBit = Number.isFinite(score) ? ` score=${score.toFixed(2)}` : '';
    const idBit = lesson.id ? ` (${lesson.id})` : '';
    const stages = lesson.retrieval?.stages || lesson.reranker?.stages;
    const stageBit = Array.isArray(stages) && stages.length
      ? ` via=${stages.join('+')}`
      : '';
    lines.push(
      `${idx + 1}. ${String(text).trim().slice(0, 280)}${tagSuffix}${idBit}${scoreBit}${stageBit}`,
    );
  });
  if (extras?.autogate) {
    lines.push(
      '',
      `ThumbGate auto-registered claim gate "${extras.autogate.gate}" on branch ${extras.autogate.branch}.`,
      'You MUST satisfy this gate (show gh pr view output with 0 unresolved threads) before merging.',
    );
  }
  if (extras?.meta?.rewriteApplied) {
    lines.push(
      '',
      `Retrieval used multi-query (top lexical ${Number(extras.meta.topLexical || 0).toFixed(2)} < ${extras.meta.rewriteBelowScore ?? DEFAULT_REWRITE_BELOW}).`,
    );
  }
  if (extras?.meta?.fts?.applied) {
    lines.push(`Index: SQLite FTS5 seed + JSONL hybrid (${extras.meta.fts.hits || 0} FTS hits).`);
  }
  lines.push('</system-reminder>');
  return lines.join('\n');
}

module.exports = {
  DEFAULT_REWRITE_BELOW,
  ftsRowsToMemories,
  mergeFtsSeed,
  probeTopLexical,
  resolveQueryVariants,
  retrieveForAction,
  retrieveForActionAsync,
  assembleActionContext,
  shapeWithProvenance,
};

if (require.main === module) {
  const tool = process.argv[2] || 'Bash';
  const query = process.argv.slice(3).join(' ') || 'git push --force main';
  const out = retrieveForAction(tool, query, { maxResults: 5 });
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}
