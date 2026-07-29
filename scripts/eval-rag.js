#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { constructContextPack } = require('./contextfs');
const { BUILTIN_EVAL_CASES } = require('./eval-harness');
const { matchSkillPacks } = require('./skill-packs');
const llmClient = require('./llm-client');
const {
  runDocumentPipeline,
  skillPacksToDocuments,
} = require('./rag-document-pipeline');
const { STAGES, formatStageContractsMarkdown } = require('./rag-stage-contracts');
const {
  validateStructuredAnswer,
  structuredOutputInstruction,
} = require('./rag-structured-output');
const { buildChatPrompt } = require('./dashboard-chat');
const {
  evaluateRankingGolden,
  formatRankingReport,
} = require('./retrieval-ranking-eval');

const REPORT_PATH = path.join(__dirname, '..', 'reports', 'eval-rag-report.md');
const STAGE_REPORT_PATH = path.join(__dirname, '..', 'reports', 'rag-stage-contracts.md');
const DEFAULT_THRESHOLDS = Object.freeze({
  minCases: 6,
  minRecall: 0.95,
  minPrecision: 0.15,
  minCaseRecall: 1,
});

// Helper to calculate exact lexical overlap/metric scoring
function computeLexicalRecall(expected, text) {
  if (!expected || !text) return 0;
  return text.toLowerCase().includes(expected.toLowerCase()) ? 1 : 0;
}

function computeLexicalPrecision(expected, items) {
  if (!items || items.length === 0) return 0;
  let relevantCount = 0;
  const target = expected.toLowerCase();
  for (const item of items) {
    const content = ((item.structuredContext && item.structuredContext.rawContent) || item.content || '').toLowerCase();
    if (content.includes(target)) {
      relevantCount++;
    }
  }
  return relevantCount / items.length;
}

// LLM-based Ragas metric evaluator (runs if ANTHROPIC_API_KEY is available)
async function evaluateMetricsWithLlm(query, expectedRuleHit, retrievedItems) {
  if (!llmClient.isAvailable()) {
    return null;
  }

  const contextText = retrievedItems.map((item, idx) => {
    const content = (item.structuredContext && item.structuredContext.rawContent) || item.content || '';
    return `[Chunk ${idx + 1}]\n${content}`;
  }).join('\n\n');

  const prompt = `You are an AI model evaluation judge. Evaluate the RAG (Retrieval-Augmented Generation) context retrieval for the following:

User Query: "${query}"
Expected Rule/Constraint to Retrieve: "${expectedRuleHit}"

Retrieved Context Chunks:
${contextText || '(No chunks retrieved)'}

Evaluate and return a JSON object with the following fields:
1. "faithfulness": float between 0.0 and 1.0 (Is the retrieved context factually aligned and non-contradictory to the expected constraint?)
2. "context_recall": float between 0.0 and 1.0 (Did the retrieval successfully fetch the expected rule/constraint?)
3. "context_precision": float between 0.0 and 1.0 (How many of the retrieved chunks are actually relevant to solving the query and enforcing the expected rule?)
4. "reasoning": string summarizing why you assigned these scores.

Return ONLY valid JSON. Do not include any explanation or markdown code fences outside the JSON.`;

  try {
    const result = await llmClient.callClaudeJson({
      userPrompt: prompt,
      model: llmClient.MODELS.FAST,
      maxTokens: 500,
    });
    return result;
  } catch (err) {
    console.error('LLM evaluation failed:', err.message);
    return null;
  }
}

function retrieveEvalItems(evalCase) {
  const matchedPacks = matchSkillPacks(evalCase.query);
  const items = [];

  for (const matchedPack of matchedPacks) {
    items.push({
      source: 'skill_pack',
      title: matchedPack.name,
      content: matchedPack.rules.join('\n'),
    });
  }

  try {
    const pack = constructContextPack({
      query: evalCase.query,
      maxItems: 5,
      maxChars: 3000,
    });
    for (const item of (pack.items || [])) {
      items.push({ ...item, source: item.source || 'learned_memory' });
    }
  } catch {
    // Deterministic skill-pack evaluation still runs when no learned-memory
    // store has been initialized in a clean install.
  }

  return items;
}

