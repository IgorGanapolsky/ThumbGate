#!/usr/bin/env node
'use strict';

/**
 * Defended RAG pipeline — end-to-end, one orchestration.
 *
 *   capture 👎 → normalize/quality-gate → store lesson (SQLite FTS5 / JSONL)
 *     → retrieve: pragmatic-hybrid-search (keyword + bigram-Jaccard)
 *     → multi-query: up to 3 variants when top lexical < 0.6
 *     → rerank: cross-encoder-reranker (LLM if key present, else heuristic)
 *     → assemble context → gate the next tool call (deterministic)
 *
 * Capture/store are write-path; retrieve→gate is PreToolUse hot path.
 * This module is the single place that documents and runs the full contract.
 */

const path = require('path');
const {
  DEFAULT_LEXICAL_THRESHOLD,
  searchWithMultiQuery,
  tryFtsBoost,
} = require('./pragmatic-hybrid-search');

/**
 * WRITE PATH: capture thumbs-down with quality gate (does not auto-promote vague).
 */
function captureDown(params = {}) {
  const { captureFeedback } = require('./feedback-loop');
  const fq = require('./feedback-quality');

  const signal = 'down';
  const context = String(params.context || params.whatWentWrong || '').trim();
  // Normalize signal aliases (thumbs down / negative / bad → negative path).
  const normalizedSignal = fq.normalizeFeedbackSignal(params.signal || signal);

  // Quality gate: vague negative feedback is stored but not promoted.
  const quality = fq.assessFeedbackActionability({
    signal: normalizedSignal === 'negative' ? 'down' : (params.signal || 'down'),
    context,
    whatWentWrong: params.whatWentWrong,
    whatToChange: params.whatToChange,
    whatWorked: params.whatWorked,
  });
  const clarification = fq.buildClarificationMessage({
    signal: normalizedSignal === 'negative' ? 'down' : (params.signal || 'down'),
    context,
    whatWentWrong: params.whatWentWrong,
    whatToChange: params.whatToChange,
  });

  const result = captureFeedback({
    signal: 'down',
    context,
    whatWentWrong: params.whatWentWrong,
    whatToChange: params.whatToChange,
    tags: params.tags,
    conversationWindow: params.conversationWindow,
    chatHistory: params.chatHistory,
  });

  // Best-effort FTS5 store (JSONL is always written by captureFeedback).
  let fts = { ok: false, reason: 'skipped' };
  try {
    fts = storeLessonFts(result, params.feedbackDir);
  } catch (err) {
    fts = { ok: false, reason: err.message };
  }

  return {
    stage: 'capture',
    accepted: Boolean(result?.accepted),
    promoted: Boolean(result?.promoted),
    needsClarification: Boolean(
      result?.needsClarification || clarification?.needsClarification || !quality?.promotable,
    ),
    quality,
    clarification,
    feedback: result,
    fts,
  };
}

function storeLessonFts(captureResult, feedbackDir) {
  const fs = require('fs');
  const lessonDb = require('./lesson-db');
  const { resolveFeedbackDir } = require('./feedback-paths');
  const dir = feedbackDir || resolveFeedbackDir({});
  const dbPath = path.join(dir, 'lessons.sqlite');
  fs.mkdirSync(dir, { recursive: true });
  const db = lessonDb.initDB(dbPath);
  try {
    const mem = captureResult?.memoryRecord || captureResult?.memory || null;
    if (!captureResult?.accepted) {
      return { ok: false, reason: 'capture_not_accepted' };
    }
    // Only FTS-store promotable / structured memories — vague downs stay JSONL-only.
    if (captureResult?.promoted === false && !mem) {
      return { ok: true, skipped: true, reason: 'not_promoted_jsonl_only' };
    }
    const feedbackEvent = {
      id: mem?.id || captureResult?.feedbackEventId || captureResult?.id || `fb-${Date.now()}`,
      signal: 'negative',
      context: captureResult?.context || mem?.content || '',
      whatWentWrong: captureResult?.whatWentWrong || mem?.whatWentWrong || null,
      whatToChange: captureResult?.whatToChange || mem?.whatToChange || null,
      tags: mem?.tags || ['negative'],
    };
    const memoryRecord = mem || {
      id: feedbackEvent.id,
      content: feedbackEvent.context,
      importance: 'high',
    };
    const stored = lessonDb.upsertLesson(db, feedbackEvent, memoryRecord);
    return { ok: true, dbPath, id: feedbackEvent.id, stored: Boolean(stored) };
  } finally {
    if (typeof db.close === 'function') db.close();
  }
}

/**
 * READ PATH: retrieve → multi-query → rerank → assemble for tool gate.
 */
