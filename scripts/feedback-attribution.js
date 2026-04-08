#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');

// ThumbGate repo: scripts/ is 1 level below repo root (not 2 like Subway .claude/scripts/feedback/)
const ROOT = path.join(__dirname, '..');
const FEEDBACK_DIR = resolveFeedbackDir();
const PATHS = {
  actionLog: path.join(FEEDBACK_DIR, 'action-log.jsonl'),
  attributions: path.join(FEEDBACK_DIR, 'feedback-attributions.jsonl'),
  attributedFeedback: path.join(FEEDBACK_DIR, 'attributed-feedback.jsonl'),
};

const STOPWORDS = new Set([
  'about', 'after', 'again', 'allow', 'already', 'always', 'because', 'before', 'being', 'between',
  'could', 'does', 'done', 'each', 'ensure', 'every', 'from', 'have', 'into', 'just', 'make', 'more',
  'most', 'must', 'never', 'only', 'other', 'over', 'repeat', 'same', 'should', 'since', 'that',
  'their', 'them', 'then', 'there', 'these', 'they', 'this', 'under', 'until', 'very', 'what', 'when',
  'where', 'which', 'while', 'with', 'without', 'would', 'thumbs', 'down', 'up', 'please', 'avoid',
]);

function readJsonl(filePath, maxLines = 500) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // ignore malformed jsonl lines
    }
  }
  return out.reverse();
}