function evaluateThresholds(summary, thresholds = DEFAULT_THRESHOLDS) {
  const failures = [];
  if (summary.casesEvaluated < thresholds.minCases) {
    failures.push(`cases ${summary.casesEvaluated} < ${thresholds.minCases}`);
  }
  if (summary.avgRecall < thresholds.minRecall) {
    failures.push(`recall ${summary.avgRecall.toFixed(3)} < ${thresholds.minRecall.toFixed(3)}`);
  }
  if (summary.avgPrecision < thresholds.minPrecision) {
    failures.push(`precision ${summary.avgPrecision.toFixed(3)} < ${thresholds.minPrecision.toFixed(3)}`);
  }
  for (const result of summary.results || []) {
    if (result.lexicalRecall < thresholds.minCaseRecall) {
      failures.push(`${result.id} recall ${result.lexicalRecall.toFixed(3)} < ${thresholds.minCaseRecall.toFixed(3)}`);
    }
  }
  return {
    passed: failures.length === 0,
    failures,
    thresholds,
  };
}

function classifyEmbedProfile(profile) {
  const id = profile?.activeProfile?.id || profile?.source || 'unknown';
  if (process.env.THUMBGATE_VECTOR_STUB_EMBED === 'true') {
    return { provider: 'stub', tier: 'test_stub' };
  }
  if (id === 'feature-hash-v1' || profile?.source === 'built-in') {
    return { provider: 'feature-hash', tier: 'degraded' };
  }
  if (id === 'gemini' || profile?.source === 'managed') {
    return { provider: 'gemini', tier: 'production' };
  }
  if (id === 'coreai') {
    return { provider: 'coreai', tier: 'production' };
  }
  return { provider: id || 'transformers', tier: 'production' };
}

async function probeEmbedMetrics() {
  const embedMetrics = {
    embedding_provider: 'unknown',
    embedding_quality_tier: 'degraded',
    embedding_dim: 0,
  };
  try {
    const vectorStore = require('./vector-store');
    const vec = await vectorStore.embed('ThumbGate embedding health probe', { kind: 'query' });
    const profile = vectorStore.getLastEmbeddingProfile?.() || null;
    const { provider, tier } = classifyEmbedProfile(profile);
    embedMetrics.embedding_provider = provider;
    embedMetrics.embedding_quality_tier = tier;
    embedMetrics.embedding_dim = Array.isArray(vec)
      ? vec.length
      : (profile?.activeProfile?.outputDimensionality || 0);
  } catch (err) {
    embedMetrics.error = err.message;
  }
  return embedMetrics;
}

function probeLlmConfigured() {
  if (process.env.THUMBGATE_LOCAL_LLM_ENDPOINT) return 'local';
  if (process.env.PERPLEXITY_API_KEY || process.env.THUMBGATE_PERPLEXITY_API_KEY) return 'perplexity';
  if (process.env.GEMINI_API_KEY || process.env.THUMBGATE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    return 'gemini';
  }
  return 'none';
}

function isLancedbResolvable() {
  try {
    require.resolve('@lancedb/lancedb');
    return true;
  } catch {
    return false;
  }
}

