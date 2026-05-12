#!/usr/bin/env node
'use strict';

const { listGateTemplates } = require('./gate-templates');

const DOCUMENT_RAG_CATEGORY = 'Document RAG Safety';
const PRECISION_TEMPLATE_IDS = new Set([
  'require-rag-baseline-before-precision-tuning',
  'require-two-stage-rag-verifier-for-structural-near-misses',
  'checkpoint-rag-latency-precision-tradeoff',
]);

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
    ragTool: String(options['rag-tool'] || options.tool || 'agentic-rag').trim() || 'agentic-rag',
    baselineRecall: toNumber(options['baseline-recall'] || options.recall),
    newRecall: toNumber(options['new-recall']),
    baselinePrecision: toNumber(options['baseline-precision'] || options.precision),
    newPrecision: toNumber(options['new-precision']),
    topK: toNumber(options['top-k'] || options.k),
    thresholdChanged: normalizeBoolean(options['threshold-change'] || options['threshold-changed']),
    embeddingFineTune: normalizeBoolean(options['embedding-finetune'] || options['embedding-fine-tune'] || options['fine-tune']),
    structuralNearMisses: normalizeBoolean(options['structural-near-misses'] || options['near-misses']),
    verifier: normalizeBoolean(options.verifier || options.reranker || options['second-stage']),
    hybridRetrieval: normalizeBoolean(options['hybrid-retrieval'] || options.hybrid),
    denseRetrieval: normalizeBoolean(options.dense || options['dense-retrieval'] || options.embeddings),
    sparseRetrieval: normalizeBoolean(options.sparse || options['sparse-retrieval'] || options.keyword),
    reranker: normalizeBoolean(options.reranker || options.rerank),
    sourceGrounding: normalizeBoolean(options['source-grounding'] || options.grounding || options.citations),
    aclFilter: normalizeBoolean(options['acl-filter'] || options.acl || options['access-control']),
    freshnessWindowHours: toNumber(options['freshness-window-hours'] || options['freshness-hours']),
    scaleCorpusDocuments: toNumber(options['scale-corpus-documents'] || options['corpus-documents'] || options.documents),
    latencyMs: toNumber(options['latency-ms'] || options.latency),
    latencyBudgetMs: toNumber(options['latency-budget-ms'] || options['latency-budget']),
    agenticPipeline: normalizeBoolean(options.agentic || options['agentic-pipeline']),
  };
}

function recallDropPercent(options) {
  if (options.baselineRecall === null || options.newRecall === null || options.baselineRecall <= 0) return null;
  return Number((((options.baselineRecall - options.newRecall) / options.baselineRecall) * 100).toFixed(2));
}

function templateApplicability(template, options) {
  if (template.id === 'require-rag-baseline-before-precision-tuning') {
    return options.thresholdChanged ||
      options.embeddingFineTune ||
      options.baselineRecall === null ||
      options.newRecall === null ||
      (recallDropPercent(options) !== null && recallDropPercent(options) > 5);
  }
  if (template.id === 'require-two-stage-rag-verifier-for-structural-near-misses') {
    return options.structuralNearMisses || (options.agenticPipeline && !options.verifier);
  }
  if (template.id === 'checkpoint-rag-latency-precision-tradeoff') {
    return options.verifier ||
      (options.latencyMs !== null && options.latencyBudgetMs !== null && options.latencyMs > options.latencyBudgetMs);
  }
  return false;
}

function buildSignals(options) {
  const drop = recallDropPercent(options);
  return [
    precisionTuningSignal(options, drop),
    ragCascadeSignal(options),
    verifierLatencySignal(options),
    hybridScaleSignal(options),
    retrievalGovernanceSignal(options),
  ].filter(Boolean);
}

function precisionTuningSignal(options, drop) {
  if (!(options.thresholdChanged || options.embeddingFineTune || drop !== null)) return null;
  return {
    id: 'precision_tuning',
    label: 'Precision tuning change',
    values: [
      options.thresholdChanged ? 'threshold changed' : null,
      options.embeddingFineTune ? 'embedding fine-tune' : null,
      drop !== null ? `recall drop ${drop}%` : null,
    ].filter(Boolean),
    risk: 'precision wins can hide broad retrieval recall regressions',
  };
}

function ragCascadeSignal(options) {
  if (!(options.structuralNearMisses || options.agenticPipeline)) return null;
  return {
    id: 'agentic_rag_cascade',
    label: 'Agentic RAG cascade risk',
    values: [
      options.agenticPipeline ? 'agentic pipeline' : null,
      options.structuralNearMisses ? 'structural near misses' : null,
    ].filter(Boolean),
    risk: 'wrong retrieval can trigger downstream tool calls, not just wrong answers',
  };
}

function verifierLatencySignal(options) {
  if (!(options.verifier || options.latencyMs !== null || options.latencyBudgetMs !== null)) return null;
  return {
    id: 'verifier_latency',
    label: 'Verifier latency tradeoff',
    values: [
      options.verifier ? 'verifier enabled' : null,
      options.latencyMs !== null ? `${options.latencyMs}ms observed` : null,
      options.latencyBudgetMs !== null ? `${options.latencyBudgetMs}ms budget` : null,
    ].filter(Boolean),
    risk: 'second-stage verification needs a known latency budget',
  };
}

