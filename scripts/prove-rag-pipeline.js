#!/usr/bin/env node
'use strict';

/**
 * prove-rag-pipeline.js — exit 0 only when every RAG stage has:
 *   why / failure modes (contracts) + measured metrics (eval).
 */

const fs = require('fs');
const path = require('path');
const { STAGES, formatStageContractsMarkdown } = require('./rag-stage-contracts');
const { runRagEval } = require('./eval-rag');
const { ensureDir } = require('./fs-utils');

const ROOT = path.join(__dirname, '..');

function evaluateStageMetricValues(stageId, metrics = {}) {
  const failures = [];
  const requireTrue = (key) => {
    if (metrics[key] !== true && metrics[key] !== 1) failures.push(`${key} must be true`);
  };
  const requirePositive = (key) => {
    if (!(Number(metrics[key]) > 0)) failures.push(`${key} must be > 0`);
  };
  switch (stageId) {
    case 'documents':
      requirePositive('corpus_document_count');
      break;
    case 'parsing':
      requirePositive('parse_success_rate');
      requireTrue('parser_limits_enforced');
      break;
    case 'cleaning':
      requirePositive('clean_kept_rate');
      break;
    case 'chunking':
      requirePositive('chunk_count');
      requireTrue('stable_chunk_ids_enabled');
      break;
    case 'metadata_extraction':
      requirePositive('metadata_field_fill_rate');
      break;
    case 'embeddings':
      requirePositive('embedding_dim');
      if (!metrics.embedding_provider) failures.push('embedding_provider is required');
      break;
    case 'vector_database':
      requireTrue('vector_upsert_smoke_ok');
      requireTrue('vector_search_smoke_ok');
      break;
    case 'retrieval':
      if (Number(metrics.retrieval_recall_at_k) < 0.9) failures.push('retrieval_recall_at_k must be >= 0.9');
      if (Number(metrics.retrieval_mrr_at_10) < 0.75) failures.push('retrieval_mrr_at_10 must be >= 0.75');
      if (Number(metrics.retrieval_ndcg_at_10) < 0.8) failures.push('retrieval_ndcg_at_10 must be >= 0.8');
      break;
    case 'reranking':
      requireTrue('rerank_applied');
      break;
    case 'prompt_assembly':
      requireTrue('prompt_tokens_within_budget');
      requireTrue('prompt_injection_items_isolated');
      break;
    case 'llm':
      requireTrue('llm_allowlist_enforced');
      if (Number(metrics.llm_max_retries) > 2) failures.push('llm_max_retries must be <= 2');
      if (Number(metrics.structured_repair_attempt_limit) > 1) failures.push('structured repair attempts must be <= 1');
      break;
    case 'structured_output':
      if (Number(metrics.structured_final_valid_rate) !== 1) failures.push('structured_final_valid_rate must equal 1');
      requireTrue('citation_ids_subset_of_sources');
      break;
    default:
      break;
  }
  return failures;
}

function resolveProofDir(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.THUMBGATE_PROOF_DIR) return path.resolve(process.env.THUMBGATE_PROOF_DIR);
  return path.join(ROOT, 'proof');
}

async function proveRagPipeline(options = {}) {
  const PROOF_DIR = resolveProofDir(options.proofDir);
  const evalOut = await runRagEval({
    enableLlmJudge: false,
    thresholds: options.thresholds,
    reportPath: options.reportPath,
  });

  const checks = [];
  for (const stage of STAGES) {
    const status = (evalOut.stageStatus || []).find((s) => s.id === stage.id);
    const hasWhy = Boolean(stage.why && stage.why.length > 20);
    const hasFailureModes = Array.isArray(stage.canGoWrong) && stage.canGoWrong.length >= 2;
    const hasMeasures = Array.isArray(stage.measures) && stage.measures.length >= 2;
    const metricFailures = evaluateStageMetricValues(stage.id, evalOut.stageMetrics || {});
    const metricsOk = status && status.ok && metricFailures.length === 0;
    const pass = hasWhy && hasFailureModes && hasMeasures && metricsOk;
    checks.push({
      id: stage.id,
      name: stage.name,
      status: pass ? 'pass' : 'fail',
      hasWhy,
      hasFailureModes,
      hasMeasures,
      metricsOk: Boolean(metricsOk),
      metrics: status?.metrics || {},
      missingMetrics: status?.missingMetrics || stage.metricKeys,
      metricFailures,
    });
  }

  const retrievalPass = Boolean(evalOut.summary?.passed);
  checks.push({
    id: 'eval_thresholds',
    name: 'Ranked retrieval thresholds',
    status: retrievalPass ? 'pass' : 'fail',
    recallAt10: evalOut.summary?.recallAt10,
    precisionAt5: evalOut.summary?.precisionAt5,
    mrrAt10: evalOut.summary?.mrrAt10,
    ndcgAt10: evalOut.summary?.ndcgAt10,
    failures: evalOut.summary?.failures || [],
  });

  const failed = checks.filter((c) => c.status === 'fail');
  const report = {
    generatedAt: new Date().toISOString(),
    ok: failed.length === 0,
    failedCount: failed.length,
    checks,
    evalSummary: evalOut.summary,
    stageMetrics: evalOut.stageMetrics,
  };

  ensureDir(PROOF_DIR);
  const jsonPath = path.join(PROOF_DIR, 'rag-pipeline-report.json');
  const mdPath = path.join(PROOF_DIR, 'rag-pipeline-report.md');
  const contractsPath = path.join(PROOF_DIR, 'rag-stage-contracts.md');

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(contractsPath, formatStageContractsMarkdown());

  const md = [
    '# RAG pipeline proof',
    '',
    `**Generated:** ${report.generatedAt}`,
    `**Status:** ${report.ok ? 'PASS' : 'FAIL'} (${failed.length} failing checks)`,
    `**Recall@10:** ${((evalOut.summary?.recallAt10 || 0) * 100).toFixed(1)}%`,
    `**Precision@5:** ${((evalOut.summary?.precisionAt5 || 0) * 100).toFixed(1)}%`,
    `**MRR@10:** ${(evalOut.summary?.mrrAt10 || 0).toFixed(3)}`,
    `**nDCG@10:** ${(evalOut.summary?.ndcgAt10 || 0).toFixed(3)}`,
    '',
    '| Check | Status | Notes |',
    '|---|---|---|',
    ...checks.map((c) => {
      const notes = c.failures?.length
        ? c.failures.join('; ')
        : (c.metricFailures?.length
          ? c.metricFailures.join('; ')
        : (c.missingMetrics?.length
          ? `missing: ${c.missingMetrics.join(', ')}`
          : (c.recallAt10 != null
            ? `R@10=${c.recallAt10} P@5=${c.precisionAt5} MRR@10=${c.mrrAt10} nDCG@10=${c.ndcgAt10}`
            : 'contracts + metrics')));
      return `| ${c.name} | ${c.status} | ${notes} |`;
    }),
    '',
    'Stage contracts (why / failure modes / measures): `proof/rag-stage-contracts.md`.',
    'Operator guide: `docs/RAG_PIPELINE.md`.',
    '',
  ].join('\n');
  fs.writeFileSync(mdPath, md);

  console.log(md);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);

  return report;
}

function isMain() {
  const entry = process.argv[1] && path.resolve(process.argv[1]);
  return entry === path.resolve(__filename);
}

if (isMain()) {
  proveRagPipeline()
    .then((report) => {
      process.exitCode = report.ok ? 0 : 1;
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { evaluateStageMetricValues, proveRagPipeline };