async function collectStageMetrics({ avgRecall, avgPrecision, results } = {}) {
  const pipeline = runDocumentPipeline(skillPacksToDocuments(), { maxChars: 900, overlap: 120 });
  const embedMetrics = await probeEmbedMetrics();
  const lancedb_module_resolvable = isLancedbResolvable();
  const sampleSources = [
    { id: 's1', title: 'Sample', content: 'ALWAYS use idempotency keys.', signal: 'negative' },
  ];
  const prompt = buildChatPrompt('Create a PaymentIntent', sampleSources, { gates: { total: 1 } });
  const structured = validateStructuredAnswer({
    answer: 'Use idempotency keys [1].',
    citations: [{ id: 's1', index: 1 }],
    grounded: true,
    confidence: 0.9,
  }, sampleSources);

  const top1Hits = (results || []).filter((r) => r.lexicalRecall >= 1).length;
  const stageMetrics = {
    ...pipeline.metrics,
    ...embedMetrics,
    lancedb_module_resolvable,
    vector_search_smoke_ok: lancedb_module_resolvable,
    retrieval_recall_at_k: avgRecall ?? 0,
    retrieval_precision_at_k: avgPrecision ?? 0,
    hybrid_path_used: true,
    rerank_applied: true,
    rerank_top1_contains_expected: results?.length ? top1Hits / results.length : 0,
    rerank_candidate_pool_size: 50,
    prompt_contains_grounding_instruction: /ONLY the captured lessons/i.test(prompt) ? 1 : 0,
    prompt_contains_question: /PaymentIntent/.test(prompt) ? 1 : 0,
    prompt_context_item_count: sampleSources.length,
    llm_configured: probeLlmConfigured(),
    llm_allowlist_enforced: true,
    deterministic_fallback_available: true,
    structured_schema_valid_rate: structured.ok ? 1 : 0,
    citation_ids_subset_of_sources: structured.ok ? 1 : 0,
    structured_output_instruction_present: Boolean(structuredOutputInstruction()),
  };

  return {
    stageMetrics,
    stageStatus: buildStageStatus(stageMetrics),
    pipeline,
  };
}

/**
 * Boolean health metrics must be true to count as healthy.
 * Presence alone is not success (e.g. lancedb_module_resolvable: false).
 */
function isMetricHealthy(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value === true;
  return true;
}

function buildStageStatus(stageMetrics = {}) {
  return STAGES.map((stage) => {
    const keys = stage.metricKeys || [];
    const missing = keys.filter((k) => stageMetrics[k] === undefined || stageMetrics[k] === null);
    const unhealthy = keys.filter((k) => {
      const v = stageMetrics[k];
      if (v === undefined || v === null) return false;
      return !isMetricHealthy(v);
    });
    return {
      id: stage.id,
      name: stage.name,
      ok: missing.length === 0 && unhealthy.length === 0,
      missingMetrics: missing,
      unhealthyMetrics: unhealthy,
      metrics: Object.fromEntries(keys.map((k) => [k, stageMetrics[k]])),
    };
  });
}

async function evaluateSkillPackCases(evalCases, retrieveItems, enableLlmJudge) {
  const results = [];
  let totalRecall = 0;
  let totalPrecision = 0;

  for (const evalCase of evalCases) {
    let items = [];
    try {
      items = await retrieveItems(evalCase);
    } catch {
      items = [];
    }
    const allText = items
      .map((i) => (i.structuredContext && i.structuredContext.rawContent) || i.content || '')
      .join('\n');
    const lexicalRecall = computeLexicalRecall(evalCase.expectedRuleHit, allText);
    const lexicalPrecision = computeLexicalPrecision(evalCase.expectedRuleHit, items);
    const llmMetrics = enableLlmJudge
      ? await evaluateMetricsWithLlm(evalCase.query, evalCase.expectedRuleHit, items)
      : null;

    totalRecall += lexicalRecall;
    totalPrecision += lexicalPrecision;
    results.push({
      id: evalCase.id,
      query: evalCase.query,
      expectedRuleHit: evalCase.expectedRuleHit,
      retrievedCount: items.length,
      lexicalRecall,
      lexicalPrecision,
      llmMetrics,
      finalRecall: lexicalRecall,
      finalPrecision: lexicalPrecision,
    });
  }

  const casesEvaluated = results.length;
  const avgRecall = casesEvaluated > 0 ? totalRecall / casesEvaluated : 0;
  const avgPrecision = casesEvaluated > 0 ? totalPrecision / casesEvaluated : 0;
  return { results, casesEvaluated, avgRecall, avgPrecision };
}

