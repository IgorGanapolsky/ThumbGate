'use strict';

const path = require('node:path');
const { readJSONL, getFeedbackPaths } = require('./feedback-loop');

const HIGH_RISK_TAGS = new Set([
  'billing',
  'data-loss',
  'deployment',
  'git',
  'production',
  'release',
  'security',
  'verification',
]);

const PRIORITY_WEIGHT = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function jaccardSimilarity(tokensA, tokensB) {
  const setA = new Set(unique(tokensA));
  const setB = new Set(unique(tokensB));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function substringBoost(queryText, recordText) {
  const query = String(queryText || '').toLowerCase().trim();
  const haystack = String(recordText || '').toLowerCase();
  if (!query) return 0;
  if (haystack.includes(query)) return 0.35;
  const words = query.split(/\s+/).filter((word) => word.length > 2);
  if (words.length === 0) return 0;
  const matched = words.filter((word) => haystack.includes(word)).length;
  return (matched / words.length) * 0.25;
}

function recencyScore(timestamp) {
  if (!timestamp) return 0;
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) return 0;
  const ageHours = (Date.now() - parsed) / (1000 * 60 * 60);
  if (ageHours <= 24) return 0.15;
  if (ageHours <= 24 * 7) return 0.1;
  if (ageHours <= 24 * 30) return 0.05;
  return 0;
}

