#!/usr/bin/env node
'use strict';

const { listGateTemplates } = require('./gate-templates');

const CATEGORY = 'Long-Running Agent Context';

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeOptions(options = {}) {
  return {
    workflow: String(options.workflow || options.name || 'long-running-agent').trim() || 'long-running-agent',
    requestCount: toNumber(options['request-count'] || options.requests),
    outputMb: toNumber(options['output-mb'] || options['output-megabytes']),
    directorJournal: normalizeBoolean(options['director-journal'] || options.journal),
    criticReview: normalizeBoolean(options['critic-review'] || options.critic),
    criticTimeline: normalizeBoolean(options['critic-timeline'] || options.timeline),
    credibilityScores: normalizeBoolean(options['credibility-scores'] || options.credibility),
    conflicts: normalizeBoolean(options.conflicts || options['conflict-resolution']),
    rawChatOnly: normalizeBoolean(options['raw-chat-only'] || options['chat-log-only']),
  };
}

function templateApplicability(template, options) {
  if (template.id === 'require-director-journal-for-long-running-agent') {
    return options.rawChatOnly ||
      !options.directorJournal ||
      (options.requestCount !== null && options.requestCount >= 25) ||
      (options.outputMb !== null && options.outputMb >= 1);
  }
  if (template.id === 'require-critic-review-for-agent-findings') {
    return !options.criticReview || !options.credibilityScores;
  }
  if (template.id === 'checkpoint-critic-timeline-conflict-resolution') {
    return options.conflicts || !options.criticTimeline;
  }
  return false;
}

function buildSignals(options) {
  const signals = [];
  if (options.rawChatOnly || (options.requestCount !== null && options.requestCount >= 25) || (options.outputMb !== null && options.outputMb >= 1)) {
    signals.push({
      id: 'context_window_bloat',
      label: 'Context-window bloat risk',
      values: [
        options.rawChatOnly ? 'raw chat history only' : null,
        options.requestCount !== null ? `${options.requestCount} requests` : null,
        options.outputMb !== null ? `${options.outputMb}MB output` : null,
      ].filter(Boolean),
      risk: 'raw message accumulation degrades coherence and wastes context budget',
    });
  }
  if (!options.directorJournal || !options.criticReview || !options.credibilityScores) {
    signals.push({
      id: 'missing_truth_filter',
      label: 'Missing structured truth filter',
      values: [
        options.directorJournal ? null : 'no director journal',
        options.criticReview ? null : 'no critic review',
        options.credibilityScores ? null : 'no credibility scores',
      ].filter(Boolean),
      risk: 'agent summaries can become shared truth without evidence inspection',
    });
  }
  if (options.conflicts || !options.criticTimeline) {
    signals.push({
      id: 'timeline_conflict',
      label: 'Timeline conflict risk',
      values: [
        options.conflicts ? 'known conflicts' : null,
        options.criticTimeline ? null : 'no critic timeline',
      ].filter(Boolean),
      risk: 'long-lived memory can retain duplicates, stale claims, or contradictory findings',
    });
  }
  return signals;
}

function buildLongRunningAgentContextGuardrailsPlan(rawOptions = {}, templatesPath) {
  const options = normalizeOptions(rawOptions);
  const templates = listGateTemplates(templatesPath)
    .filter((template) => template.category === CATEGORY)
    .map((template) => ({
      ...template,
      recommended: templateApplicability(template, options),
    }));
  const signals = buildSignals(options);
  const recommendedTemplates = templates.filter((template) => template.recommended);

  return {
    name: 'thumbgate-long-running-agent-context-guardrails',
    status: recommendedTemplates.length > 0 ? 'actionable' : 'ready',
    workflow: options.workflow,
    summary: {
      signalCount: signals.length,
      templateCount: templates.length,
      recommendedTemplateCount: recommendedTemplates.length,
      requestCount: options.requestCount,
      outputMb: options.outputMb,
    },
    signals,
    templates,
    nextActions: [
      'Persist a director journal with observations, decisions, questions, hypotheses, and open risks.',
      'Run critic review over expert findings and attach credibility scores before promoting them to shared memory.',
      'Maintain a critic timeline that deduplicates findings and resolves conflicts by strongest evidence.',
      'Block long-running agent handoffs that rely only on accumulated chat logs.',
    ],
    exampleCommand: 'npx thumbgate long-running-agent-context-guardrails --request-count=80 --output-mb=3 --raw-chat-only --json',
  };
}

function formatLongRunningAgentContextGuardrailsPlan(report) {
  const lines = [
    '',
    'ThumbGate Long-Running Agent Context Guardrails',
    '-'.repeat(50),
    `Status  : ${report.status}`,
    `Workflow: ${report.workflow}`,
    `Signals : ${report.summary.signalCount}`,
    `Templates: ${report.summary.recommendedTemplateCount}/${report.summary.templateCount} recommended`,
  ];

  if (report.signals.length > 0) {
    lines.push('', 'Detected context risk signals:');
    for (const signal of report.signals) {
      lines.push(`  - ${signal.label}: ${signal.values.join(', ')}`);
      lines.push(`    Risk: ${signal.risk}`);
    }
  }

  lines.push('', 'Recommended templates:');
  const recommended = report.templates.filter((template) => template.recommended);
  if (recommended.length === 0) {
    lines.push('  - No long-running context risks were passed. Start with --request-count, --raw-chat-only, or critic/journal flags.');
  } else {
    for (const template of recommended) {
      lines.push(`  - ${template.id} [${template.defaultAction}]`);
      lines.push(`    ${template.roi}`);
    }
  }

  lines.push('', 'Next actions:');
  for (const action of report.nextActions) lines.push(`  - ${action}`);
  lines.push('', `Example: ${report.exampleCommand}`, '');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  buildLongRunningAgentContextGuardrailsPlan,
  formatLongRunningAgentContextGuardrailsPlan,
  normalizeOptions,
};
