#!/usr/bin/env node
'use strict';

/**
 * Agent Reasoning Traces — observable trace analytics without storing raw CoT.
 *
 * This ingests Hermes/OpenTraces-style agent records or ThumbGate session
 * events, redacts sensitive text, keeps only observable reasoning metadata,
 * and turns trace shapes into gate candidates + eval-ready tuples.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readJsonl, appendJsonl } = require('./fs-utils');
const { resolveFeedbackDir } = require('./feedback-paths');

const TRACE_FILE = 'agent-reasoning-traces.jsonl';
const MAX_TEXT = 500;

const SECRET_PATTERNS = [
  { pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED_AWS_KEY]' },
  { pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, replacement: '[REDACTED_API_KEY]' },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
];

const SHAPE_PROFILES = {
  'code-change': {
    required: ['intent', 'plan', 'tool_call', 'file_edit', 'verification'],
    recommended: ['commit_or_pr', 'evidence'],
    forbidden: ['auto_post'],
    maxErrorRate: 0.25,
  },
  'production-change': {
    required: ['intent', 'plan', 'tool_call', 'verification', 'evidence'],
    recommended: ['rollback_path', 'commit_or_pr'],
    forbidden: ['claim_done_without_evidence'],
    maxErrorRate: 0.1,
  },
  'public-engagement': {
    required: ['intent', 'audience_context', 'draft', 'approval_gate'],
    recommended: ['evidence'],
    forbidden: ['auto_post'],
    maxErrorRate: 0.15,
  },
  research: {
    required: ['intent', 'plan', 'source_capture', 'synthesis'],
    recommended: ['citation', 'evidence'],
    forbidden: [],
    maxErrorRate: 0.2,
  },
};

function getReasoningTracePath({ feedbackDir } = {}) {
  return path.join(feedbackDir || resolveFeedbackDir(), TRACE_FILE);
}

function redactTraceText(value, maxLength = MAX_TEXT) {
  if (value === undefined || value === null) return '';
  let text = String(value);
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '[REDACTED_REASONING_TRACE]');
  text = text.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '[REDACTED_REASONING_TRACE]');
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function extractMessages(record = {}) {
  const candidates = [
    record.steps,
    record.messages,
    record.conversation,
    record.conversations,
    record.trace,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  if (record.prompt || record.response || record.output) {
    return [
      record.prompt ? { role: 'user', content: record.prompt } : null,
      record.response || record.output ? { role: 'assistant', content: record.response || record.output } : null,
    ].filter(Boolean);
  }
  return [];
}

function normalizeAgentTraceRecord(record = {}, options = {}) {
  const messages = extractMessages(record);
  const steps = messages.map((message, index) => normalizeStep(message, index)).filter(Boolean);
  const taskType = options.taskType || record.taskType || inferTaskType(record, steps);
  const traceId = record.traceId || record.id || record.uuid || `trace_${Date.now()}_${hashText(JSON.stringify(record)).slice(0, 8)}`;
  const outcome = normalizeOutcome(record);

  return {
    traceId: String(traceId),
    source: record.source || record.dataset || record.source_dataset || options.source || 'local',
    taskType,
    model: record.model || record.agent?.model || record.metadata?.model || null,
    repository: record.repository || record.context?.repository || null,
    startedAt: record.startedAt || record.timestamp || null,
    finishedAt: record.finishedAt || null,
    outcome,
    steps,
    metrics: computeTraceMetrics(steps, record.metrics || record),
    privacy: {
      rawReasoningStored: false,
      redactionsApplied: steps.reduce((sum, step) => sum + step.redactions.length, 0),
      reasoningSignals: steps.filter((step) => step.reasoning).length,
    },
  };
}

function normalizeStep(message = {}, index = 0) {
  const role = String(message.role || message.from || message.type || 'unknown').toLowerCase();
  const rawContent = message.content ?? message.value ?? message.text ?? message.reasoning_content ?? '';
  const redacted = redactTraceText(rawContent);
  const reasoningRaw = message.reasoning_content || message.reasoning || message.thought || message.analysis;
  const toolCalls = extractToolCalls(message, redacted);
  const eventType = classifyStep({ role, content: redacted, toolCalls, message });
  const redactions = detectRedactions(redacted);

  return {
    index,
    role,
    eventType,
    text: eventType === 'reasoning' ? '[REDACTED_REASONING_TRACE]' : redacted,
    textHash: hashText(rawContent),
    reasoning: reasoningRaw ? {
      present: true,
      charCount: String(reasoningRaw).length,
      hash: hashText(reasoningRaw),
    } : null,
    toolCalls,
    error: detectError(redacted, message),
    redactions,
  };
}

function extractToolCalls(message = {}, content = '') {
  const calls = [];
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls
    : Array.isArray(message.toolCalls) ? message.toolCalls
      : Array.isArray(message.tools) ? message.tools
        : [];

  for (const call of rawCalls) {
    const fn = call.function || call;
    calls.push({
      name: String(fn.name || call.name || call.tool || 'unknown'),
      argumentsHash: hashText(JSON.stringify(fn.arguments || call.arguments || {})),
    });
  }

  const named = content.match(/\b(?:tool|function|command)\s*[:=]\s*([A-Za-z0-9_.:-]+)/i);
  if (calls.length === 0 && named) {
    calls.push({ name: named[1], argumentsHash: null });
  }
  return calls;
}

function classifyStep({ role, content, toolCalls, message }) {
  const text = String(content || '');
  if (message.reasoning_content || message.reasoning || message.thought || message.analysis) return 'reasoning';
  if (role === 'user') return 'intent';
  if (role === 'system') return 'system_context';
  if (role === 'tool' || role === 'function') return 'tool_response';
  if (toolCalls.length > 0) return 'tool_call';
  if (/\b(plan|steps|approach|first.*then|strategy)\b/i.test(text)) return 'plan';
  if (/\b(apply_patch|patch|diff|edited|write_file|file changed|created file)\b/i.test(text)) return 'file_edit';
  if (/\b(npm test|node --test|pytest|lint|ci passed|tests? passed|verified|verification)\b/i.test(text)) return 'verification';
  if (/\b(commit|pull request|PR #|trunk merge|merge queue|pushed)\b/i.test(text)) return 'commit_or_pr';
  if (/\b(source|citation|href|http|according to|dataset)\b/i.test(text)) return 'source_capture';
  if (/\b(summary|synthesis|therefore|recommendation)\b/i.test(text)) return 'synthesis';
  if (/\b(draft|reply copy|post text)\b/i.test(text)) return 'draft';
  if (/\b(approval|human review|approved|do not auto-post|never auto-post)\b/i.test(text)) return 'approval_gate';
  if (/\b(audience|prospect|comment|thread|bluesky|reddit|linkedin)\b/i.test(text)) return 'audience_context';
  if (/\b(evidence|screenshot|log|run link|sha|health endpoint)\b/i.test(text)) return 'evidence';
  if (/\b(rollback|revert plan|fallback)\b/i.test(text)) return 'rollback_path';
  if (/\b(auto-posted|posted automatically|sent without approval)\b/i.test(text)) return 'auto_post';
  if (/\b(done|deployed|live|shipped)\b/i.test(text) && !/\b(evidence|verified|health|sha)\b/i.test(text)) {
    return 'claim_done_without_evidence';
  }
  return role === 'assistant' ? 'assistant_message' : 'event';
}

function detectError(content, message = {}) {
  if (message.error || message.success === false) return true;
  return /\b(error|failed|exception|traceback|non-zero|blocked|denied)\b/i.test(String(content || ''));
}

function detectRedactions(content) {
  const redactions = [];
  for (const label of ['GITHUB_TOKEN', 'AWS_KEY', 'API_KEY', 'TOKEN', 'EMAIL', 'REASONING_TRACE']) {
    if (content.includes(`[REDACTED_${label}]`)) redactions.push(label.toLowerCase());
  }
  return redactions;
}

function normalizeOutcome(record = {}) {
  const success = record.success ?? record.outcome?.success ?? record.reward?.success ?? null;
  const reward = typeof record.reward === 'number' ? record.reward : record.outcome?.reward ?? null;
  return {
    success: success === null || success === undefined ? null : Boolean(success),
    reward: Number.isFinite(Number(reward)) ? Number(reward) : null,
    terminalState: record.terminal_state || record.outcome?.terminalState || record.outcome?.terminal_state || null,
  };
}

function inferTaskType(record = {}, steps = []) {
  const text = [
    record.task,
    record.category,
    record.description,
    ...steps.map((step) => step.text),
  ].filter(Boolean).join(' ');
  if (/\b(deploy|production|railway|stripe|webhook|billing)\b/i.test(text)) return 'production-change';
  if (/\b(reply|post|comment|bluesky|linkedin|reddit|threads)\b/i.test(text)) return 'public-engagement';
  if (/\b(research|source|citation|dataset|paper|article)\b/i.test(text)) return 'research';
  return 'code-change';
}

function computeTraceMetrics(steps = [], rawMetrics = {}) {
  const toolUse = new Map();
  let errorSteps = 0;
  for (const step of steps) {
    if (step.error) errorSteps += 1;
    for (const call of step.toolCalls || []) {
      toolUse.set(call.name, (toolUse.get(call.name) || 0) + 1);
    }
  }
  const totalTokens = Number(rawMetrics.total_tokens || rawMetrics.totalTokens || rawMetrics.total_input_tokens || 0)
    + Number(rawMetrics.total_output_tokens || 0);
  return {
    totalSteps: steps.length,
    toolCallCount: Array.from(toolUse.values()).reduce((sum, count) => sum + count, 0),
    tools: Array.from(toolUse.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    errorSteps,
    errorRate: steps.length ? round(errorSteps / steps.length) : 0,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0,
    estimatedCostUsd: Number(rawMetrics.estimated_cost_usd || rawMetrics.estimatedCostUsd || 0) || 0,
  };
}

function evaluateTraceShape(trace = {}, profiles = SHAPE_PROFILES) {
  const profile = profiles[trace.taskType] || profiles['code-change'];
  const events = new Set((trace.steps || []).map((step) => step.eventType));
  const missingRequired = profile.required.filter((event) => !events.has(event));
  const missingRecommended = profile.recommended.filter((event) => !events.has(event));
  const forbiddenPresent = profile.forbidden.filter((event) => events.has(event));
  const errorRate = trace.metrics?.errorRate || 0;
  const errorRateExceeded = errorRate > profile.maxErrorRate;
  const score = Math.max(0, 100
    - (missingRequired.length * 22)
    - (missingRecommended.length * 6)
    - (forbiddenPresent.length * 35)
    - (errorRateExceeded ? 20 : 0));

  return {
    traceId: trace.traceId,
    taskType: trace.taskType,
    score,
    verdict: score >= 85 ? 'healthy' : score >= 60 ? 'watch' : 'gate',
    missingRequired,
    missingRecommended,
    forbiddenPresent,
    errorRate,
    errorRateExceeded,
    expectedShape: profile,
  };
}

function buildTraceAnalytics(traces = [], options = {}) {
  const normalized = traces.map((trace) => trace.steps ? trace : normalizeAgentTraceRecord(trace, options));
  const evaluations = normalized.map((trace) => evaluateTraceShape(trace));
  const shapeCounts = countBy(evaluations, 'verdict');
  const taskTypes = countBy(normalized, 'taskType');
  const toolCounts = new Map();
  const eventCounts = new Map();

  for (const trace of normalized) {
    for (const tool of trace.metrics.tools) toolCounts.set(tool.name, (toolCounts.get(tool.name) || 0) + tool.count);
    for (const step of trace.steps) eventCounts.set(step.eventType, (eventCounts.get(step.eventType) || 0) + 1);
  }

  return {
    generatedAt: new Date().toISOString(),
    tracesAnalyzed: normalized.length,
    averageShapeScore: normalized.length ? round(evaluations.reduce((sum, item) => sum + item.score, 0) / normalized.length) : 0,
    shapeVerdicts: shapeCounts,
    taskTypes,
    topTools: sortedCounts(toolCounts),
    eventTypes: sortedCounts(eventCounts),
    evaluations,
    gateCandidates: buildTraceGateCandidates(evaluations),
    evalTuples: buildTraceEvalTuples(normalized, evaluations),
  };
}

function buildTraceGateCandidates(evaluations = []) {
  const buckets = new Map();
  for (const evaluation of evaluations) {
    for (const event of evaluation.missingRequired) {
      addGateBucket(buckets, `missing:${evaluation.taskType}:${event}`, evaluation);
    }
    for (const event of evaluation.forbiddenPresent) {
      addGateBucket(buckets, `forbidden:${evaluation.taskType}:${event}`, evaluation);
    }
    if (evaluation.errorRateExceeded) {
      addGateBucket(buckets, `error-rate:${evaluation.taskType}`, evaluation);
    }
  }

  return Array.from(buckets.values())
    .map((bucket) => ({
      ...bucket,
      priorityScore: round(bucket.occurrences + (bucket.averageScore < 60 ? 2 : 0)),
      gateId: bucket.key.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(),
      recommendation: buildTraceGateRecommendation(bucket),
    }))
    .sort((a, b) => b.priorityScore - a.priorityScore || b.occurrences - a.occurrences);
}

function addGateBucket(buckets, key, evaluation) {
  const bucket = buckets.get(key) || {
    key,
    occurrences: 0,
    totalScore: 0,
    examples: [],
  };
  bucket.occurrences += 1;
  bucket.totalScore += evaluation.score;
  bucket.averageScore = round(bucket.totalScore / bucket.occurrences);
  if (bucket.examples.length < 5) bucket.examples.push(evaluation.traceId);
  buckets.set(key, bucket);
}

function buildTraceGateRecommendation(bucket) {
  if (bucket.key.startsWith('missing:')) {
    const [, taskType, event] = bucket.key.split(':');
    return `Require "${event}" before completing ${taskType} traces; ${bucket.occurrences} examples averaged shape score ${bucket.averageScore}.`;
  }
  if (bucket.key.startsWith('forbidden:')) {
    const [, taskType, event] = bucket.key.split(':');
    return `Block "${event}" in ${taskType} traces unless explicitly approved.`;
  }
  return `Escalate verification budget when ${bucket.key.replace('error-rate:', '')} trace error rate exceeds its profile threshold.`;
}

function buildTraceEvalTuples(traces = [], evaluations = []) {
  const byId = new Map(evaluations.map((evaluation) => [evaluation.traceId, evaluation]));
  return traces.map((trace) => {
    const evaluation = byId.get(trace.traceId) || evaluateTraceShape(trace);
    return {
      id: trace.traceId,
      prompt: `Evaluate whether this ${trace.taskType} agent trace should be allowed to continue.`,
      input: {
        taskType: trace.taskType,
        events: trace.steps.map((step) => step.eventType),
        metrics: trace.metrics,
      },
      expected: evaluation.verdict === 'gate' ? 'block_or_escalate' : 'allow_with_checks',
      reward: evaluation.score >= 85 ? 1 : evaluation.score >= 60 ? 0 : -1,
      metadata: {
        shapeScore: evaluation.score,
        verdict: evaluation.verdict,
        rawReasoningStored: false,
        source: trace.source,
      },
    };
  });
}

function formatTraceAnalyticsReport(report = {}) {
  const lines = [
    '# Agent Reasoning Trace Intelligence',
    '',
    `Generated: ${report.generatedAt}`,
    `Traces analyzed: ${report.tracesAnalyzed}`,
    `Average shape score: ${report.averageShapeScore}`,
    '',
    '## Shape Verdicts',
    '',
  ];

  for (const item of sortedObjectCounts(report.shapeVerdicts || {})) {
    lines.push(`- ${item.key}: ${item.count}`);
  }
  lines.push('', '## Top Gate Candidates', '');
  for (const candidate of (report.gateCandidates || []).slice(0, 5)) {
    lines.push(`- ${candidate.gateId}: ${candidate.recommendation}`);
  }
  if (!report.gateCandidates?.length) lines.push('- None: trace shapes are currently healthy.');
  lines.push('', 'Privacy: raw hidden reasoning is not stored; only hashes, event labels, and redacted observable text are retained.', '');
  return `${lines.join('\n')}\n`;
}

function recordReasoningTrace(trace, options = {}) {
  const normalized = trace.steps ? trace : normalizeAgentTraceRecord(trace, options);
  appendJsonl(getReasoningTracePath(options), normalized);
  return normalized;
}

function loadReasoningTraces(options = {}) {
  const inputPath = options.inputPath ? path.resolve(options.inputPath) : getReasoningTracePath(options);
  return readJsonl(inputPath).map((trace) => trace.steps ? trace : normalizeAgentTraceRecord(trace, options));
}

function countBy(items, key) {
  const result = {};
  for (const item of items) {
    const value = item[key] || 'unknown';
    result[value] = (result[value] || 0) + 1;
  }
  return result;
}

function sortedCounts(map) {
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function sortedObjectCounts(object) {
  return Object.entries(object).sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { command: argv[0] || 'report' };
  for (const arg of argv.slice(1)) {
    if (!arg.startsWith('--')) continue;
    const [key, rawValue] = arg.slice(2).split('=');
    args[key] = rawValue === undefined ? true : rawValue;
  }
  return args;
}

function isCliInvocation(argv = process.argv) {
  return Boolean(argv[1] && path.resolve(argv[1]) === __filename);
}

if (isCliInvocation()) {
  const args = parseArgs();
  const traces = loadReasoningTraces({ inputPath: args.input });
  const report = buildTraceAnalytics(traces);
  if (args.command === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else if (args.command === 'eval') {
    console.log(JSON.stringify(report.evalTuples, null, 2));
  } else if (args.command === 'record') {
    const raw = args.input ? fs.readFileSync(path.resolve(args.input), 'utf8') : '';
    const parsed = raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    for (const record of parsed) recordReasoningTrace(record);
    console.log(JSON.stringify({ recorded: parsed.length }, null, 2));
  } else if (args.command === 'report') {
    console.log(formatTraceAnalyticsReport(report));
  } else {
    console.error(`Unknown command: ${args.command}. Use: report, json, eval, record`);
    process.exit(1);
  }
}

module.exports = {
  SHAPE_PROFILES,
  buildTraceAnalytics,
  buildTraceEvalTuples,
  evaluateTraceShape,
  formatTraceAnalyticsReport,
  getReasoningTracePath,
  loadReasoningTraces,
  normalizeAgentTraceRecord,
  recordReasoningTrace,
  redactTraceText,
};