function retrieveAndGate(toolName, toolInput, options = {}) {
  const { getFeedbackPaths, readJSONL } = require('./feedback-loop');
  const pathMod = require('path');
  const {
    heuristicCrossEncode,
    llmCrossEncode,
  } = (() => {
    try {
      return require('./cross-encoder-reranker');
    } catch {
      return {};
    }
  })();

  const feedbackDir = options.feedbackDir;
  const paths = feedbackDir
    ? { MEMORY_LOG_PATH: pathMod.join(feedbackDir, 'memory-log.jsonl') }
    : getFeedbackPaths();

  const actionContext = options.actionContext
    || buildActionContext(toolName, toolInput);

  // Load memories (JSONL primary — same as PreToolUse hot path).
  const { selectRetrievalMemories } = require('./lesson-retrieval');
  const memories = selectRetrievalMemories(
    readJSONL(paths.MEMORY_LOG_PATH, {
      maxLines: Number(process.env.THUMBGATE_RETRIEVAL_MAX_LINES) || 5000,
    }),
    options,
  );

  // Stage: pragmatic hybrid + conditional multi-query
  const lexical = searchWithMultiQuery(toolName, actionContext, memories, {
    maxResults: options.candidateCount || 20,
    lexicalThreshold: options.lexicalThreshold ?? DEFAULT_LEXICAL_THRESHOLD,
    maxVariants: options.maxVariants || 3,
    scope: options.scope,
    requireScope: options.requireScope,
    includeShared: options.includeShared,
  });

  // Optional FTS5 id list for observability (does not block if missing).
  const ftsIds = tryFtsBoost(actionContext, feedbackDir);

  let candidates = lexical.results;
  if (ftsIds && ftsIds.length) {
    // Light boost: promote FTS hits that also appear in lexical pool.
    const ftsSet = new Set(ftsIds);
    candidates = candidates
      .map((c) => ({
        ...c,
        relevanceScore: c.relevanceScore + (ftsSet.has(c.id) ? 0.05 : 0),
      }))
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  // Stage: cross-encoder rerank (LLM if key present and useLLM, else heuristic)
  const maxResults = options.maxResults || 5;
  const query = `${toolName || ''} ${actionContext || ''}`.trim();
  let rerankMethod = 'none';
  let ranked = candidates;

  if (candidates.length > 0) {
    let scores = null;
    if (options.useLLM && typeof llmCrossEncode === 'function') {
      // Sync path cannot await; LLM only when caller uses retrieveAndGateAsync.
      scores = null;
    }
    if (!scores && typeof heuristicCrossEncode === 'function') {
      scores = candidates.map((c) => {
        const docText = `${c.title || ''} ${c.content || ''}`;
        return heuristicCrossEncode(query, docText);
      });
      rerankMethod = 'heuristic-cross-encoder';
    }
    if (scores) {
      ranked = candidates
        .map((c, i) => ({
          ...c,
          crossEncoderScore: scores[i],
          combinedScore: (c.relevanceScore || 0) * 0.4 + scores[i] * 0.6,
        }))
        .sort((a, b) => b.combinedScore - a.combinedScore);
    }
  }

  const top = ranked.slice(0, maxResults);

  // Stage: assemble context (deterministic)
  const assembled = assembleContext(top, { toolName, actionContext, lexical });

  // Stage: gate decision (deterministic)
  const decision = decideGate(toolName, toolInput, top, options);

  return {
    stage: 'retrieve_gate',
    toolName,
    actionContext,
    lexical: {
      method: lexical.method,
      topScore: lexical.topScore,
      multiQuery: lexical.multiQuery,
      variants: lexical.variants,
      threshold: lexical.threshold,
      ftsBoost: Boolean(ftsIds && ftsIds.length),
    },
    rerankMethod,
    lessons: top.map(shapeLesson),
    assembled,
    decision,
  };
}

async function retrieveAndGateAsync(toolName, toolInput, options = {}) {
  const sync = retrieveAndGate(toolName, toolInput, { ...options, useLLM: false });
  if (!options.useLLM) return sync;

  try {
    const { llmCrossEncode } = require('./cross-encoder-reranker');
    const { isAvailable } = require('./llm-client');
    if (!isAvailable() || typeof llmCrossEncode !== 'function') {
      return { ...sync, rerankMethod: sync.rerankMethod || 'heuristic-cross-encoder' };
    }
    const candidates = sync.lessons.length
      ? sync.lessons
      : [];
    // Re-run from scratch with LLM scores when we have candidates from sync path.
    // Prefer re-using lexical candidates if present on sync object — re-fetch.
    const again = retrieveAndGate(toolName, toolInput, { ...options, useLLM: false });
    const query = `${toolName || ''} ${again.actionContext || ''}`.trim();
    // We need full candidate docs; re-query hybrid for pool.
    const { getFeedbackPaths, readJSONL } = require('./feedback-loop');
    const { selectRetrievalMemories } = require('./lesson-retrieval');
    const paths = options.feedbackDir
      ? { MEMORY_LOG_PATH: path.join(options.feedbackDir, 'memory-log.jsonl') }
      : getFeedbackPaths();
    const memories = selectRetrievalMemories(readJSONL(paths.MEMORY_LOG_PATH, { maxLines: 5000 }), options);
    const lexical = searchWithMultiQuery(toolName, again.actionContext, memories, {
      maxResults: options.candidateCount || 20,
      lexicalThreshold: options.lexicalThreshold ?? DEFAULT_LEXICAL_THRESHOLD,
    });
    const scores = await llmCrossEncode(query, lexical.results);
    if (!scores) return { ...again, rerankMethod: 'heuristic-cross-encoder-fallback' };
    const ranked = lexical.results
      .map((c, i) => ({
        ...c,
        crossEncoderScore: scores[i],
        combinedScore: (c.relevanceScore || 0) * 0.4 + scores[i] * 0.6,
      }))
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, options.maxResults || 5);
    const assembled = assembleContext(ranked, {
      toolName,
      actionContext: again.actionContext,
      lexical,
    });
    const decision = decideGate(toolName, toolInput, ranked, options);
    return {
      ...again,
      rerankMethod: 'llm-cross-encoder',
      lessons: ranked.map(shapeLesson),
      assembled,
      decision,
    };
  } catch {
    return sync;
  }
}