function appendJsonl(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`);
}

function normalize(text) {
  return String(text || '')
    .replace(/\/Users\/[^\s/]+/g, '~')
    .replace(/:[0-9]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function stripFeedbackPrefix(text) {
  return String(text || '')
    .replace(/^\s*thumbs?[ -]?down\s*[:\-]?\s*/i, '')
    .replace(/^\s*thumbs?[ -]?up\s*[:\-]?\s*/i, '')
    .replace(/^\s*(negative|positive)\s+feedback\s*[:\-]?\s*/i, '')
    .trim();
}

function tokenize(text) {
  return [...new Set(
    normalize(text)
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .filter(w => w.length >= 3 && !STOPWORDS.has(w))
  )].slice(0, 24);
}

function nowIso() {
  return new Date().toISOString();
}

function hashText(text) {
  let h = 2166136261;
  const str = String(text || '');
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function summarizeToolInput(toolName, toolInput) {
  const tool = String(toolName || 'unknown');
  const input = (typeof toolInput === 'string') ? toolInput : JSON.stringify(toolInput || {});
  if (tool === 'Bash') {
    try {
      const parsed = typeof toolInput === 'string' ? JSON.parse(toolInput) : toolInput;
      if (parsed && typeof parsed.command === 'string') {
        return parsed.command;
      }
    } catch {}
    return input;
  }
  if (tool === 'Edit' || tool === 'Write') {
    try {
      const parsed = typeof toolInput === 'string' ? JSON.parse(toolInput) : toolInput;
      const p = parsed?.file_path || parsed?.path || parsed?.filePath || '';
      if (p) return `${tool} ${p}`;
    } catch {}
  }
  return input;
}

function inferIntent(toolName, text) {
  const t = normalize(text);
  if (/git\s+push|--force|git\s+reset|git\s+checkout/.test(t)) return 'git-risk';
  if (/rm\s+-rf|sudo|chmod\s+777|chown\s+-r/.test(t)) return 'destructive-shell';
  if (/\.env|secret|token|credential/.test(t)) return 'sensitive-data';
  if (toolName === 'Edit' || toolName === 'Write') return 'file-change';
  if (toolName === 'Bash') return 'shell-command';
  return 'general';
}

function riskScore(toolName, text) {
  const t = normalize(text);
  let score = 2;
  if (toolName === 'Bash') score += 2;
  if (toolName === 'Edit' || toolName === 'Write') score += 1;
  if (/--force|rm\s+-rf|reset\s+--hard|chmod\s+777|sudo/.test(t)) score += 4;
  if (/\.env|secret|token|credential/.test(t)) score += 3;
  return Math.max(1, Math.min(10, score));
}

function overlapScore(tokensA, tokensB) {
  const a = new Set(tokensA || []);
  const b = new Set(tokensB || []);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) {
    if (b.has(w)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function scoreCandidate(action, feedbackNormalized, feedbackTokens, nowMs) {
  const ts = Date.parse(action.timestamp || '') || nowMs;
  const ageMs = Math.max(0, nowMs - ts);
  const recency = Math.exp(-ageMs / (6 * 60 * 1000));
  const actionTokens = Array.isArray(action.keywords) && action.keywords.length > 0
    ? action.keywords
    : tokenize(action.normalized_input || action.input || '');
  const lexical = overlapScore(feedbackTokens, actionTokens);
  const containment = feedbackNormalized && normalize(action.normalized_input || '').includes(feedbackNormalized) ? 1 : 0;
  const risk = Number(action.risk_score || 0) / 10;
  let score = 0.45 * lexical + 0.30 * recency + 0.20 * risk + 0.05 * containment;

  const f = feedbackNormalized;
  if (/\bgit\b|\bpush\b|\bforce\b/.test(f) && action.tool_name === 'Bash') score += 0.1;
  if (/\bedit\b|\bwrite\b|\bfile\b/.test(f) && (action.tool_name === 'Edit' || action.tool_name === 'Write')) score += 0.1;

  return Math.max(0, Math.min(1, score));
}

function recordAction(toolName, toolInput, opts = {}) {
  const actionLogPath = opts.actionLogPath || process.env.THUMBGATE_ACTION_LOG || PATHS.actionLog;
  const tool = String(toolName || 'unknown');
  const inputSummary = summarizeToolInput(tool, toolInput);
  const normalized = normalize(inputSummary);
  const row = {
    action_id: `act_${Date.now()}_${hashText(`${tool}|${normalized}`)}`,
    timestamp: nowIso(),
    tool_name: tool,
    input: inputSummary,
    normalized_input: normalized,
    intent: inferIntent(tool, inputSummary),
    keywords: tokenize(inputSummary),
    risk_score: riskScore(tool, inputSummary),
  };
  appendJsonl(actionLogPath, row);
  return { ok: true, action: row, actionLogPath };
}

function attributeFeedback(signal, feedbackContext, opts = {}) {
  const sig = String(signal || '').toLowerCase().trim();
  const actionLogPath = opts.actionLogPath || process.env.THUMBGATE_ACTION_LOG || PATHS.actionLog;
  const attributionsPath = opts.attributionsPath || process.env.THUMBGATE_FEEDBACK_ATTRIBUTIONS || PATHS.attributions;
  const attributedFeedbackPath = opts.attributedFeedbackPath || process.env.THUMBGATE_ATTRIBUTED_FEEDBACK || PATHS.attributedFeedback;

  if (sig !== 'negative' && sig !== 'positive') {
    return { ok: true, skipped: true, reason: 'signal_not_supported' };
  }

  const nowMs = Date.now();
  const feedbackText = stripFeedbackPrefix(feedbackContext);
  const feedbackNormalized = normalize(feedbackText);
  const feedbackTokens = tokenize(feedbackText);
  const windowMs = Number(opts.windowMs || process.env.THUMBGATE_ATTRIBUTION_WINDOW_MS || (20 * 60 * 1000));
  const maxActions = Number(opts.maxActions || 80);
  const topK = Number(opts.topK || 3);
  const threshold = Number(opts.threshold || (sig === 'negative' ? 0.33 : 0.38));

  const actions = readJsonl(actionLogPath, maxActions)
    .filter(a => {
      const ts = Date.parse(a.timestamp || '') || nowMs;
      return (nowMs - ts) <= windowMs;
    })
    .reverse();

  const scored = actions.map(action => {
    const confidence = scoreCandidate(action, feedbackNormalized, feedbackTokens, nowMs);
    return { action, confidence };
  }).sort((a, b) => b.confidence - a.confidence);

  const selected = scored.filter(s => s.confidence >= threshold).slice(0, topK);

  const attribution = {
    attribution_id: `att_${Date.now()}_${hashText(`${sig}|${feedbackNormalized}`)}`,
    timestamp: nowIso(),
    signal: sig,
    feedback_context: feedbackContext,
    feedback_normalized: feedbackNormalized,
    threshold,
    candidates_considered: scored.length,
    attributed_actions: selected.map(s => ({
      action_id: s.action.action_id,
      tool_name: s.action.tool_name,
      input: s.action.input,
      normalized_input: s.action.normalized_input,
      intent: s.action.intent,
      confidence: Number(s.confidence.toFixed(4)),
      risk_score: s.action.risk_score,
    })),
  };

  appendJsonl(attributionsPath, attribution);

  if (sig === 'negative') {
    for (const s of selected) {
      appendJsonl(attributedFeedbackPath, {
        timestamp: attribution.timestamp,
        signal: sig,
        feedback: sig,
        source: 'attributed',
        source_detail: 'feedback-attribution-engine',
        context: s.action.input,
        tool_name: s.action.tool_name,
        attributed_action_id: s.action.action_id,
        attribution_id: attribution.attribution_id,
        confidence: Number(s.confidence.toFixed(4)),
        intent: s.action.intent,
      });
    }
  }

  return {
    ok: true,
    signal: sig,
    attributedCount: selected.length,
    topConfidence: selected.length ? Number(selected[0].confidence.toFixed(4)) : 0,
    attributionId: attribution.attribution_id,
    actionLogPath,
    attributionsPath,
    attributedFeedbackPath,
  };
}

function main() {
  const args = process.argv.slice(2);
  const recordIdx = args.indexOf('--record-action');
  const attrIdx = args.indexOf('--attribute');

  if (recordIdx >= 0) {
    const toolName = args[recordIdx + 1] || 'unknown';
    const toolInput = args[recordIdx + 2] || '{}';
    const result = recordAction(toolName, toolInput);
    process.stdout.write(JSON.stringify(result, null, 2));
    return;
  }

  if (attrIdx >= 0) {
    const signal = args[attrIdx + 1] || '';
    const context = args[attrIdx + 2] || '';
    const result = attributeFeedback(signal, context);
    process.stdout.write(JSON.stringify(result, null, 2));
    return;
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    usage: [
      '--record-action <toolName> <toolInputJson>',
      '--attribute <signal> <feedbackContext>',
    ],
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[ATTRIBUTION WARNING] ${error.message}`);
    process.exit(0);
  }
}

module.exports = {
  PATHS,
  readJsonl,
  appendJsonl,
  normalize,
  stripFeedbackPrefix,
  tokenize,
  inferIntent,
  riskScore,
  summarizeToolInput,
  overlapScore,
  scoreCandidate,
  recordAction,
  attributeFeedback,
};
