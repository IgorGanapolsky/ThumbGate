#!/usr/bin/env node
'use strict';

const path = require('path');
const { listGateTemplates } = require('./gate-templates');

const DOCUMENT_RAG_CATEGORY = 'Document RAG Safety';

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

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function normalizeOptions(options = {}) {
  const sectionIds = unique([
    ...splitCsv(options.sections),
    ...splitCsv(options['section-ids']),
  ]);
  const imagePointers = unique([
    ...splitCsv(options['image-pointers']),
    ...splitCsv(options.images),
    ...splitCsv(options.figures),
  ]);
  const documentIds = unique([
    ...splitCsv(options.documents),
    ...splitCsv(options['document-ids']),
  ]);
  const sourcePointers = unique([
    ...splitCsv(options['source-pointers']),
    ...splitCsv(options.pointers),
    ...splitCsv(options.sources),
  ]);
  const candidateImages = Number.isFinite(Number(options['candidate-images']))
    ? Number(options['candidate-images'])
    : null;
  const extractedEntities = Number.isFinite(Number(options['extracted-entities']))
    ? Number(options['extracted-entities'])
    : 0;
  const extractedRelations = Number.isFinite(Number(options['extracted-relations']))
    ? Number(options['extracted-relations'])
    : 0;
  const promotionThreshold = Number.isFinite(Number(options['promotion-threshold']))
    ? Number(options['promotion-threshold'])
    : 3;

  return {
    ragTool: String(options['rag-tool'] || options.tool || 'proxy-pointer-rag').trim() || 'proxy-pointer-rag',
    treePath: options['tree-path'] ? path.normalize(String(options['tree-path']).trim()) : null,
    sectionIds,
    imagePointers,
    documentIds,
    sourcePointers,
    candidateImages,
    extractedEntities,
    extractedRelations,
    promotionThreshold,
    crossDocumentPolicy: String(options['cross-doc-policy'] || options['cross-document-policy'] || '').trim().toLowerCase(),
    visionFilter: normalizeBoolean(options['vision-filter']),
    visualClaims: normalizeBoolean(options['visual-claims']),
    pointerFirst: normalizeBoolean(options['pointer-first']) || normalizeBoolean(options['proxy-pointer']),
  };
}

function gateApplicability(template, options) {
  if (template.id === 'require-section-tree-before-multimodal-answer') {
    return Boolean(options.treePath || options.sectionIds.length > 0);
  }
  if (template.id === 'require-image-pointer-grounding') {
    return options.imagePointers.length > 0;
  }
  if (template.id === 'block-cross-document-image-leakage') {
    return options.documentIds.length > 1 || options.crossDocumentPolicy === 'strict';
  }
  if (template.id === 'checkpoint-vision-filter-for-visual-claims') {
    return options.visualClaims || options.visionFilter || (options.candidateImages !== null && options.candidateImages > 0);
  }
  return false;
}

function hasExtractionSprawl(options) {
  const extractedFacts = options.extractedEntities + options.extractedRelations;
  if (extractedFacts === 0) return false;
  if (options.pointerFirst) return true;
  if (options.sourcePointers.length === 0) return true;
  return extractedFacts > options.sourcePointers.length * Math.max(2, options.promotionThreshold);
}