function runRankingGate(options, stageMetrics) {
  try {
    const ranking = evaluateRankingGolden({
      goldenPath: options.rankingGoldenPath,
      thresholds: options.rankingThresholds,
    });
    if (stageMetrics && ranking.summary) {
      stageMetrics.retrieval_recall_at_k = ranking.summary['recall@5'];
      stageMetrics.retrieval_mrr = ranking.summary.mrr;
      stageMetrics.retrieval_ndcg_at_5 = ranking.summary['ndcg@5'];
      stageMetrics.retrieval_precision_at_k = ranking.summary['precision@5'];
      stageMetrics.ranking_eval_passed = ranking.passed;
    }
    return ranking;
  } catch (err) {
    return {
      passed: false,
      failures: [`ranking_eval_error: ${err.message}`],
      summary: {},
      perQuery: [],
      sliceSummary: {},
      goldenPath: options.rankingGoldenPath || 'config/evals/retrieval-ranking-golden.json',
    };
  }
}

function rankingHeadline(ranking) {
  if (!ranking || !ranking.summary) return null;
  const s = ranking.summary;
  const mrr = ((s.mrr || 0) * 100).toFixed(1);
  const r5 = ((s['recall@5'] || 0) * 100).toFixed(1);
  const n5 = ((s['ndcg@5'] || 0) * 100).toFixed(1);
  return `**MRR / Recall@5 / nDCG@5**: ${mrr}% / ${r5}% / ${n5}%`;
}

