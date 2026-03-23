'use strict';

const { readJSONL, getFeedbackPaths } = require('./feedback-loop');
const { loadAutoGates } = require('./auto-promote-gates');
const { searchPreventionRulesSync } = require('./filesystem-search');

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

function buildRuleMatches(queryText, limit = 3) {
  return searchPreventionRulesSync(queryText, limit)
    .map((rule) => ({
      title: rule.title,
      summary: String(rule.body || '').split('\n')[0] || '',
      score: Number((rule._score || 0).toFixed(4)),
    }));
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

function buildGateMatches(memory, parsed, limit = 3) {
  const autoGates = loadAutoGates();
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
  const ruleMatches = buildRuleMatches(lessonQuery, Number(options.ruleLimit || 3));
  const gateMatches = buildGateMatches(memory, parsed, Number(options.gateLimit || 3));
  const { score, matchedTokens } = scoreLesson(options.query || '', memory, parsed, sourceFeedback);

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
    },
  };
}

function searchLessons(query = '', options = {}) {
  const { MEMORY_LOG_PATH, FEEDBACK_DIR } = getFeedbackPaths();
  const memories = readJSONL(MEMORY_LOG_PATH);
  const feedbackEntries = readJSONL(getFeedbackPaths().FEEDBACK_LOG_PATH);
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
  };
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
  });

  return `${lines.join('\n')}\n`;
}

module.exports = {
  parseLessonContent,
  searchLessons,
  formatLessonSearchResults,
};

if (require.main === module) {
  const query = process.argv.slice(2).join(' ');
  const result = searchLessons(query, { limit: 5 });
  process.stdout.write(formatLessonSearchResults(result));
}
