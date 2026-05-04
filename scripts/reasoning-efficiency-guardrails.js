#!/usr/bin/env node
'use strict';

const { listGateTemplates } = require('./gate-templates');

const CATEGORY = 'Reasoning Efficiency Safety';

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
    workload: String(options.workload || options.name || 'reasoning').trim() || 'reasoning',
    baselineTokens: toNumber(options['baseline-tokens']),
    compressedTokens: toNumber(options['compressed-tokens']),
    baselineAccuracy: toNumber(options['baseline-accuracy'] || options['baseline-pass1']),
    compressedAccuracy: toNumber(options['compressed-accuracy'] || options['compressed-pass1']),
    verifier: normalizeBoolean(options.verifier || options['verification-outcomes']),
    lowConfidenceSteps: toNumber(options['low-confidence-steps']),
    highConfidenceFailures: toNumber(options['high-confidence-failures']),
    truncationFailures: normalizeBoolean(options['truncation-failures']),
  };
}

function tokenReductionPercent(options) {
  if (options.baselineTokens === null || options.compressedTokens === null || options.baselineTokens <= 0) return null;
  return Number((((options.baselineTokens - options.compressedTokens) / options.baselineTokens) * 100).toFixed(2));
}

function accuracyDelta(options) {
  if (options.baselineAccuracy === null || options.compressedAccuracy === null) return null;
  return Number((options.compressedAccuracy - options.baselineAccuracy).toFixed(4));
}

function templateApplicability(template, options) {
  if (template.id === 'require-verifier-before-reasoning-compression') {
    return !options.verifier || accuracyDelta(options) === null || (accuracyDelta(options) !== null && accuracyDelta(options) < -0.01);
  }
  if (template.id === 'checkpoint-low-confidence-reasoning-steps') {
    return options.lowConfidenceSteps !== null && options.lowConfidenceSteps > 0;
  }
  if (template.id === 'checkpoint-high-confidence-failed-rollout') {
    return (options.highConfidenceFailures !== null && options.highConfidenceFailures > 0) || options.truncationFailures;
  }
  return false;
}

function buildSignals(options) {
  const signals = [];
  const tokenReduction = tokenReductionPercent(options);
  const delta = accuracyDelta(options);
  if (tokenReduction !== null || delta !== null || !options.verifier) {
    signals.push({
      id: 'reasoning_compression',
      label: 'Reasoning compression rollout',
      values: [
        tokenReduction !== null ? `${tokenReduction}% token reduction` : null,
        delta !== null ? `${delta} accuracy delta` : null,
        options.verifier ? 'verifier present' : 'missing verifier',
      ].filter(Boolean),
      risk: 'shorter traces can reduce cost while destabilizing accuracy',
    });
  }
  if (options.lowConfidenceSteps !== null && options.lowConfidenceSteps > 0) {
    signals.push({
      id: 'low_confidence_steps',
      label: 'Low-confidence accepted steps',
      values: [`${options.lowConfidenceSteps} step(s)`],
      risk: 'successful rollouts can still contain brittle intermediate reasoning',
    });
  }
  if ((options.highConfidenceFailures !== null && options.highConfidenceFailures > 0) || options.truncationFailures) {
    signals.push({
      id: 'failed_confident_rollouts',
      label: 'High-confidence failed rollout',
      values: [
        options.highConfidenceFailures !== null ? `${options.highConfidenceFailures} failure(s)` : null,
        options.truncationFailures ? 'truncation failure' : null,
      ].filter(Boolean),
      risk: 'failed rollouts may reflect verifier noise or truncation rather than bad reasoning',
    });
  }
  return signals;
}

function buildReasoningEfficiencyGuardrailsPlan(rawOptions = {}, templatesPath) {
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
    name: 'thumbgate-reasoning-efficiency-guardrails',
    status: recommendedTemplates.length > 0 ? 'actionable' : 'ready',
    workload: options.workload,
    metrics: {
      baselineTokens: options.baselineTokens,
      compressedTokens: options.compressedTokens,
      tokenReductionPercent: tokenReductionPercent(options),
      baselineAccuracy: options.baselineAccuracy,
      compressedAccuracy: options.compressedAccuracy,
      accuracyDelta: accuracyDelta(options),
    },
    summary: {
      signalCount: signals.length,
      templateCount: templates.length,
      recommendedTemplateCount: recommendedTemplates.length,
    },
    signals,
    templates,
    nextActions: [
      'Keep a verifier and pass@1 baseline before compressing reasoning traces.',
      'Inspect low-confidence steps even when the final rollout is correct.',
      'Inspect high-confidence failed rollouts for truncation or verifier noise before penalizing the trace.',
      'Route cheaper compressed reasoning only after accuracy and efficiency both clear the gate.',
    ],
    exampleCommand: 'npx thumbgate reasoning-efficiency-guardrails --baseline-tokens=1200 --compressed-tokens=980 --baseline-accuracy=0.84 --compressed-accuracy=0.85 --verifier --json',
  };
}

function formatReasoningEfficiencyGuardrailsPlan(report) {
  const lines = [
    '',
    'ThumbGate Reasoning Efficiency Guardrails',
    '-'.repeat(43),
    `Status  : ${report.status}`,
    `Workload: ${report.workload}`,
    `Signals : ${report.summary.signalCount}`,
    `Templates: ${report.summary.recommendedTemplateCount}/${report.summary.templateCount} recommended`,
  ];
  if (report.metrics.tokenReductionPercent !== null) lines.push(`Token reduction: ${report.metrics.tokenReductionPercent}%`);
  if (report.metrics.accuracyDelta !== null) lines.push(`Accuracy delta : ${report.metrics.accuracyDelta}`);

  if (report.signals.length > 0) {
    lines.push('', 'Detected reasoning-efficiency signals:');
    for (const signal of report.signals) {
      lines.push(`  - ${signal.label}: ${signal.values.join(', ')}`);
      lines.push(`    Risk: ${signal.risk}`);
    }
  }

  lines.push('', 'Recommended templates:');
  const recommended = report.templates.filter((template) => template.recommended);
  if (recommended.length === 0) lines.push('  - No reasoning-efficiency risks were passed.');
  for (const template of recommended) {
    lines.push(`  - ${template.id} [${template.defaultAction}]`);
    lines.push(`    ${template.roi}`);
  }

  lines.push('', 'Next actions:');
  for (const action of report.nextActions) lines.push(`  - ${action}`);
  lines.push('', `Example: ${report.exampleCommand}`, '');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  buildReasoningEfficiencyGuardrailsPlan,
  formatReasoningEfficiencyGuardrailsPlan,
  normalizeOptions,
  tokenReductionPercent,
  accuracyDelta,
};
