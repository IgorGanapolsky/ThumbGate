#!/usr/bin/env node
'use strict';

/**
 * prove-rag-pipeline.js — exit 0 only when every RAG stage has:
 *   why / failure modes (contracts) + measured metrics (eval).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { STAGES, formatStageContractsMarkdown } = require('./rag-stage-contracts');
const { runRagEval } = require('./eval-rag');
const { ensureDir } = require('./fs-utils');

const ROOT = path.join(__dirname, '..');
const DEFAULT_RELIABILITY_SEED = 'thumbgate-rag-reliability-v1';

function normalizeReliabilitySeed(value) {
  const normalized = String(value || DEFAULT_RELIABILITY_SEED)
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, '-')
    .slice(0, 80);
  return normalized || DEFAULT_RELIABILITY_SEED;
}

function seededRandom(seed) {
  let state = 0x811c9dc5;
  for (const byte of Buffer.from(String(seed), 'utf8')) {
    state ^= byte;
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicShuffle(values, seed) {
  const output = [...values];
  const random = seededRandom(seed);
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

function property(id, pass, observation, kind = 'always') {
  return {
    id,
    kind,
    pass: Boolean(pass),
    observation,
  };
}

async function simulateReindexInterruption(seed) {
  const { importDocument } = require('./document-intake');
  const { reindexRag, resolveReindexPaths } = require('./reindex-rag');
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-rag-sim-reindex-'));
  const attempts = [];
  const random = seededRandom(`${seed}:reindex`);
  const failurePosition = 2 + Math.floor(random() * 2);
  let faultArmed = true;
  let faultedDocumentId = null;

  try {
    const documents = ['alpha', 'beta', 'gamma'].map((suffix) => importDocument({
      feedbackDir,
      title: `Reliability checkpoint ${suffix}`,
      sourceUrl: `https://example.invalid/reliability/${suffix}`,
      content: `# Checkpoint ${suffix}\n\nPreserve completed work across a seeded interruption.`,
      sourceFormat: 'markdown',
      proposeGates: false,
    }));
    const dependencies = {
      indexDocument: async (document) => {
        attempts.push(document.documentId);
        if (faultArmed && attempts.length === failurePosition) {
          faultedDocumentId = document.documentId;
          faultArmed = false;
          throw new Error('seeded_embedding_outage');
        }
        return {
          embeddedCount: document.chunks.length,
          reusedCount: 0,
        };
      },
      retireDocument: async () => ({ retired: false }),
      getRagIndexStatus: async () => ({
        schemaVersion: 2,
        tables: ['thumbgate_rag_v2_reliability_384'],
      }),
    };

    const interrupted = await reindexRag({ feedbackDir }, dependencies);
    const completedBeforeReplay = new Set(interrupted.completedDocumentIds);
    const replayed = await reindexRag({ feedbackDir }, dependencies);
    const attemptCounts = new Map();
    for (const documentId of attempts) {
      attemptCounts.set(documentId, (attemptCounts.get(documentId) || 0) + 1);
    }
    const completedRepeated = [...completedBeforeReplay]
      .filter((documentId) => attemptCounts.get(documentId) !== 1);
    const paths = resolveReindexPaths({ feedbackDir });
    const properties = [
      property('fault_is_observable', interrupted.status === 'partial_failure', interrupted.status, 'reachable'),
      property('replay_completes', replayed.status === 'complete', replayed.status),
      property(
        'completed_embeddings_are_not_repeated',
        completedRepeated.length === 0,
        { completedBeforeReplay: completedBeforeReplay.size, repeated: completedRepeated.length },
      ),
      property(
        'failed_document_is_retried_once',
        Boolean(faultedDocumentId) && attemptCounts.get(faultedDocumentId) === 2,
        attemptCounts.get(faultedDocumentId) || 0,
      ),
      property(
        'catalog_and_index_reconcile',
        replayed.reconciliation?.documentCountMatches === true
          && replayed.completedDocumentIds.length === documents.length,
        replayed.reconciliation?.completedDocuments || 0,
      ),
      property('lock_is_released', fs.existsSync(paths.lockPath) === false, fs.existsSync(paths.lockPath)),
    ];
    return {
      id: 'reindex_interruption_resume',
      fault: 'embedding outage at a seed-selected document boundary',
      failurePosition,
      properties,
    };
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
}

async function simulateVectorOutage(seed) {
  const { searchThumbgateAsync } = require('./thumbgate-search');
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-rag-sim-vector-'));
  try {
    fs.writeFileSync(path.join(feedbackDir, 'feedback-log.jsonl'), `${JSON.stringify({
      id: `fb_reliability_${normalizeReliabilitySeed(seed).slice(0, 16)}`,
      signal: 'negative',
      context: 'A release claim requires a verified production receipt.',
      whatToChange: 'Keep lexical retrieval available when the vector index is unavailable.',
      tags: ['reliability', 'release'],
      timestamp: '2026-07-29T00:00:00.000Z',
    })}\n`);
    const result = await searchThumbgateAsync({
      query: 'release production receipt',
      source: 'feedback',
      limit: 3,
      feedbackDir,
      searchRag: async () => {
        throw new RangeError('seeded_vector_outage');
      },
    });
    return {
      id: 'vector_outage_lexical_fallback',
      fault: 'vector search throws before fusion',
      properties: [
        property('query_returns_lexical_evidence', result.returned > 0, result.returned),
        property('fallback_is_explicit', result.retrieval.vectorFallback === 'RangeError', result.retrieval.vectorFallback, 'reachable'),
        property('retrieval_remains_bounded', result.returned <= 3, result.returned),
        property('scope_remains_local', result.results.every((row) => row.scope?.tenantId === 'local'), result.scope),
      ],
    };
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
}

async function simulateInvalidStructuredOutput() {
  const { answerDataQuestion } = require('./dashboard-chat');
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-rag-sim-structured-'));
  let providerCalls = 0;
  try {
    const result = await answerDataQuestion('What production evidence exists?', {
      apiKey: 'reliability-test-key',
      feedbackDir,
      fetch: async () => {
        providerCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: 'invalid structured output' }] } }],
          }),
        };
      },
    });
    return {
      id: 'invalid_structured_output_fail_closed',
      fault: 'provider returns invalid JSON twice',
      properties: [
        property('invalid_output_is_rejected', result.ok === false, result.ok),
        property('failure_is_typed', result.error === 'invalid_structured_output', result.error, 'reachable'),
        property('repair_is_bounded_to_one', providerCalls === 2 && result.providerCalls === 2, providerCalls),
        property('repair_failure_is_explicit', result.structuredRepairSucceeded === false, result.structuredRepairSucceeded),
      ],
    };
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
}

function summarizeReliabilityScenarios(seed, scenarios) {
  const normalized = scenarios.map((scenario) => {
    const failedProperties = scenario.properties.filter((entry) => entry.pass !== true);
    return {
      ...scenario,
      status: failedProperties.length === 0 ? 'pass' : 'fail',
      failedProperties: failedProperties.map((entry) => entry.id),
    };
  });
  const failed = normalized.filter((scenario) => scenario.status === 'fail');
  const properties = normalized.flatMap((scenario) => scenario.properties);
  const reachable = properties.filter((entry) => entry.kind === 'reachable');
  const reached = reachable.filter((entry) => entry.pass === true);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    seed,
    ok: failed.length === 0,
    scenarioCount: normalized.length,
    passedCount: normalized.length - failed.length,
    failedCount: failed.length,
    propertyCount: properties.length,
    passedPropertyCount: properties.filter((entry) => entry.pass === true).length,
    reachablePropertyCount: reachable.length,
    reachedPropertyCount: reached.length,
    reachabilityRate: reachable.length ? reached.length / reachable.length : null,
    scenarioOrder: normalized.map((scenario) => scenario.id),
    replayCommand: `npm run prove:rag -- --reliability-seed ${seed}`,
    scenarios: normalized,
  };
}

async function runRagReliabilitySimulation(options = {}) {
  const seed = normalizeReliabilitySeed(options.seed);
  const registry = [
    { id: 'reindex_interruption_resume', run: () => simulateReindexInterruption(seed) },
    { id: 'vector_outage_lexical_fallback', run: () => simulateVectorOutage(seed) },
    { id: 'invalid_structured_output_fail_closed', run: simulateInvalidStructuredOutput },
  ];
  const ordered = deterministicShuffle(registry, `${seed}:scenario-order`);
  const scenarios = [];
  for (const scenario of ordered) {
    try {
      scenarios.push(await scenario.run());
    } catch (error) {
      scenarios.push({
        id: scenario.id,
        fault: 'scenario execution failure',
        properties: [
          property('scenario_completes', false, error && error.name || 'Error'),
        ],
      });
    }
  }
  const report = summarizeReliabilityScenarios(seed, scenarios);
  if (options.proofDir) {
    ensureDir(options.proofDir);
    fs.writeFileSync(
      path.join(options.proofDir, 'rag-reliability-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  return report;
}

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
  const reliability = await runRagReliabilitySimulation({
    seed: options.reliabilitySeed,
    proofDir: PROOF_DIR,
  });
  checks.push({
    id: 'deterministic_reliability',
    name: 'Seeded failure invariants',
    status: reliability.ok ? 'pass' : 'fail',
    seed: reliability.seed,
    scenarioCount: reliability.scenarioCount,
    failures: reliability.scenarios
      .filter((scenario) => scenario.status === 'fail')
      .map((scenario) => `${scenario.id}: ${scenario.failedProperties.join(', ')}`),
    replayCommand: reliability.replayCommand,
  });

  const failed = checks.filter((c) => c.status === 'fail');
  const report = {
    generatedAt: new Date().toISOString(),
    ok: failed.length === 0,
    failedCount: failed.length,
    checks,
    evalSummary: evalOut.summary,
    stageMetrics: evalOut.stageMetrics,
    reliability,
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
  const seedIndex = process.argv.indexOf('--reliability-seed');
  const inlineSeed = process.argv.find((argument) => argument.startsWith('--reliability-seed='));
  const reliabilitySeed = inlineSeed
    ? inlineSeed.slice('--reliability-seed='.length)
    : (seedIndex >= 0 ? process.argv[seedIndex + 1] : undefined);
  proveRagPipeline({ reliabilitySeed })
    .then((report) => {
      process.exitCode = report.ok ? 0 : 1;
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = {
  DEFAULT_RELIABILITY_SEED,
  deterministicShuffle,
  evaluateStageMetricValues,
  normalizeReliabilitySeed,
  proveRagPipeline,
  runRagReliabilitySimulation,
  seededRandom,
  summarizeReliabilityScenarios,
};
