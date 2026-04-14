#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { isAvailable, callClaude, MODELS } = require('./llm-client');
const { resolveFeedbackDir } = require('./feedback-paths');

const EVAL_LOG_FILE = 'quality-eval-log.jsonl';

// G-Eval scoring dimensions for ThumbGate
const DIMENSIONS = {
  gate: {
    relevance: 'Was this gate triggered for the right reason? (1=completely wrong, 5=perfectly targeted)',
    precision: 'Did the gate block only what it should? (1=blocked everything, 5=surgical precision)',
    actionability: 'Was the block message helpful for the agent? (1=cryptic, 5=clear fix path)',
  },
  lesson: {
    specificity: 'Is this lesson specific enough to prevent future issues? (1=generic platitude, 5=precise root cause)',
    accuracy: 'Does the lesson correctly identify what went wrong? (1=misdiagnosis, 5=exact cause)',
    durability: 'Will this lesson stay relevant over time? (1=ephemeral, 5=fundamental principle)',
  },
  session: {
    efficiency: 'Did the agent minimize wasted actions? (1=repeated same mistake, 5=zero waste)',
    compliance: 'Did the agent follow ThumbGate gates and rules? (1=ignored all gates, 5=perfect compliance)',
    outcome: 'Did the session achieve its goal? (1=total failure, 5=exceeded expectations)',
  },
};

function buildGEvalPrompt(type, item) {
  const dims = DIMENSIONS[type];
  if (!dims) return null;

  const dimList = Object.entries(dims)
    .map(([key, desc]) => `- **${key}**: ${desc}`)
    .join('\n');

  return {
    systemPrompt: `You are a quality evaluator for ThumbGate, a pre-action gate system for AI coding agents. You evaluate ${type}s using G-Eval methodology: chain-of-thought reasoning followed by a score.

For each dimension, output a JSON object with:
- "dimension": the dimension name
- "reasoning": 1-2 sentence chain-of-thought explanation
- "score": integer 1-5

Output a JSON array of all dimension evaluations. No other text.`,
    userPrompt: `Evaluate this ${type}:

${JSON.stringify(item, null, 2)}

Dimensions:
${dimList}

Return a JSON array of evaluations.`,
  };
}

function heuristicScore(type, item) {
  const dims = Object.keys(DIMENSIONS[type] || {});
  return dims.map((dim) => {
    let score = 3;
    if (type === 'lesson') {
      const text = item.lesson || item.inferredLesson || '';
      if (text.length > 100) score += 1;
      if (/avoid|never|always|must/i.test(text)) score += 1;
      if (text.length < 20) score -= 1;
      if (/something|stuff|things/i.test(text)) score -= 1;
    } else if (type === 'gate') {
      if (item.pattern && item.pattern.length > 5) score += 1;
      if (item.message && item.message.length > 20) score += 1;
      if (item.severity === 'high') score += 1;
    } else if (type === 'session') {
      if (item.wasteCount === 0) score += 1;
      if (item.confusionSignals && item.confusionSignals.length === 0) score += 1;
      if (item.goalAchieved) score += 1;
    }
    score = Math.max(1, Math.min(5, score));
    return { dimension: dim, reasoning: 'heuristic evaluation', score };
  });
}

async function evaluateWithLLM(type, item, options = {}) {
  const prompt = buildGEvalPrompt(type, item);
  if (!prompt) return null;

  const model = options.model || MODELS.FAST;
  const raw = await callClaude({
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    model,
    maxTokens: 1024,
    cacheSystemPrompt: Boolean(options.cacheSystemPrompt),
  });

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (d) => d.dimension && typeof d.score === 'number' && d.score >= 1 && d.score <= 5
    );
  } catch {
    return null;
  }
}

async function evaluate(type, item, options = {}) {
  if (!DIMENSIONS[type]) {
    return { error: `Unknown eval type: ${type}. Valid: ${Object.keys(DIMENSIONS).join(', ')}` };
  }

  let scores;
  let model = 'heuristic';

  if (isAvailable() && !options.forceHeuristic) {
    scores = await evaluateWithLLM(type, item, options);
    if (scores) model = options.model || MODELS.FAST;
  }

  if (!scores) {
    scores = heuristicScore(type, item);
  }

  const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;

  const result = {
    type,
    model,
    scores,
    average: Math.round(avgScore * 100) / 100,
    evaluatedAt: new Date().toISOString(),
  };

  // Persist
  const feedbackDir = resolveFeedbackDir({});
  const logPath = path.join(feedbackDir, EVAL_LOG_FILE);
  try {
    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify({ ...result, item }) + '\n');
  } catch {
    // non-fatal
  }

  return result;
}

