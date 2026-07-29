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
    const metricsOk = status && status.ok;
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
    });
  }

  const retrievalPass = Boolean(evalOut.summary?.passed);
  checks.push({
    id: 'eval_thresholds',
    name: 'Eval skill-pack + ranking gates',
    status: retrievalPass ? 'pass' : 'fail',
    avgRecall: evalOut.summary?.avgRecall,
    avgPrecision: evalOut.summary?.avgPrecision,
    mrr: evalOut.summary?.mrr,
    recallAt5: evalOut.summary?.recallAt5,
    ndcgAt5: evalOut.summary?.ndcgAt5,
    failures: evalOut.summary?.failures || [],
  });

  const ranking = evalOut.ranking;
  if (ranking) {
    checks.push({
      id: 'ranking_ir_metrics',
      name: 'IR ranking (Recall@k / MRR / nDCG)',
      status: ranking.passed ? 'pass' : 'fail',
      mrr: ranking.summary?.mrr,
      recallAt5: ranking.summary?.['recall@5'],
      ndcgAt5: ranking.summary?.['ndcg@5'],
      failures: ranking.failures || [],
    });
  } else {
    checks.push({
      id: 'ranking_ir_metrics',
      name: 'IR ranking (Recall@k / MRR / nDCG)',
      status: 'fail',
      failures: ['ranking eval missing from runRagEval output'],
    });
  }

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
    `**Eval recall:** ${((evalOut.summary?.avgRecall || 0) * 100).toFixed(1)}%`,
    `**Eval precision:** ${((evalOut.summary?.avgPrecision || 0) * 100).toFixed(1)}%`,
    '',
    '| Check | Status | Notes |',
    '|---|---|---|',
    ...checks.map((c) => {
      const notes = c.failures?.length
        ? c.failures.join('; ')
        : (c.missingMetrics?.length
          ? `missing: ${c.missingMetrics.join(', ')}`
          : (c.avgRecall != null ? `recall=${c.avgRecall} precision=${c.avgPrecision}` : 'contracts + metrics'));
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

module.exports = { proveRagPipeline };