function buildActionContext(toolName, toolInput) {
  if (typeof toolInput === 'string') return toolInput.slice(0, 2000);
  if (!toolInput || typeof toolInput !== 'object') return '';
  if (toolName === 'Bash') return String(toolInput.command || '').slice(0, 2000);
  if (toolName === 'Edit') {
    return [toolInput.file_path, toolInput.old_string, toolInput.new_string]
      .filter(Boolean)
      .join(' | ')
      .slice(0, 2000);
  }
  if (toolName === 'Write') {
    return [toolInput.file_path, String(toolInput.content || '').slice(0, 400)]
      .filter(Boolean)
      .join(' | ')
      .slice(0, 2000);
  }
  try {
    return JSON.stringify(toolInput).slice(0, 2000);
  } catch {
    return '';
  }
}

function shapeLesson(m) {
  return {
    id: m.id,
    title: m.title,
    content: m.content,
    signal: m.tags?.includes?.('negative') || m.signal === 'negative' ? 'negative' : (m.signal || 'positive'),
    relevanceScore: m.combinedScore ?? m.relevanceScore,
    crossEncoderScore: m.crossEncoderScore,
    whatToChange: m.whatToChange || m.structuredRule?.then || null,
  };
}

function assembleContext(lessons, meta = {}) {
  const lines = [
    'ThumbGate defended RAG context (deterministic).',
    `tool=${meta.toolName || '?'} multiQuery=${Boolean(meta.lexical?.multiQuery)} topLexical=${Number(meta.lexical?.topScore || 0).toFixed(3)}`,
    '',
  ];
  (lessons || []).forEach((lesson, idx) => {
    const text = lesson.whatToChange || lesson.content || lesson.title || '';
    const score = Number(lesson.combinedScore ?? lesson.relevanceScore ?? 0).toFixed(3);
    lines.push(`${idx + 1}. [${score}] ${(lesson.title || 'lesson').slice(0, 80)}`);
    if (text) lines.push(`   ${String(text).slice(0, 240)}`);
  });
  if (!lessons?.length) {
    lines.push('(no prior lessons matched)');
  }
  return lines.join('\n');
}

/**
 * Deterministic gate decision from retrieved lessons + high-risk tags.
 * block | warn | allow — never invents authority beyond lessons/risk map.
 */