async function evaluateBatch(type, items, options = {}) {
  // Enable prompt caching for batch evals — the system prompt is identical
  // across all items, so caching avoids resending it on every call.
  const batchOptions = { ...options, cacheSystemPrompt: true };
  const results = [];
  for (const item of items) {
    const result = await evaluate(type, item, batchOptions);
    results.push(result);
    if (isAvailable() && !options.forceHeuristic) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  const avgScores = results
    .filter((r) => !r.error)
    .reduce((sum, r) => sum + r.average, 0) / results.filter((r) => !r.error).length;

  return {
    type,
    count: results.length,
    batchAverage: Math.round((avgScores || 0) * 100) / 100,
    results,
    evaluatedAt: new Date().toISOString(),
  };
}

function getEvalHistory(options = {}) {
  const feedbackDir = resolveFeedbackDir({});
  const logPath = path.join(feedbackDir, EVAL_LOG_FILE);
  try {
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    const entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const limit = options.limit || 50;
    const filtered = options.type ? entries.filter((e) => e.type === options.type) : entries;
    return filtered.slice(-limit);
  } catch {
    return [];
  }
}

function getEvalSummary() {
  const history = getEvalHistory({ limit: 1000 });
  if (history.length === 0) return { message: 'No evaluations yet. Run quality_eval to score gates, lessons, or sessions.' };

  const byType = {};
  for (const entry of history) {
    if (!byType[entry.type]) byType[entry.type] = { count: 0, totalScore: 0, scores: {} };
    byType[entry.type].count += 1;
    byType[entry.type].totalScore += entry.average || 0;
    for (const s of (entry.scores || [])) {
      if (!byType[entry.type].scores[s.dimension]) byType[entry.type].scores[s.dimension] = { total: 0, count: 0 };
      byType[entry.type].scores[s.dimension].total += s.score;
      byType[entry.type].scores[s.dimension].count += 1;
    }
  }

  const summary = {};
  for (const [type, data] of Object.entries(byType)) {
    summary[type] = {
      count: data.count,
      averageScore: Math.round((data.totalScore / data.count) * 100) / 100,
      dimensions: {},
    };
    for (const [dim, vals] of Object.entries(data.scores)) {
      summary[type].dimensions[dim] = Math.round((vals.total / vals.count) * 100) / 100;
    }
  }

  return { totalEvaluations: history.length, summary };
}

/**
 * Auto-evaluate a newly created lesson. Called inline by createLesson()
 * so every lesson gets a quality score at birth. Uses heuristics when
 * the API is unavailable; upgrades to LLM scoring otherwise.
 * Returns the evaluation result (or null on error).
 */
async function autoEvalLesson(lesson) {
  try {
    return await evaluate('lesson', {
      lesson: lesson.lesson || lesson.inferredLesson || '',
      signal: lesson.signal,
      confidence: lesson.confidence,
      tags: lesson.tags,
    });
  } catch {
    return null;
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'summary';

  if (cmd === 'summary') {
    console.log(JSON.stringify(getEvalSummary(), null, 2));
  } else if (cmd === 'history') {
    const type = args[1];
    const limit = parseInt(args[2]) || 20;
    console.log(JSON.stringify(getEvalHistory({ type, limit }), null, 2));
  } else if (cmd === 'eval') {
    const type = args[1];
    const itemJson = args[2];
    if (!type || !itemJson) {
      console.error('Usage: quality-eval.js eval <gate|lesson|session> \'<json>\'');
      process.exit(1);
    }
    evaluate(type, JSON.parse(itemJson)).then((r) => console.log(JSON.stringify(r, null, 2)));
  } else {
    console.error('Usage: quality-eval.js <summary|history|eval>');
    process.exit(1);
  }
}

module.exports = {
  DIMENSIONS,
  autoEvalLesson,
  evaluate,
  evaluateBatch,
  getEvalHistory,
  getEvalSummary,
  heuristicScore,
};