function buildSignalSummary(options) {
  const signals = [];
  if (options.treePath || options.sectionIds.length > 0) {
    signals.push({
      id: 'section_tree',
      label: 'Hierarchical section tree',
      values: unique([options.treePath, ...options.sectionIds]),
      risk: 'visual answers should be grounded in document structure, not sliding-window chunks',
    });
  }
  if (options.imagePointers.length > 0) {
    signals.push({
      id: 'image_pointers',
      label: 'Image pointers',
      values: options.imagePointers,
      risk: 'every selected visual needs source document, parent section, and path metadata',
    });
  }
  if (options.documentIds.length > 1 || options.crossDocumentPolicy === 'strict') {
    signals.push({
      id: 'cross_document_leakage',
      label: 'Cross-document leakage risk',
      values: options.documentIds.length > 0 ? options.documentIds : ['strict cross-document policy'],
      risk: 'a plausible image from the wrong document can invalidate the answer',
    });
  }
  if (options.visualClaims || options.visionFilter || (options.candidateImages !== null && options.candidateImages > 0)) {
    signals.push({
      id: 'visual_claims',
      label: 'Visual claim checkpoint',
      values: unique([
        options.visualClaims ? 'visual claims enabled' : null,
        options.visionFilter ? 'vision filter enabled' : null,
        options.candidateImages !== null ? `${options.candidateImages} candidate images` : null,
      ]),
      risk: 'answers that describe image content may need a vision-model sanity check',
    });
  }
  if (hasExtractionSprawl(options)) {
    signals.push({
      id: 'entity_relation_sprawl',
      label: 'Entity/relation extraction sprawl',
      values: unique([
        `${options.extractedEntities} extracted entities`,
        `${options.extractedRelations} extracted relations`,
        `${options.sourcePointers.length} source pointers`,
        `promotion threshold ${options.promotionThreshold}`,
      ]),
      risk: 'eager graph extraction can create stale aliases, weak edges, and unauditable memory; keep source pointers first and promote relations only after repeated retrieval value',
    });
  }
  return signals;
}

function buildProxyPointerRagGuardrailsPlan(rawOptions = {}, templatesPath) {
  const options = normalizeOptions(rawOptions);
  const templates = listGateTemplates(templatesPath)
    .filter((template) => template.category === DOCUMENT_RAG_CATEGORY);
  const signals = buildSignalSummary(options);
  const recommendedTemplates = templates.map((template) => ({
    ...template,
    recommended: gateApplicability(template, options),
  }));
  const activeTemplates = recommendedTemplates.filter((template) => template.recommended);

  return {
    name: 'thumbgate-proxy-pointer-rag-guardrails',
    status: activeTemplates.length > 0 ? 'actionable' : 'ready',
    ragTool: options.ragTool,
    treePath: options.treePath,
    summary: {
      signalCount: signals.length,
      templateCount: templates.length,
      recommendedTemplateCount: activeTemplates.length,
      candidateImages: options.candidateImages,
    },
    signals,
    templates: recommendedTemplates,
    nextActions: [
      'Preserve document hierarchy, section IDs, and image file paths during ingestion.',
      'Store source pointers before extracting entities or relations; promote a relation only after repeated retrieval value and source verification.',
      'Pass section-tree and image-pointer metadata into the agent before it answers with visuals.',
      'Enable the recommended Document RAG Safety templates as pre-action gates.',
      'Use a vision filter only for high-impact answers that make claims about visual content.',
    ],
    exampleCommand: 'npx thumbgate proxy-pointer-rag-guardrails --tree-path=.rag/tree.json --source-pointers=lesson/fb_123,tool/run_456 --extracted-entities=120 --extracted-relations=80 --pointer-first --json',
  };
}

function formatProxyPointerRagGuardrailsPlan(report) {
  const lines = [
    '',
    'ThumbGate Proxy-Pointer RAG Guardrails',
    '-'.repeat(42),
    `Status   : ${report.status}`,
    `RAG tool : ${report.ragTool}`,
  ];
  if (report.treePath) lines.push(`Tree path: ${report.treePath}`);
  lines.push(`Signals  : ${report.summary.signalCount}`);
  lines.push(`Templates: ${report.summary.recommendedTemplateCount}/${report.summary.templateCount} recommended`);

  if (report.signals.length > 0) {
    lines.push('', 'Detected document/RAG risk signals:');
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
    lines.push('  - No document/RAG signals were passed. Start with --tree-path, --image-pointers, --documents, or --visual-claims.');
  }

  lines.push('', 'Next actions:');
  for (const action of report.nextActions) lines.push(`  - ${action}`);
  lines.push('', `Example: ${report.exampleCommand}`, '');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  buildProxyPointerRagGuardrailsPlan,
  formatProxyPointerRagGuardrailsPlan,
  normalizeOptions,
};