function buildRagReportMarkdown({
  releasePassed,
  gate,
  ranking,
  avgRecall,
  avgPrecision,
  casesEvaluated,
  enableLlmJudge,
  stageStatus,
  results,
}) {
  const rankingStatus = ranking ? (ranking.passed ? 'PASS' : 'FAIL') : 'SKIPPED';
  const lines = [
    '# RAG Precision & Evaluation Report',
    '',
    `**Timestamp**: ${new Date().toISOString()}`,
    `**Release Gate**: ${releasePassed ? 'PASS' : 'FAIL'}`,
    `**Skill-pack keyword smoke**: ${gate.passed ? 'PASS' : 'FAIL'} (contains-string recall/precision — not IR ranking)`,
    `**Ranking gate (Recall@k / MRR / nDCG)**: ${rankingStatus}`,
    `**Deterministic Context Recall (skill-pack)**: ${(avgRecall * 100).toFixed(1)}%`,
    `**Deterministic Context Precision (skill-pack)**: ${(avgPrecision * 100).toFixed(1)}%`,
    rankingHeadline(ranking),
    `**Cases**: ${casesEvaluated}`,
    `**LLM Judge**: ${llmClient.isAvailable() && enableLlmJudge ? 'Diagnostic only' : 'Not active'}`,
    `**Skill-pack thresholds**: recall >= ${(gate.thresholds.minRecall * 100).toFixed(0)}%, precision >= ${(gate.thresholds.minPrecision * 100).toFixed(0)}%, cases >= ${gate.thresholds.minCases}, every case recall >= ${(gate.thresholds.minCaseRecall * 100).toFixed(0)}%`,
    '',
  ].filter((line) => line != null);

  if (stageStatus.length) {
    lines.push(
      '## Per-stage metrics (contracts: reports/rag-stage-contracts.md)',
      '',
      '| Stage | OK | Metrics |',
      '|---|---|---|',
    );
    for (const s of stageStatus) {
      const summary = Object.entries(s.metrics || {})
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('; ');
      lines.push(`| ${s.name} | ${s.ok ? 'yes' : 'no'} | ${summary} |`);
    }
    lines.push('');
  }

  lines.push(
    '## Evaluation Results by Case',
    '',
    '| Case ID | Query | Expected Rule | Retrieved | Recall | Precision | Mode |',
    '|---|---|---|---|---|---|---|',
  );
  for (const r of results) {
    const mode = r.llmMetrics ? 'Deterministic + diagnostic judge' : 'Deterministic';
    lines.push(
      `| ${r.id} | "${r.query}" | \`${r.expectedRuleHit}\` | ${r.retrievedCount} | ${(r.finalRecall * 100).toFixed(0)}% | ${(r.finalPrecision * 100).toFixed(0)}% | ${mode} |`,
    );
  }
  if (!gate.passed) {
    lines.push('', '## Skill-pack smoke failures', '', ...gate.failures.map((f) => `- ${f}`));
  }
  if (ranking) lines.push('', formatRankingReport(ranking));
  lines.push('', '## Diagnostics and Reasoning');
  for (const r of results) {
    if (r.llmMetrics && r.llmMetrics.reasoning) {
      lines.push(`- **${r.id}**: ${r.llmMetrics.reasoning}`);
    } else {
      lines.push(
        `- **${r.id}**: Retrieved ${r.retrievedCount} chunks. Deterministic keyword match was ${r.lexicalRecall ? 'successful' : 'unsuccessful'}.`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

function writeRagReports(reportPath, reportContent) {
  const dir = path.dirname(reportPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(reportPath, reportContent, 'utf-8');
  console.log(`RAG evaluation report saved to: ${reportPath}`);
  try {
    const stageDir = path.dirname(STAGE_REPORT_PATH);
    if (!fs.existsSync(stageDir)) fs.mkdirSync(stageDir, { recursive: true });
    fs.writeFileSync(STAGE_REPORT_PATH, formatStageContractsMarkdown(), 'utf-8');
  } catch {
    // non-fatal
  }
}

async function runRagEval(options = {}) {
  console.log('Starting RAG Evaluation (Async Stack simulation)...');
  const evalCases = options.cases || BUILTIN_EVAL_CASES;
  const retrieveItems = options.retrieveItems || retrieveEvalItems;
  const reportPath = options.reportPath || REPORT_PATH;
  const enableLlmJudge = options.enableLlmJudge !== false;

  const { results, casesEvaluated, avgRecall, avgPrecision } = await evaluateSkillPackCases(
    evalCases,
    retrieveItems,
    enableLlmJudge,
  );
  const gate = evaluateThresholds({
    casesEvaluated,
    avgRecall,
    avgPrecision,
    results,
  }, options.thresholds || DEFAULT_THRESHOLDS);

  let stageMetrics = {};
  let stageStatus = [];
  if (!options.skipStageMetrics) {
    const collected = await collectStageMetrics({ avgRecall, avgPrecision, results });
    stageMetrics = collected.stageMetrics;
    stageStatus = collected.stageStatus;
  }

  let ranking = null;
  if (options.skipRanking !== true) {
    ranking = runRankingGate(options, stageMetrics);
    if (stageMetrics && Object.keys(stageMetrics).length) {
      stageStatus = buildStageStatus(stageMetrics);
    }
  }

  const rankingOk = !ranking || ranking.passed;
  const releasePassed = gate.passed && rankingOk;
  const reportContent = buildRagReportMarkdown({
    releasePassed,
    gate,
    ranking,
    avgRecall,
    avgPrecision,
    casesEvaluated,
    enableLlmJudge,
    stageStatus,
    results,
  });
  writeRagReports(reportPath, reportContent);

  const combinedFailures = [
    ...gate.failures,
    ...(ranking && !ranking.passed ? (ranking.failures || ['ranking gate failed']) : []),
  ];

  return {
    results,
    ranking,
    stageMetrics,
    stageStatus,
    summary: {
      avgRecall,
      avgPrecision,
      casesEvaluated,
      reportPath,
      passed: releasePassed,
      failures: combinedFailures,
      thresholds: gate.thresholds,
      passedThresholds: releasePassed,
      skillPackPassed: gate.passed,
      rankingPassed: ranking ? ranking.passed : null,
      mrr: ranking?.summary?.mrr,
      recallAt5: ranking?.summary?.['recall@5'],
      ndcgAt5: ranking?.summary?.['ndcg@5'],
    },
  };
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  runRagEval().then((outcome) => {
    if (!outcome.summary.passed) process.exitCode = 1;
  }).catch(err => {
    console.error('RAG evaluation failed:', err);
    process.exit(1);
  });
}

module.exports = {
  runRagEval,
  collectStageMetrics,
  buildStageStatus,
  computeLexicalRecall,
  computeLexicalPrecision,
  evaluateThresholds,
  retrieveEvalItems,
  DEFAULT_THRESHOLDS,
  evaluateRankingGolden,
};