function hybridScaleSignal(options) {
  const hybridIntent = options.hybridRetrieval || (options.denseRetrieval && options.sparseRetrieval);
  const largeCorpus = options.scaleCorpusDocuments !== null && options.scaleCorpusDocuments >= 100000;
  if (!(hybridIntent || largeCorpus)) return null;
  const missingControls = [
    options.denseRetrieval ? null : 'dense recall unmeasured',
    options.sparseRetrieval ? null : 'sparse recall unmeasured',
    options.reranker ? null : 'missing reranker',
    options.sourceGrounding ? null : 'missing source grounding',
    options.aclFilter ? null : 'missing ACL filter',
  ].filter(Boolean);
  return {
    id: 'hybrid_retrieval_scale_wall',
    label: 'Hybrid retrieval scale wall',
    values: [
      options.hybridRetrieval ? 'hybrid retrieval' : null,
      options.denseRetrieval ? 'dense retrieval' : null,
      options.sparseRetrieval ? 'sparse retrieval' : null,
      options.scaleCorpusDocuments !== null ? `${options.scaleCorpusDocuments} documents` : null,
      ...missingControls,
    ].filter(Boolean),
    risk: 'scaled RAG needs dense, sparse, reranking, grounding, and access-control evidence instead of vector-only correctness',
  };
}

function retrievalGovernanceSignal(options) {
  if (!options.agenticPipeline && options.sourceGrounding && options.aclFilter) return null;
  if (!(options.agenticPipeline || options.hybridRetrieval || options.scaleCorpusDocuments !== null)) return null;
  const gaps = [
    options.sourceGrounding ? null : 'source evidence not enforced',
    options.aclFilter ? null : 'access control not enforced',
    options.freshnessWindowHours === null ? 'freshness window missing' : `${options.freshnessWindowHours}h freshness window`,
  ].filter(Boolean);
  if (gaps.length === 0) return null;
  return {
    id: 'retrieval_governance_gap',
    label: 'Retrieval governance gap',
    values: gaps,
    risk: 'agentic retrieval output can leak stale or unauthorized context into downstream actions',
  };
}

function buildRagPrecisionGuardrailsPlan(rawOptions = {}, templatesPath) {
  const options = normalizeOptions(rawOptions);
  const templates = listGateTemplates(templatesPath)
    .filter((template) => template.category === DOCUMENT_RAG_CATEGORY && PRECISION_TEMPLATE_IDS.has(template.id))
    .map((template) => ({
      ...template,
      recommended: templateApplicability(template, options),
    }));
  const signals = buildSignals(options);
  const recommendedTemplates = templates.filter((template) => template.recommended);

  return {
    name: 'thumbgate-rag-precision-guardrails',
    status: recommendedTemplates.length > 0 ? 'actionable' : 'ready',
    ragTool: options.ragTool,
    metrics: {
      topK: options.topK,
      baselineRecall: options.baselineRecall,
      newRecall: options.newRecall,
      recallDropPercent: recallDropPercent(options),
      baselinePrecision: options.baselinePrecision,
      newPrecision: options.newPrecision,
      hybridRetrieval: options.hybridRetrieval,
      denseRetrieval: options.denseRetrieval,
      sparseRetrieval: options.sparseRetrieval,
      reranker: options.reranker,
      sourceGrounding: options.sourceGrounding,
      aclFilter: options.aclFilter,
      freshnessWindowHours: options.freshnessWindowHours,
      scaleCorpusDocuments: options.scaleCorpusDocuments,
      latencyMs: options.latencyMs,
      latencyBudgetMs: options.latencyBudgetMs,
    },
    summary: {
      signalCount: signals.length,
      templateCount: templates.length,
      recommendedTemplateCount: recommendedTemplates.length,
    },
    signals,
    templates,
    nextActions: [
      'Save baseline recall@k, precision@k, answer-with-evidence, and latency before tuning retrieval.',
      'Block embedding or threshold changes when recall drops without an approved rollback plan.',
      'Use a second-stage verifier or reranker for structural near misses such as negation and role reversal.',
      'Attach verifier latency budgets before routing the retrieval output into autonomous agent actions.',
      'Measure dense recall, sparse recall, reranked relevance, source grounding, ACL filtering, and freshness as separate production gates.',
      'Treat the retrieval layer as the agent ground truth: every autonomous action should carry source evidence and access-control proof.',
    ],
    exampleCommand: 'npx thumbgate rag-precision-guardrails --hybrid-retrieval --dense --sparse --scale-corpus-documents=1000000 --agentic --json',
  };
}

function formatRagPrecisionGuardrailsPlan(report) {
  const lines = [
    '',
    'ThumbGate RAG Precision Guardrails',
    '-'.repeat(39),
    `Status   : ${report.status}`,
    `RAG tool : ${report.ragTool}`,
    `Signals  : ${report.summary.signalCount}`,
    `Templates: ${report.summary.recommendedTemplateCount}/${report.summary.templateCount} recommended`,
  ];
  if (report.metrics.recallDropPercent !== null) {
    lines.push(`Recall drop: ${report.metrics.recallDropPercent}%`);
  }

  if (report.signals.length > 0) {
    lines.push('', 'Detected retrieval risk signals:');
    for (const signal of report.signals) {
      lines.push(`  - ${signal.label}: ${signal.values.join(', ')}`);
      lines.push(`    Risk: ${signal.risk}`);
    }
  }

  lines.push('', 'Recommended templates:');
  const recommended = report.templates.filter((template) => template.recommended);
  if (recommended.length === 0) {
    lines.push('  - No precision-risk signals were passed. Start with recall metrics, threshold changes, or verifier flags.');
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
  buildRagPrecisionGuardrailsPlan,
  formatRagPrecisionGuardrailsPlan,
  normalizeOptions,
  recallDropPercent,
};
