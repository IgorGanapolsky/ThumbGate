#!/usr/bin/env node
'use strict';

const path = require('path');
const { listGateTemplates } = require('./gate-templates');

const DEFAULT_GRAPH_TOOL = 'code-graph';
const KNOWLEDGE_GRAPH_CATEGORY = 'Knowledge Graph Safety';

function splitCsv(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (value === undefined || value === null || value === true) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeOptions(options = {}) {
  const layers = unique([
    ...splitCsv(options.layers),
    ...splitCsv(options['layers-touched']),
  ]);
  const centralFiles = unique([
    ...splitCsv(options['central-files']),
    ...splitCsv(options.centrality === 'high' || options.centrality === 'critical' ? options.files : []),
  ]);
  const generatedArtifacts = unique([
    ...splitCsv(options['generated-artifacts']),
    ...splitCsv(options.artifacts),
  ]);

  return {
    graphTool: String(options['graph-tool'] || options.tool || DEFAULT_GRAPH_TOOL).trim() || DEFAULT_GRAPH_TOOL,
    graphPath: options['graph-path'] ? String(options['graph-path']).trim() : null,
    centralFiles,
    layersTouched: layers,
    generatedArtifacts,
    changedFiles: Number.isFinite(Number(options['changed-files'])) ? Number(options['changed-files']) : null,
  };
}

function gateApplicability(template, options) {
  if (template.id === 'require-diff-impact-before-central-edit') {
    return options.centralFiles.length > 0;
  }
  if (template.id === 'checkpoint-cross-layer-refactor') {
    return options.layersTouched.length >= 2;
  }
  if (template.id === 'protect-graph-generated-artifacts') {
    return options.generatedArtifacts.length > 0 || Boolean(options.graphPath);
  }
  return false;
}

function buildSignalSummary(options) {
  const signals = [];
  if (options.centralFiles.length > 0) {
    signals.push({
      id: 'central_files',
      label: 'High-centrality files',
      values: options.centralFiles,
      risk: 'central edits can break many downstream paths',
    });
  }
  if (options.layersTouched.length >= 2) {
    signals.push({
      id: 'cross_layer_refactor',
      label: 'Cross-layer refactor',
      values: options.layersTouched,
      risk: 'one run is crossing architectural layers',
    });
  }
  if (options.generatedArtifacts.length > 0 || options.graphPath) {
    signals.push({
      id: 'generated_graph_artifacts',
      label: 'Generated graph artifacts',
      values: unique([...options.generatedArtifacts, options.graphPath ? path.normalize(options.graphPath) : null]),
      risk: 'graph outputs should be regenerated from source, not hand-edited',
    });
  }
  if (options.changedFiles !== null && options.changedFiles >= 20) {
    signals.push({
      id: 'large_blast_radius',
      label: 'Large blast radius',
      values: [`${options.changedFiles} changed files`],
      risk: 'large graph-informed changes should be checkpointed before execution continues',
    });
  }
  return signals;
}

function buildCodeGraphGuardrailsPlan(rawOptions = {}, templatesPath) {
  const options = normalizeOptions(rawOptions);
  const templates = listGateTemplates(templatesPath)
    .filter((template) => template.category === KNOWLEDGE_GRAPH_CATEGORY);
  const signals = buildSignalSummary(options);
  const recommendedTemplates = templates.map((template) => ({
    ...template,
    recommended: gateApplicability(template, options),
  }));

  const activeTemplates = recommendedTemplates.filter((template) => template.recommended);
  const status = activeTemplates.length > 0 ? 'actionable' : 'ready';

  return {
    name: 'thumbgate-code-graph-guardrails',
    status,
    graphTool: options.graphTool,
    graphPath: options.graphPath,
    summary: {
      signalCount: signals.length,
      templateCount: templates.length,
      recommendedTemplateCount: activeTemplates.length,
      changedFiles: options.changedFiles,
    },
    signals,
    templates: recommendedTemplates,
    nextActions: [
      'Generate or refresh the code graph before a risky agent edit session.',
      'Tag central files, architecture layers, and generated graph outputs in your agent context.',
      'Enable the recommended Knowledge Graph Safety templates as pre-action gates.',
      'Capture thumbs-down corrections when a graph-informed action still misses impact review.',
    ],
    exampleCommand: 'npx thumbgate code-graph-guardrails --central-files=src/api/server.js --layers=api,data --generated-artifacts=.codegraph/index.json --json',
  };
}

function formatCodeGraphGuardrailsPlan(report) {
  const lines = [
    '',
    'ThumbGate Code Graph Guardrails',
    '-'.repeat(36),
    `Status     : ${report.status}`,
    `Graph tool : ${report.graphTool}`,
  ];
  if (report.graphPath) lines.push(`Graph path : ${report.graphPath}`);
  lines.push(`Signals    : ${report.summary.signalCount}`);
  lines.push(`Templates  : ${report.summary.recommendedTemplateCount}/${report.summary.templateCount} recommended`);

  if (report.signals.length > 0) {
    lines.push('', 'Detected graph risk signals:');
    for (const signal of report.signals) {
      lines.push(`  - ${signal.label}: ${signal.values.join(', ')}`);
      lines.push(`    Risk: ${signal.risk}`);
    }
  }

  lines.push('', 'Recommended templates:');
  for (const template of report.templates.filter((entry) => entry.recommended)) {
    lines.push(`  - ${template.id} [${template.defaultAction}]`);
    lines.push(`    ${template.roi}`);
  }
  if (report.summary.recommendedTemplateCount === 0) {
    lines.push('  - No graph-specific signals were passed. Start by supplying --central-files, --layers, or --generated-artifacts.');
  }

  lines.push('', 'Next actions:');
  for (const action of report.nextActions) lines.push(`  - ${action}`);
  lines.push('', `Example: ${report.exampleCommand}`, '');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  buildCodeGraphGuardrailsPlan,
  formatCodeGraphGuardrailsPlan,
  normalizeOptions,
};