function parseLessonContent(content = '') {
  const lines = String(content || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = {
    summary: '',
    whatWentWrong: null,
    whatWorked: null,
    approach: null,
    howToAvoid: null,
    actionNeeded: null,
    reasoning: null,
    visualEvidence: null,
    rubric: [],
  };

  for (const line of lines) {
    if (/^What went wrong:\s*/i.test(line)) {
      parsed.whatWentWrong = line.replace(/^What went wrong:\s*/i, '');
      continue;
    }
    if (/^What worked:\s*/i.test(line)) {
      parsed.whatWorked = line.replace(/^What worked:\s*/i, '');
      continue;
    }
    if (/^Approach:\s*/i.test(line)) {
      parsed.approach = line.replace(/^Approach:\s*/i, '');
      continue;
    }
    if (/^How to avoid:\s*/i.test(line)) {
      parsed.howToAvoid = line.replace(/^How to avoid:\s*/i, '');
      continue;
    }
    if (/^Action needed:\s*/i.test(line)) {
      parsed.actionNeeded = line.replace(/^Action needed:\s*/i, '');
      continue;
    }
    if (/^Reasoning:\s*/i.test(line)) {
      parsed.reasoning = line.replace(/^Reasoning:\s*/i, '');
      continue;
    }
    if (/^Visual Evidence:\s*/i.test(line)) {
      parsed.visualEvidence = line.replace(/^Visual Evidence:\s*/i, '');
      continue;
    }
    if (/^Rubric /i.test(line) || /^Guardrails failed:/i.test(line) || /^Judge disagreement/i.test(line)) {
      parsed.rubric.push(line);
    }
  }

  parsed.summary = parsed.whatWentWrong
    || parsed.whatWorked
    || parsed.approach
    || parsed.howToAvoid
    || parsed.actionNeeded
    || lines[0]
    || '';

  return parsed;
}

function buildLessonQuery(memory, parsed, sourceFeedback) {
  return [
    memory.title,
    parsed.whatWentWrong,
    parsed.whatWorked,
    parsed.approach,
    parsed.howToAvoid,
    parsed.actionNeeded,
    parsed.reasoning,
    sourceFeedback && sourceFeedback.context,
    Array.isArray(memory.tags) ? memory.tags.join(' ') : '',
  ].filter(Boolean).join(' ');
}

function resolveLessonPaths(options = {}) {
  if (options.feedbackDir) {
    const feedbackDir = path.resolve(String(options.feedbackDir));
    return {
      FEEDBACK_DIR: feedbackDir,
      FEEDBACK_LOG_PATH: path.join(feedbackDir, 'feedback-log.jsonl'),
      MEMORY_LOG_PATH: path.join(feedbackDir, 'memory-log.jsonl'),
      PREVENTION_RULES_PATH: path.join(feedbackDir, 'prevention-rules.md'),
      AUTO_GATES_PATH: path.join(feedbackDir, 'auto-promoted-gates.json'),
    };
  }

  const paths = getFeedbackPaths();
  return {
    ...paths,
    PREVENTION_RULES_PATH: path.join(paths.FEEDBACK_DIR, 'prevention-rules.md'),
    AUTO_GATES_PATH: path.join(paths.FEEDBACK_DIR, 'auto-promoted-gates.json'),
  };
}

function readPreventionRuleMatches(queryText, limit = 3, options = {}) {
  const { PREVENTION_RULES_PATH } = resolveLessonPaths(options);
  if (!PREVENTION_RULES_PATH) return [];
  let content = '';
  try {
    content = require('node:fs').readFileSync(PREVENTION_RULES_PATH, 'utf-8');
  } catch {
    return [];
  }

  const blocks = content.split(/^#{1,3}\s+/m).filter(Boolean);
  const queryTokens = tokenize(queryText);

  return blocks
    .map((block) => {
      const lines = block.trim().split('\n');
      const title = lines[0] || '';
      const body = lines.slice(1).join('\n').trim();
      const text = `${title} ${body}`;
      const score = jaccardSimilarity(queryTokens, tokenize(text)) + substringBoost(queryText, text);
      return { title, body, score };
    })
    .filter((rule) => rule.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((rule) => ({
      title: rule.title,
      summary: String(rule.body || '').split('\n')[0] || '',
      score: Number((rule.score || 0).toFixed(4)),
    }));
}

function readAutoGates(options = {}) {
  const { AUTO_GATES_PATH } = resolveLessonPaths(options);
  try {
    return JSON.parse(require('node:fs').readFileSync(AUTO_GATES_PATH, 'utf-8'));
  } catch {
    return { version: 1, gates: [], promotionLog: [] };
  }
}

function scoreGateMatch(gate, queryText, tags = [], diagnosis = null) {
  const gateText = [
    gate.id,
    gate.pattern,
    gate.message,
    gate.trigger,
    gate.action,
    gate.severity,
  ].filter(Boolean).join(' ');
  const score = jaccardSimilarity(tokenize(queryText), tokenize(gateText))
    + substringBoost(queryText, gateText);
  const tagScore = tags.some((tag) => String(gate.pattern || '').toLowerCase().includes(String(tag).toLowerCase()))
    ? 0.2
    : 0;
  const diagnosisScore = diagnosis && diagnosis.rootCauseCategory
    && String(gate.pattern || '').toLowerCase().includes(String(diagnosis.rootCauseCategory).toLowerCase())
    ? 0.2
    : 0;
  return score + tagScore + diagnosisScore;
}

function buildGateMatches(memory, parsed, limit = 3, options = {}) {
  const autoGates = readAutoGates(options);
  const lessonQuery = buildLessonQuery(memory, parsed, null);
  return (autoGates.gates || [])
    .map((gate) => ({
      gate,
      score: scoreGateMatch(gate, lessonQuery, memory.tags || [], memory.diagnosis || null),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ gate, score }) => ({
      id: gate.id,
      action: gate.action,
      pattern: gate.pattern,
      message: gate.message,
      occurrences: gate.occurrences,
      promotedAt: gate.promotedAt,
      score: Number(score.toFixed(4)),
    }));
}

function inferPriority(memory, tags = []) {
  if (String(memory.importance || '').toLowerCase() === 'critical') return 'critical';
  if (String(memory.importance || '').toLowerCase() === 'high') return 'high';
  if ((tags || []).some((tag) => HIGH_RISK_TAGS.has(String(tag).toLowerCase()))) return 'high';
  return 'medium';
}

function inferVerificationState(parsed, memory, sourceFeedback, ruleMatches, gateMatches) {
  const lessonText = [
    memory.title,
    parsed.whatWentWrong,
    parsed.howToAvoid,
    parsed.actionNeeded,
    parsed.whatWorked,
    parsed.reasoning,
    sourceFeedback && sourceFeedback.context,
  ].filter(Boolean).join(' ');
  const verificationPattern = /\b(attach|check|proof|review|rollback|test|validate|verification|verify)\b/i;
  const ruleText = ruleMatches.map((rule) => `${rule.title} ${rule.summary}`).join(' ');
  const gateText = gateMatches.map((gate) => `${gate.id} ${gate.pattern} ${gate.message}`).join(' ');
  const mentionsVerification = verificationPattern.test(lessonText);
  const enforcedVerification = verificationPattern.test(`${ruleText} ${gateText}`);

  if (parsed.whatWorked && enforcedVerification) return 'closed_loop';
  if (enforcedVerification) return 'enforced';
  if (mentionsVerification) return 'specified';
  return 'missing';
}

function buildHarnessRecommendations(memory, parsed, sourceFeedback, ruleMatches, gateMatches) {
  const recommendations = [];
  const tags = Array.isArray(memory.tags) ? memory.tags : [];
  const lessonQuery = buildLessonQuery(memory, parsed, sourceFeedback);
  const priority = inferPriority(memory, tags);
  const diagnosis = memory.diagnosis || {};
  const correctiveText = parsed.howToAvoid || parsed.actionNeeded || parsed.summary || '';
  const hasRule = ruleMatches.length > 0;
  const hasGate = gateMatches.length > 0;
  const verificationLike = /\b(attach|proof|review|rollback|test|validate|verification|verify)\b/i.test(lessonQuery);
  const highRisk = tags.some((tag) => HIGH_RISK_TAGS.has(String(tag).toLowerCase()))
    || ['pre_tool_use', 'release', 'security', 'verification'].includes(String(diagnosis.criticalFailureStep || '').toLowerCase())
    || /\b(deploy|publish|push|release|ship)\b/i.test(lessonQuery);

  if (memory.category === 'error' && correctiveText && !hasRule) {
    recommendations.push({
      type: 'prevention_rule',
      priority,
      reason: 'lesson captured a corrective action but no linked prevention rule exists yet',
      action: correctiveText,
    });
  }

  if (memory.category === 'error' && highRisk && !hasGate) {
    recommendations.push({
      type: 'pre_action_gate',
      priority,
      reason: 'high-risk lesson has no linked gate, so the failure is still relying on agent cooperation',
      action: 'Promote a warning or blocking gate before the risky tool call executes.',
    });
  }

  if (memory.category === 'error' && verificationLike && !(hasRule || hasGate)) {
    recommendations.push({
      type: 'verification_harness',
      priority: priority === 'critical' ? 'critical' : 'high',
      reason: 'verification or proof failed, but there is no upstream test or proof contract linked to the lesson',
      action: 'Add a proof step or automated test that runs before merge, publish, or deploy.',
    });
  }

  if (memory.category === 'error' && !diagnosis.rootCauseCategory && !parsed.reasoning) {
    recommendations.push({
      type: 'diagnostic_capture',
      priority: 'medium',
      reason: 'future automation will be stronger if this failure records a root cause and failed step',
      action: 'Capture rootCauseCategory, criticalFailureStep, and reasoning on the next occurrence.',
    });
  }

  const seen = new Set();
  return recommendations.filter((recommendation) => {
    const key = `${recommendation.type}:${recommendation.action}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildLifecycle(memory, parsed, sourceFeedback, ruleMatches, gateMatches, recommendations) {
  const correctiveActionCaptured = Boolean(parsed.howToAvoid || parsed.actionNeeded || parsed.whatWorked || parsed.approach);
  const preventionRuleLinked = ruleMatches.length > 0;
  const gateLinked = gateMatches.length > 0;
  const verificationState = inferVerificationState(parsed, memory, sourceFeedback, ruleMatches, gateMatches);
  const enforcementState = gateMatches.some((gate) => gate.action === 'block')
    ? 'blocking'
    : gateLinked
      ? 'warning'
      : preventionRuleLinked
        ? 'rule_only'
        : 'memory_only';

  let stage = 'detected';
  if (memory.id) stage = 'promoted';
  if (preventionRuleLinked || gateLinked) stage = 'enforced';
  if (verificationState === 'closed_loop') stage = 'measured';

  return {
    feedbackCaptured: Boolean(sourceFeedback || memory.sourceFeedbackId),
    promotedToMemory: true,
    correctiveActionCaptured,
    preventionRuleLinked,
    gateLinked,
    enforcementState,
    verificationState,
    impactMeasured: verificationState === 'closed_loop',
    openRecommendations: recommendations.length,
    stage,
  };
}

function buildSystemActions(parsed, ruleMatches, gateMatches) {
  const actions = [];
  if (parsed.howToAvoid) {
    actions.push({ type: 'avoid_repeat', source: 'memory', text: parsed.howToAvoid });
  }
  if (parsed.actionNeeded) {
    actions.push({ type: 'investigate', source: 'memory', text: parsed.actionNeeded });
  }
  if (parsed.whatWorked) {
    actions.push({ type: 'repeat_success', source: 'memory', text: parsed.whatWorked });
  } else if (parsed.approach) {
    actions.push({ type: 'repeat_success', source: 'memory', text: parsed.approach });
  }
  for (const rule of ruleMatches) {
    actions.push({ type: 'prevention_rule', source: 'prevention_rules', text: rule.title });
  }
  for (const gate of gateMatches) {
    actions.push({ type: gate.action === 'block' ? 'pre_action_block' : 'pre_action_warn', source: 'auto_gate', text: gate.message });
  }
  const seen = new Set();
  return actions.filter((action) => {
    const key = `${action.type}:${action.source}:${action.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreLesson(queryText, memory, parsed, sourceFeedback) {
  if (!queryText) {
    return {
      score: recencyScore(memory.timestamp),
      matchedTokens: [],
    };
  }

  const lessonText = buildLessonQuery(memory, parsed, sourceFeedback);
  const queryTokens = tokenize(queryText);
  const lessonTokens = tokenize(lessonText);
  const score = jaccardSimilarity(queryTokens, lessonTokens)
    + substringBoost(queryText, lessonText)
    + recencyScore(memory.timestamp)
    + (memory.category === 'error' ? 0.05 : 0);

  return {
    score,
    matchedTokens: unique(queryTokens.filter((token) => lessonTokens.includes(token))),
  };
}

function buildLessonResult(memory, sourceFeedback, options = {}) {
  const parsed = parseLessonContent(memory.content);
  const lessonQuery = buildLessonQuery(memory, parsed, sourceFeedback);
  const ruleMatches = readPreventionRuleMatches(lessonQuery, Number(options.ruleLimit || 3), options);
  const gateMatches = buildGateMatches(memory, parsed, Number(options.gateLimit || 3), options);
  const { score, matchedTokens } = scoreLesson(options.query || '', memory, parsed, sourceFeedback);
  const harnessRecommendations = buildHarnessRecommendations(memory, parsed, sourceFeedback, ruleMatches, gateMatches);
  const lifecycle = buildLifecycle(memory, parsed, sourceFeedback, ruleMatches, gateMatches, harnessRecommendations);

  return {
    id: memory.id,
    title: memory.title,
    category: memory.category,
    importance: memory.importance,
    tags: Array.isArray(memory.tags) ? memory.tags : [],
    timestamp: memory.timestamp || null,
    sourceFeedbackId: memory.sourceFeedbackId || null,
    score: Number(score.toFixed(4)),
    matchedTokens,
    lesson: {
      summary: parsed.summary,
      content: memory.content,
      whatWentWrong: parsed.whatWentWrong,
      whatWorked: parsed.whatWorked || parsed.approach,
      howToAvoid: parsed.howToAvoid,
      actionNeeded: parsed.actionNeeded,
      reasoning: parsed.reasoning,
      visualEvidence: parsed.visualEvidence,
      rubric: parsed.rubric,
    },
    systemResponse: {
      promotedToMemory: true,
      lifecycle,
      diagnosis: memory.diagnosis || null,
      sourceFeedback: sourceFeedback
        ? {
          id: sourceFeedback.id || null,
          signal: sourceFeedback.signal || sourceFeedback.feedback || null,
          context: sourceFeedback.context || '',
          timestamp: sourceFeedback.timestamp || null,
          tags: Array.isArray(sourceFeedback.tags) ? sourceFeedback.tags : [],
        }
        : null,
      linkedPreventionRules: ruleMatches,
      linkedAutoGates: gateMatches,
      correctiveActions: buildSystemActions(parsed, ruleMatches, gateMatches),
      harnessRecommendations,
    },
  };
}

function searchLessons(query = '', options = {}) {
  const { MEMORY_LOG_PATH, FEEDBACK_DIR, FEEDBACK_LOG_PATH } = resolveLessonPaths(options);

  // Try SQLite FTS5 first — falls back to JSONL Jaccard if unavailable
  const sqliteResults = tryFts5Search(query, options);
  if (sqliteResults) return sqliteResults;

  const memories = readJSONL(MEMORY_LOG_PATH);
  const feedbackEntries = readJSONL(FEEDBACK_LOG_PATH);
  const feedbackById = new Map(feedbackEntries.map((entry) => [entry.id, entry]));
  const parsedLimit = Number(options.limit || 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;
  const category = options.category ? String(options.category).trim() : '';
  const requiredTags = Array.isArray(options.tags)
    ? options.tags.filter(Boolean).map(String)
    : String(options.tags || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

  let results = memories
    .map((memory) => buildLessonResult(memory, feedbackById.get(memory.sourceFeedbackId), {
      query,
      ruleLimit: options.ruleLimit,
      gateLimit: options.gateLimit,
    }));

  if (category) {
    results = results.filter((entry) => entry.category === category);
  }
  if (requiredTags.length > 0) {
    results = results.filter((entry) => requiredTags.every((tag) => entry.tags.includes(tag)));
  }
  if (query) {
    results = results.filter((entry) => entry.score > 0);
  }

  results.sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
  });

  // Cross-encoder reranking: when a query is present, rerank the top-50 bi-encoder
  // candidates using field-weighted BM25 so the most relevant lessons surface first.
  if (query && results.length > 1) {
    const { rerankLessons } = require('./lesson-reranker');
    const pool = results.slice(0, 50);
    const tail  = results.slice(50);
    const reranked = rerankLessons(query, pool, { topK: pool.length });
    results = [...reranked, ...tail];
  }

  return {
    query: String(query || ''),
    limit,
    filters: {
      category: category || null,
      tags: requiredTags,
    },
    feedbackDir: FEEDBACK_DIR,
    totalLessons: memories.length,
    returned: Math.min(limit, results.length),
    results: results.slice(0, limit),
    backend: 'jsonl-jaccard',
  };
}

/**
 * Try FTS5 search via lesson-db. Returns null if SQLite is unavailable
 * or not opted in. Set LESSON_DB_SEARCH=1 to enable FTS5 as primary backend.
 */
function tryFts5Search(query, options) {
  if (!process.env.LESSON_DB_SEARCH && !options.useFts5) return null;
  try {
    const { initDB, searchLessons: fts5Search, getStats } = require('./lesson-db');
    const db = initDB();
    const stats = getStats(db);

    // If DB is empty, skip (not yet backfilled)
    if (stats.total === 0) return null;

    const parsedLimit = Number(options.limit || 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;
    const signal = options.category === 'error' ? 'negative' : undefined;
    const requiredTags = Array.isArray(options.tags)
      ? options.tags.filter(Boolean).map(String)
      : String(options.tags || '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);

    const rows = fts5Search(db, query || '', {
      limit,
      signal,
      tags: requiredTags.length > 0 ? requiredTags : undefined,
    });

    return {
      query: String(query || ''),
      limit,
      filters: {
        category: options.category || null,
        tags: requiredTags,
      },
      totalLessons: stats.total,
      returned: rows.length,
      results: rows.map((row) => ({
        id: row.id,
        signal: row.signal,
        context: row.context,
        whatWentWrong: row.whatWentWrong,
        whatToChange: row.whatToChange,
        whatWorked: row.whatWorked,
        domain: row.domain,
        tags: row.tags,
        importance: row.importance,
        timestamp: row.timestamp,
      })),
      backend: 'sqlite-fts5',
    };
  } catch (_err) {
    return null; // SQLite unavailable — fall through to JSONL
  }
}

function formatLessonSearchResults(payload) {
  const lines = [];
  lines.push(`## Lesson Search${payload.query ? ` — ${payload.query}` : ''}`);
  lines.push(`- Total lessons: ${payload.totalLessons}`);
  lines.push(`- Returned: ${payload.returned}`);
  if (payload.filters.category) {
    lines.push(`- Category filter: ${payload.filters.category}`);
  }
  if (payload.filters.tags.length > 0) {
    lines.push(`- Tag filter: ${payload.filters.tags.join(', ')}`);
  }
  lines.push('');

  if (!payload.results.length) {
    lines.push('No matching lessons found.');
    return `${lines.join('\n')}\n`;
  }

  payload.results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.title}`);
    lines.push(`   Category: ${result.category} | Tags: ${result.tags.join(', ') || 'none'} | Score: ${result.score}`);
    if (result.lesson.summary) {
      lines.push(`   Lesson: ${result.lesson.summary}`);
    }
    const correctiveActions = result.systemResponse.correctiveActions || [];
    if (correctiveActions.length > 0) {
      lines.push('   Corrective actions:');
      correctiveActions.slice(0, 4).forEach((action) => {
        lines.push(`   - [${action.source}] ${action.text}`);
      });
    }
    if (result.systemResponse.diagnosis && result.systemResponse.diagnosis.rootCauseCategory) {
      lines.push(`   Diagnosis: ${result.systemResponse.diagnosis.rootCauseCategory}`);
    }
    const recommendations = result.systemResponse.harnessRecommendations || [];
    if (recommendations.length > 0) {
      lines.push('   Harness recommendations:');
      recommendations.slice(0, 3).forEach((recommendation) => {
        lines.push(`   - [${recommendation.priority}] ${recommendation.type}: ${recommendation.action}`);
      });
    }
  });

  return `${lines.join('\n')}\n`;
}

/**
 * Enrich lesson search results with Perplexity web context.
 * Queries Perplexity for each top result's root cause to find external
 * documentation, known issues, or community solutions.
 *
 * Requires PERPLEXITY_API_KEY. Returns original results unmodified if
 * the API key is missing or calls fail.
 *
 * @param {object} searchPayload - Output from searchLessons()
 * @param {object} [options]
 * @param {number} [options.enrichLimit=3] - Max results to enrich
 * @returns {Promise<object>} searchPayload with enriched results
 */
async function enrichWithPerplexity(searchPayload, options = {}) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey || !searchPayload.results || searchPayload.results.length === 0) {
    return searchPayload;
  }

  const enrichLimit = Math.min(options.enrichLimit || 3, searchPayload.results.length);
  const { PerplexityClient, normalizeSearchResults } = require('./perplexity-client');
  const client = new PerplexityClient({ apiKey });

  const enriched = await Promise.allSettled(
    searchPayload.results.slice(0, enrichLimit).map(async (result) => {
      const query = result.lesson.whatWentWrong || result.lesson.summary || result.title;
      if (!query || query.length < 10) return result;

      try {
        const searchResults = await client.search({ query, maxResults: 3 });
        const normalized = normalizeSearchResults(searchResults);
        if (normalized.length > 0) {
          result.perplexityContext = {
            sources: normalized.slice(0, 3).map((s) => ({
              title: s.title,
              url: s.url,
              snippet: s.snippet,
            })),
            enrichedAt: new Date().toISOString(),
          };
        }
      } catch {
        // Perplexity enrichment is best-effort; never block local results
      }
      return result;
    })
  );

  for (let i = 0; i < enriched.length; i++) {
    if (enriched[i].status === 'fulfilled') {
      searchPayload.results[i] = enriched[i].value;
    }
  }

  searchPayload.backend = searchPayload.backend + '+perplexity';
  return searchPayload;
}

module.exports = {
  parseLessonContent,
  resolveLessonPaths,
  searchLessons,
  enrichWithPerplexity,
  formatLessonSearchResults,
};

if (require.main === module) {
  const query = process.argv.slice(2).join(' ');
  const result = searchLessons(query, { limit: 5 });
  process.stdout.write(formatLessonSearchResults(result));
}
