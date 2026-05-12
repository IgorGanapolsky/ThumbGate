#!/usr/bin/env node
'use strict';

/**
 * LLM Behavior Monitor
 *
 * Tracks production-facing AI quality signals that traditional unit tests miss:
 * deterministic schema/tool failures, retries, refusals, apologies, negative
 * feedback, and drift against a baseline. Outputs promotion candidates for the
 * offline golden dataset so ThumbGate's loop keeps learning from real usage.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_THRESHOLDS = {
  malformedRate: 0.02,
  wrongToolRate: 0.02,
  retryRate: 0.12,
  refusalRate: 0.08,
  apologyRate: 0.08,
  negativeFeedbackRate: 0.1,
  driftDelta: 0.05,
};

function analyzeBehaviorEvents(events = [], options = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };
  const normalized = events.map(normalizeEvent);
  const total = normalized.length;
  const counts = {
    malformed: normalized.filter((event) => !event.schemaValid).length,
    wrongTool: normalized.filter((event) => event.expectedTool && event.actualTool && event.expectedTool !== event.actualTool).length,
    missingTool: normalized.filter((event) => event.expectedTool && !event.actualTool).length,
    retries: normalized.filter((event) => event.retryCount > 0 || event.regenerated).length,
    refusals: normalized.filter((event) => event.refusal).length,
    apologies: normalized.filter((event) => event.apology).length,
    negativeFeedback: normalized.filter((event) => event.feedback === 'down' || event.rating < 0).length,
  };
  const rates = Object.fromEntries(Object.entries(counts).map(([key, count]) => [rateKey(key), total === 0 ? 0 : count / total]));
  const baseline = options.baseline || {};
  const drift = computeDrift(rates, baseline);
  const alerts = buildAlerts(rates, drift, thresholds);
  const goldenCandidates = buildGoldenDatasetCandidates(normalized);

  return {
    total,
    counts,
    rates,
    drift,
    alerts,
    goldenCandidates,
    verdict: alerts.some((alert) => alert.severity === 'block') ? 'blocked' : alerts.length ? 'watch' : 'stable',
    nextActions: buildNextActions(alerts, goldenCandidates),
  };
}

function normalizeEvent(event = {}) {
  const output = String(event.output || event.response || event.text || '');
  const expectedTool = event.expectedTool || event.expected_action || event.expectedAction || null;
  const actualTool = event.actualTool || event.toolName || event.tool || null;
  const schemaValid = event.schemaValid !== undefined ? Boolean(event.schemaValid) : !event.schemaError;
  return {
    id: event.id || event.sessionId || event.traceId || null,
    input: event.input || event.prompt || '',
    output,
    expectedTool,
    actualTool,
    schemaValid,
    retryCount: Number(event.retryCount || event.retries || 0),
    regenerated: Boolean(event.regenerated || event.regeneration),
    refusal: event.refusal !== undefined ? Boolean(event.refusal) : /\b(i can'?t|i cannot|unable to comply|not able to)\b/i.test(output),
    apology: event.apology !== undefined ? Boolean(event.apology) : /\b(i'?m sorry|apologize|apologies)\b/i.test(output),
    feedback: normalizeFeedback(event.feedback || event.signal || event.thumb),
    rating: Number(event.rating || 0),
    correctedOutput: event.correctedOutput || event.expectedOutput || event.goldenOutput || null,
    riskTags: Array.isArray(event.riskTags) ? event.riskTags : [],
  };
}

function normalizeFeedback(value) {
  const text = String(value || '').toLowerCase();
  if (['down', 'thumbs-down', 'thumbs_down', 'negative', '👎'].includes(text)) return 'down';
  if (['up', 'thumbs-up', 'thumbs_up', 'positive', '👍'].includes(text)) return 'up';
  return null;
}

function rateKey(key) {
  if (key === 'malformed') return 'malformedRate';
  if (key === 'wrongTool') return 'wrongToolRate';
  if (key === 'missingTool') return 'missingToolRate';
  if (key === 'retries') return 'retryRate';
  if (key === 'refusals') return 'refusalRate';
  if (key === 'apologies') return 'apologyRate';
  if (key === 'negativeFeedback') return 'negativeFeedbackRate';
  return `${key}Rate`;
}

function computeDrift(rates, baseline = {}) {
  const drift = {};
  for (const [key, value] of Object.entries(rates)) {
    if (typeof baseline[key] === 'number') {
      drift[key] = Number((value - baseline[key]).toFixed(4));
    }
  }
  return drift;
}

function buildAlerts(rates, drift, thresholds) {
  const alerts = [];
  for (const [key, value] of Object.entries(rates)) {
    const threshold = thresholds[key];
    if (typeof threshold === 'number' && value > threshold) {
      alerts.push({
        id: `${key}-threshold`,
        severity: isDeterministicFailure(key) ? 'block' : 'warn',
        metric: key,
        value,
        threshold,
        reason: `${key} ${formatPct(value)} exceeds ${formatPct(threshold)} threshold.`,
      });
    }
  }
  for (const [key, delta] of Object.entries(drift)) {
    if (delta > thresholds.driftDelta) {
      alerts.push({
        id: `${key}-drift`,
        severity: isDeterministicFailure(key) ? 'block' : 'warn',
        metric: key,
        value: delta,
        threshold: thresholds.driftDelta,
        reason: `${key} drift increased by ${formatPct(delta)} versus baseline.`,
      });
    }
  }
  return alerts;
}

function isDeterministicFailure(metric) {
  return ['malformedRate', 'wrongToolRate', 'missingToolRate'].includes(metric);
}

function buildGoldenDatasetCandidates(events) {
  return events
    .filter((event) => event.feedback === 'down' || event.retryCount > 0 || event.refusal || event.apology || !event.schemaValid)
    .map((event) => ({
      id: event.id,
      input: event.input,
      expectedOutput: event.correctedOutput || event.output,
      reason: candidateReason(event),
      reviewRequired: true,
      syntheticVariants: event.riskTags.includes('high-stakes') ? 5 : 2,
    }));
}

function candidateReason(event) {
  if (!event.schemaValid) return 'deterministic_schema_failure';
  if (event.feedback === 'down') return 'explicit_negative_feedback';
  if (event.retryCount > 0 || event.regenerated) return 'retry_or_regeneration';
  if (event.refusal) return 'refusal_pattern';
  if (event.apology) return 'apology_pattern';
  return 'behavior_signal';
}

function buildNextActions(alerts, candidates) {
  const actions = [];
  if (alerts.some((alert) => alert.severity === 'block')) {
    actions.push('Block release until deterministic schema/tool-call regressions are fixed.');
  }
  if (alerts.some((alert) => alert.metric === 'refusalRate')) {
    actions.push('Audit refusal examples for over-calibrated safety policy or missing tool routing.');
  }
  if (alerts.some((alert) => alert.metric === 'retryRate')) {
    actions.push('Review high-retry sessions for prompt ambiguity and missing context.');
  }
  if (candidates.length > 0) {
    actions.push('Promote reviewed failure examples into the offline golden dataset with synthetic variants.');
  }
  if (actions.length === 0) actions.push('Keep monitoring; no behavior drift thresholds crossed.');
  return actions;
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatBehaviorReport(report = {}) {
  return [
    '# LLM Behavior Monitor',
    '',
    `Verdict: ${report.verdict}`,
    `Events: ${report.total}`,
    '',
    '## Rates',
    '',
    ...Object.entries(report.rates || {}).map(([key, value]) => `- ${key}: ${formatPct(value)}`),
    '',
    '## Alerts',
    '',
    ...(report.alerts?.length ? report.alerts.map((alert) => `- ${alert.severity}: ${alert.id} - ${alert.reason}`) : ['- none']),
    '',
    '## Golden Dataset Candidates',
    '',
    `Candidates: ${(report.goldenCandidates || []).length}`,
    '',
    '## Next Actions',
    '',
    ...(report.nextActions || []).map((action) => `- ${action}`),
    '',
  ].join('\n');
}

function loadEvents(filePath) {
  if (!filePath) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.jsonl')) {
    return text.split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
  }
  return JSON.parse(text);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { command: argv[0] || 'report' };
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('--input=')) args.input = arg.slice('--input='.length);
  }
  return args;
}

function isCliInvocation(argv = process.argv) {
  return Boolean(argv[1] && path.resolve(argv[1]) === __filename);
}

if (isCliInvocation()) {
  const args = parseArgs();
  const report = analyzeBehaviorEvents(loadEvents(args.input));
  if (args.command === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else if (args.command === 'report') {
    console.log(formatBehaviorReport(report));
  } else {
    console.error(`Unknown command: ${args.command}. Use: report, json`);
    process.exit(1);
  }
}

module.exports = {
  analyzeBehaviorEvents,
  buildGoldenDatasetCandidates,
  formatBehaviorReport,
  normalizeEvent,
};