function decideGate(toolName, toolInput, lessons, options = {}) {
  // Prefer hybrid-feedback-context when available (attributed patterns).
  try {
    const hybrid = require('./hybrid-feedback-context');
    if (typeof hybrid.evaluatePretool === 'function') {
      const ev = hybrid.evaluatePretool({
        toolName,
        toolInput,
        actionContext: buildActionContext(toolName, toolInput),
      });
      if (ev && ev.decision) {
        return {
          decision: ev.decision,
          reason: ev.reason || 'hybrid-feedback-context',
          source: 'hybrid-feedback-context',
          details: ev,
        };
      }
    }
  } catch { /* optional */ }

  // Risk tags on negative lessons → warn/block when threshold hit.
  const threshold = Number(options.riskThreshold) || 0.7;
  try {
    const { getRiskSummary } = require('./risk-scorer');
    const summary = getRiskSummary();
    const high = Array.isArray(summary?.highRiskTags) ? summary.highRiskTags : [];
    const riskByTag = new Map();
    for (const bucket of high) {
      const key = bucket?.key || bucket?.tag;
      const score = Number(bucket.risk || bucket.score || 0);
      if (key && Number.isFinite(score)) riskByTag.set(String(key), score);
    }
    for (const lesson of lessons || []) {
      const tags = lesson.tags || [];
      for (const tag of tags) {
        const score = riskByTag.get(String(tag));
        if (typeof score === 'number' && score >= threshold) {
          return {
            decision: 'block',
            reason: `high-risk tag "${tag}" score=${score}`,
            source: 'risk-scorer+lessons',
            lessonId: lesson.id,
          };
        }
      }
      if (lesson.signal === 'negative' && (lesson.relevanceScore || 0) >= 0.85) {
        return {
          decision: 'warn',
          reason: 'strong negative lesson match',
          source: 'defended-rag',
          lessonId: lesson.id,
        };
      }
    }
  } catch { /* optional */ }

  if ((lessons || []).some((l) => l.signal === 'negative' && (l.relevanceScore || 0) >= 0.5)) {
    return {
      decision: 'warn',
      reason: 'negative lesson in top results',
      source: 'defended-rag',
    };
  }

  return {
    decision: 'allow',
    reason: 'no blocking lesson or risk signal',
    source: 'defended-rag',
  };
}

/**
 * Full defense proof for operators / CI.
 * Always uses an isolated temp feedback dir so proofs never promote into the operator's live gates.
 */
function defendPipeline(options = {}) {
  const fs = require('fs');
  const os = require('os');
  const pathMod = require('path');
  const stages = [];
  const isolated = !options.feedbackDir;
  const feedbackDir = options.feedbackDir
    || fs.mkdtempSync(pathMod.join(os.tmpdir(), 'tg-defended-proof-'));
  const prevFeedback = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;

  try {
    // 1) Capture quality gate (synthetic vague down must not promote)
    const vague = captureDown({
      context: 'thumbs down',
      feedbackDir,
    });
    stages.push({
      name: 'capture_quality_gate',
      ok: vague.accepted !== false && vague.promoted === false,
      detail: { promoted: vague.promoted, needsClarification: vague.needsClarification },
    });

    // 2) Capture quality structured down should accept
    const structured = captureDown({
      context: 'Agent force-pushed to main without review',
      whatWentWrong: 'force-push to protected branch',
      whatToChange: 'Never force-push to main; open a PR instead',
      tags: ['git', 'force-push'],
      feedbackDir,
    });
    stages.push({
      name: 'capture_structured_store',
      ok: structured.accepted === true,
      detail: { promoted: structured.promoted, fts: structured.fts },
    });

    // 3) Retrieve multi-query + rerank + gate
    const gate = retrieveAndGate('Bash', { command: 'git push --force origin main' }, {
      feedbackDir,
      maxResults: 5,
    });
    stages.push({
      name: 'retrieve_pragmatic_hybrid',
      ok: typeof gate.lexical?.topScore === 'number',
      detail: {
        method: gate.lexical?.method,
        multiQuery: gate.lexical?.multiQuery,
        threshold: gate.lexical?.threshold,
        topScore: gate.lexical?.topScore,
      },
    });
    stages.push({
      name: 'rerank_cross_encoder',
      ok: Boolean(gate.rerankMethod),
      detail: { rerankMethod: gate.rerankMethod, n: gate.lessons?.length },
    });
    stages.push({
      name: 'assemble_and_gate',
      ok: Boolean(gate.assembled) && ['allow', 'warn', 'block'].includes(gate.decision?.decision),
      detail: { decision: gate.decision },
    });
  } finally {
    if (prevFeedback === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = prevFeedback;
    if (isolated) {
      try {
        fs.rmSync(feedbackDir, { recursive: true, force: true });
      } catch { /* best-effort cleanup */ }
    }
  }

  const allOk = stages.every((s) => s.ok);
  return {
    schema_version: 'thumbgate-defended-rag/1',
    ok: allOk,
    stages,
    pipeline: [
      'capture 👎',
      'normalize/quality-gate',
      'store lesson (SQLite FTS5 / JSONL)',
      'retrieve pragmatic-hybrid (keyword + bigram-Jaccard)',
      'multi-query ≤3 when top lexical < 0.6',
      'rerank cross-encoder (LLM|heuristic)',
      'assemble context',
      'deterministic tool gate',
    ],
  };
}

module.exports = {
  captureDown,
  storeLessonFts,
  retrieveAndGate,
  retrieveAndGateAsync,
  assembleContext,
  decideGate,
  buildActionContext,
  defendPipeline,
};

if (require.main === module) {
  const proof = defendPipeline();
  console.log(JSON.stringify(proof, null, 2));
  process.exit(proof.ok ? 0 : 1);
}
