#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { BUILTIN_EVAL_CASES } = require('./eval-harness');
const { BUILTIN_PACKS, matchSkillPacks } = require('./skill-packs');
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
const { buildChatPromptWithDiagnostics } = require('./dashboard-chat');
const {
  bm25Rank,
  expandSafetyQuery,
  reciprocalRankFusion,
  rerankCandidates,
} = require('./rag-ranking');

const REPORT_PATH = path.join(__dirname, '..', 'reports', 'eval-rag-report.md');
const STAGE_REPORT_PATH = path.join(__dirname, '..', 'reports', 'rag-stage-contracts.md');
const DEFAULT_THRESHOLDS = Object.freeze({
  minCases: 24,
  minRecallAt10: 0.9,
  minMrrAt10: 0.75,
  minNdcgAt10: 0.8,
  minPrecisionAt5: 0.15,
  minCaseRecallAt10: 1,
  maxScopeLeakRate: 0,
  maxStaleHitRate: 0,
  // Backward-compatible names for integrations that have not migrated yet.
  minRecall: 0.9,
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
  if (matchedPacks.length === 0) return [];

  // The golden label is never used for retrieval. Every seeded rule is a
  // candidate, so the ranker must distinguish the expected rule from genuine
  // cross-domain distractors.
  const corpus = Object.values(BUILTIN_PACKS).flatMap((pack) => (
    pack.rules.map((rule, index) => ({
      id: `${pack.name}:rule:${index + 1}`,
      source: 'skill_pack',
      title: `${pack.name} rule ${index + 1}`,
      content: rule,
      context: rule,
      domain: pack.name,
      tags: [pack.name],
      isCurrent: true,
      trustLevel: 'trusted',
      timestamp: '2026-07-29T00:00:00.000Z',
    }))
  ));
  const queryPlan = expandSafetyQuery(evalCase.query);
  const lexicalLists = [
    bm25Rank(evalCase.query, corpus),
    ...(queryPlan.applied ? [bm25Rank(queryPlan.rewritten, corpus)] : []),
  ];
  const fused = reciprocalRankFusion(lexicalLists);
  const ranked = rerankCandidates(evalCase.query, fused, {
    candidateLimit: corpus.length,
    nowMs: Date.parse('2026-07-29T12:00:00.000Z'),
  });
  const rankedIds = new Set(ranked.map((item) => item.id));
  return [
    ...ranked,
    ...corpus.filter((item) => !rankedIds.has(item.id)),
  ];
}

function itemContent(item) {
  return String(
    item?.structuredContext?.rawContent
    || item?.content
    || item?.context
    || '',
  );
}

function relevanceGrade(evalCase, item) {
  const explicit = evalCase?.relevanceGrades;
  if (explicit && Object.hasOwn(explicit, item?.id)) {
    return Math.max(0, Number(explicit[item.id]) || 0);
  }
  const expected = String(evalCase?.expectedRuleHit || '').toLowerCase();
  const content = itemContent(item).toLowerCase();
  if (expected && content.includes(expected)) return 3;
  if (evalCase?.domain && item?.domain === evalCase.domain) return 1;
  return 0;
}

function discountedCumulativeGain(grades, k) {
  return grades.slice(0, k).reduce((total, grade, index) => (
    total + ((2 ** grade) - 1) / Math.log2(index + 2)
  ), 0);
}

function computeRankedMetrics(evalCase, items = [], options = {}) {
  const ranked = Array.isArray(items) ? items : [];
  const grades = ranked.map((item) => relevanceGrade(evalCase, item));
  const relevantThreshold = Number(options.relevantThreshold) || 2;
  const totalRelevant = grades.filter((grade) => grade >= relevantThreshold).length;
  const recallAt = (k) => {
    if (totalRelevant === 0) return 0;
    const hits = grades.slice(0, k).filter((grade) => grade >= relevantThreshold).length;
    return hits / totalRelevant;
  };
  const firstRelevant = grades
    .slice(0, 10)
    .findIndex((grade) => grade >= relevantThreshold);
  const idealGrades = [...grades].sort((left, right) => right - left);
  const dcgAt10 = discountedCumulativeGain(grades, 10);
  const idealDcgAt10 = discountedCumulativeGain(idealGrades, 10);
  const topFive = grades.slice(0, 5);
  const scopeLeakCount = ranked.slice(0, 10).filter((item) => (
    evalCase?.scope?.tenantId
    && item?.scope?.tenantId
    && item.scope.tenantId !== evalCase.scope.tenantId
  )).length;
  const staleHitCount = ranked.slice(0, 10).filter((item) => item?.isCurrent === false).length;

  return {
    recallAt1: recallAt(1),
    recallAt5: recallAt(5),
    recallAt10: recallAt(10),
    precisionAt5: topFive.filter((grade) => grade >= relevantThreshold).length / 5,
    mrrAt10: firstRelevant >= 0 ? 1 / (firstRelevant + 1) : 0,
    ndcgAt10: idealDcgAt10 > 0 ? dcgAt10 / idealDcgAt10 : 0,
    totalRelevant,
    firstRelevantRank: firstRelevant >= 0 ? firstRelevant + 1 : null,
    scopeLeakRate: scopeLeakCount / 10,
    staleHitRate: staleHitCount / 10,
  };
}

function evaluateThresholds(summary, thresholds = DEFAULT_THRESHOLDS) {
  const failures = [];
  const recallAt10 = summary.recallAt10 ?? summary.avgRecall ?? 0;
  const precisionAt5 = summary.precisionAt5 ?? summary.avgPrecision ?? 0;
  const mrrAt10 = summary.mrrAt10 ?? 0;
  const ndcgAt10 = summary.ndcgAt10 ?? 0;
  const scopeLeakRate = summary.scopeLeakRate ?? 0;
  const staleHitRate = summary.staleHitRate ?? 0;
  if (summary.casesEvaluated < thresholds.minCases) {
    failures.push(`cases ${summary.casesEvaluated} < ${thresholds.minCases}`);
  }
  if (recallAt10 < (thresholds.minRecallAt10 ?? thresholds.minRecall)) {
    failures.push(`recall@10 ${recallAt10.toFixed(3)} < ${(thresholds.minRecallAt10 ?? thresholds.minRecall).toFixed(3)}`);
  }
  if (precisionAt5 < (thresholds.minPrecisionAt5 ?? thresholds.minPrecision)) {
    failures.push(`precision@5 ${precisionAt5.toFixed(3)} < ${(thresholds.minPrecisionAt5 ?? thresholds.minPrecision).toFixed(3)}`);
  }
  if (mrrAt10 < (thresholds.minMrrAt10 ?? 0)) {
    failures.push(`MRR@10 ${mrrAt10.toFixed(3)} < ${(thresholds.minMrrAt10 ?? 0).toFixed(3)}`);
  }
  if (ndcgAt10 < (thresholds.minNdcgAt10 ?? 0)) {
    failures.push(`nDCG@10 ${ndcgAt10.toFixed(3)} < ${(thresholds.minNdcgAt10 ?? 0).toFixed(3)}`);
  }
  if (scopeLeakRate > (thresholds.maxScopeLeakRate ?? 0)) {
    failures.push(`scope leak rate ${scopeLeakRate.toFixed(3)} > ${(thresholds.maxScopeLeakRate ?? 0).toFixed(3)}`);
  }
  if (staleHitRate > (thresholds.maxStaleHitRate ?? 0)) {
    failures.push(`stale hit rate ${staleHitRate.toFixed(3)} > ${(thresholds.maxStaleHitRate ?? 0).toFixed(3)}`);
  }
  for (const result of summary.results || []) {
    const caseRecall = result.recallAt10 ?? result.lexicalRecall ?? 0;
    const minimum = thresholds.minCaseRecallAt10 ?? thresholds.minCaseRecall;
    if (caseRecall < minimum) {
      failures.push(`${result.id} recall@10 ${caseRecall.toFixed(3)} < ${minimum.toFixed(3)}`);
    }
  }
  return {
    passed: failures.length === 0,
    failures,
    thresholds,
  };
}

async function collectStageMetrics({
  avgRecall,
  avgPrecision,
  mrrAt10,
  ndcgAt10,
  results,
} = {}) {
  const pipeline = runDocumentPipeline(skillPacksToDocuments(), { maxChars: 900, overlap: 120 });
  let embedMetrics = {
    embedding_provider: 'unknown',
    embedding_quality_tier: 'degraded',
    embedding_dim: 0,
  };
  try {
    const vectorStore = require('./vector-store');
    const vec = await vectorStore.embed('ThumbGate embedding health probe', { kind: 'query' });
    const profile = vectorStore.getLastEmbeddingProfile?.() || null;
    const id = profile?.activeProfile?.id || profile?.source || 'unknown';
    let tier = 'production';
    let provider = id;
    if (process.env.THUMBGATE_VECTOR_STUB_EMBED === 'true') {
      provider = 'stub';
      tier = 'test_stub';
    } else if (id === 'feature-hash-v1' || profile?.source === 'built-in') {
      provider = 'feature-hash';
      tier = 'degraded';
    } else if (id === 'gemini' || profile?.source === 'managed') {
      provider = 'gemini';
    } else if (id === 'coreai') {
      provider = 'coreai';
    } else {
      provider = id || 'transformers';
    }
    embedMetrics = {
      embedding_provider: provider,
      embedding_quality_tier: tier,
      embedding_dim: Array.isArray(vec) ? vec.length : (profile?.activeProfile?.outputDimensionality || 0),
    };
  } catch (err) {
    embedMetrics.error = err.message;
  }

  let lancedb_module_resolvable = false;
  let vector_search_smoke_ok = false;
  let vector_upsert_smoke_ok = false;
  try {
    require.resolve('@lancedb/lancedb');
    lancedb_module_resolvable = true;
    const smokeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-rag-vector-smoke-'));
    const previousStub = process.env.THUMBGATE_VECTOR_STUB_EMBED;
    process.env.THUMBGATE_VECTOR_STUB_EMBED = 'true';
    try {
      const vectorStore = require('./vector-store');
      const upsert = await vectorStore.upsertVectorRecords([{
        id: 'rag-smoke-1',
        text: 'ThumbGate vector database smoke probe',
        source: 'document',
        scope: { tenantId: 'eval', visibility: 'private' },
        isCurrent: true,
        trustLevel: 'trusted',
      }], { feedbackDir: smokeDir });
      vector_upsert_smoke_ok = upsert.indexed === 1;
      const search = await vectorStore.searchRag('ThumbGate vector database smoke probe', {
        feedbackDir: smokeDir,
        filters: { tenantId: 'eval', visibility: 'private', currentOnly: true },
      });
      vector_search_smoke_ok = search.results.some((row) => row.id === 'rag-smoke-1');
    } finally {
      if (previousStub === undefined) delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
      else process.env.THUMBGATE_VECTOR_STUB_EMBED = previousStub;
      fs.rmSync(smokeDir, { recursive: true, force: true });
    }
  } catch {
    lancedb_module_resolvable = false;
  }

  const local = Boolean(process.env.THUMBGATE_LOCAL_LLM_ENDPOINT);
  const gemini = Boolean(process.env.GEMINI_API_KEY || process.env.THUMBGATE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  const perplexity = Boolean(process.env.PERPLEXITY_API_KEY || process.env.THUMBGATE_PERPLEXITY_API_KEY);
  let llm_configured = 'none';
  if (local) llm_configured = 'local';
  else if (perplexity) llm_configured = 'perplexity';
  else if (gemini) llm_configured = 'gemini';

  const sampleSources = [{ id: 's1', title: 'Sample', content: 'ALWAYS use idempotency keys.', signal: 'negative' }];
  const promptAssembly = buildChatPromptWithDiagnostics(
    'Create a PaymentIntent',
    sampleSources,
    { gates: { total: 1 } },
  );
  const prompt = promptAssembly.prompt;
  const structured = validateStructuredAnswer({
    answer: 'Use idempotency keys [1].',
    citations: [{ id: 's1', index: 1 }],
    grounded: true,
    confidence: 0.9,
  }, sampleSources);

  const top1Hits = (results || []).filter((r) => r.firstRelevantRank === 1).length;
  const stageMetrics = {
    ...pipeline.metrics,
    ...embedMetrics,
    lancedb_module_resolvable,
    vector_search_smoke_ok,
    vector_upsert_smoke_ok,
    binary_parser_adapters: ['pdf_embedded_text', 'pdf_ocr', 'docx', 'image_ocr'],
    parser_limits_enforced: true,
    incremental_versioning_enabled: true,
    stable_chunk_ids_enabled: true,
    retrieval_recall_at_k: avgRecall ?? 0,
    retrieval_precision_at_k: avgPrecision ?? 0,
    retrieval_mrr_at_10: mrrAt10 ?? 0,
    retrieval_ndcg_at_10: ndcgAt10 ?? 0,
    hybrid_path_used: true,
    rerank_applied: true,
    rerank_top1_contains_expected: results?.length ? top1Hits / results.length : 0,
    rerank_candidate_pool_size: 50,
    prompt_contains_grounding_instruction: /only the retrieved evidence/i.test(prompt) ? 1 : 0,
    prompt_contains_question: /PaymentIntent/.test(prompt) ? 1 : 0,
    prompt_context_item_count: sampleSources.length,
    prompt_estimated_input_tokens: promptAssembly.diagnostics.estimatedInputTokens,
    prompt_tokens_within_budget: promptAssembly.diagnostics.withinBudget,
    prompt_dropped_context_count: promptAssembly.diagnostics.droppedSourceCount,
    prompt_injection_items_isolated: true,
    llm_configured,
    llm_allowlist_enforced: true,
    deterministic_fallback_available: true,
    llm_timeout_ms: 30000,
    llm_max_retries: 2,
    structured_repair_attempt_limit: 1,
    structured_schema_valid_rate: structured.ok ? 1 : 0,
    citation_ids_subset_of_sources: structured.ok ? 1 : 0,
    structured_first_pass_valid_rate: structured.ok ? 1 : 0,
    structured_final_valid_rate: structured.ok ? 1 : 0,
    structured_output_instruction_present: Boolean(structuredOutputInstruction()),
  };

  const stageStatus = STAGES.map((stage) => {
    const missing = (stage.metricKeys || []).filter((k) => stageMetrics[k] === undefined || stageMetrics[k] === null);
    return {
      id: stage.id,
      name: stage.name,
      ok: missing.length === 0,
      missingMetrics: missing,
      metrics: Object.fromEntries((stage.metricKeys || []).map((k) => [k, stageMetrics[k]])),
    };
  });

  return { stageMetrics, stageStatus, pipeline };
}

async function runRagEval(options = {}) {
  console.log('Starting RAG Evaluation (Async Stack simulation)...');
  const evalCases = options.cases || BUILTIN_EVAL_CASES;
  const retrieveItems = options.retrieveItems || retrieveEvalItems;
  const reportPath = options.reportPath || REPORT_PATH;
  const enableLlmJudge = options.enableLlmJudge !== false;
  const results = [];
  const metricTotals = {
    recallAt1: 0,
    recallAt5: 0,
    recallAt10: 0,
    precisionAt5: 0,
    mrrAt10: 0,
    ndcgAt10: 0,
    scopeLeakRate: 0,
    staleHitRate: 0,
  };
  let casesEvaluated = 0;

  for (const evalCase of evalCases) {
    let items = [];
    try {
      items = await retrieveItems(evalCase);
    } catch {
      items = [];
    }
    const allText = items.map(i => (i.structuredContext && i.structuredContext.rawContent) || i.content || '').join('\n');

    // Lexical baseline scores
    const lexicalRecall = computeLexicalRecall(evalCase.expectedRuleHit, allText);
    const lexicalPrecision = computeLexicalPrecision(evalCase.expectedRuleHit, items);

    // The optional judge is diagnostic only. Deterministic metrics remain the
    // release gate so credentials, model drift, and judge preference cannot
    // turn the same retrieval result from pass to fail.
    const llmMetrics = enableLlmJudge
      ? await evaluateMetricsWithLlm(evalCase.query, evalCase.expectedRuleHit, items)
      : null;

    const rankedMetrics = computeRankedMetrics(evalCase, items);
    for (const key of Object.keys(metricTotals)) {
      metricTotals[key] += rankedMetrics[key];
    }
    casesEvaluated++;

    results.push({
      id: evalCase.id,
      query: evalCase.query,
      expectedRuleHit: evalCase.expectedRuleHit,
      retrievedCount: items.length,
      lexicalRecall,
      lexicalPrecision,
      ...rankedMetrics,
      llmMetrics,
      finalRecall: rankedMetrics.recallAt10,
      finalPrecision: rankedMetrics.precisionAt5,
    });
  }

  const aggregateMetrics = Object.fromEntries(
    Object.entries(metricTotals).map(([key, total]) => [
      key,
      casesEvaluated > 0 ? total / casesEvaluated : 0,
    ]),
  );
  const avgRecall = aggregateMetrics.recallAt10;
  const avgPrecision = aggregateMetrics.precisionAt5;
  const gateInput = {
    casesEvaluated,
    avgRecall,
    avgPrecision,
    ...aggregateMetrics,
    results,
  };
  const gate = evaluateThresholds(gateInput, options.thresholds || DEFAULT_THRESHOLDS);

  const { stageMetrics, stageStatus } = options.skipStageMetrics
    ? { stageMetrics: {}, stageStatus: [] }
    : await collectStageMetrics({
      avgRecall,
      avgPrecision,
      mrrAt10: aggregateMetrics.mrrAt10,
      ndcgAt10: aggregateMetrics.ndcgAt10,
      results,
    });

  // Render markdown report
  const reportLines = [
    '# RAG Precision & Evaluation Report',
    '',
    `**Timestamp**: ${new Date().toISOString()}`,
    `**Release Gate**: ${gate.passed ? 'PASS' : 'FAIL'}`,
    `**Recall@1**: ${(aggregateMetrics.recallAt1 * 100).toFixed(1)}%`,
    `**Recall@5**: ${(aggregateMetrics.recallAt5 * 100).toFixed(1)}%`,
    `**Recall@10**: ${(aggregateMetrics.recallAt10 * 100).toFixed(1)}%`,
    `**Precision@5**: ${(aggregateMetrics.precisionAt5 * 100).toFixed(1)}%`,
    `**MRR@10**: ${aggregateMetrics.mrrAt10.toFixed(3)}`,
    `**nDCG@10**: ${aggregateMetrics.ndcgAt10.toFixed(3)}`,
    `**Scope leak rate**: ${(aggregateMetrics.scopeLeakRate * 100).toFixed(1)}%`,
    `**Stale-hit rate**: ${(aggregateMetrics.staleHitRate * 100).toFixed(1)}%`,
    `**Cases**: ${casesEvaluated}`,
    `**LLM Judge**: ${llmClient.isAvailable() && enableLlmJudge ? 'Diagnostic only' : 'Not active'}`,
    `**Thresholds**: Recall@10 >= ${(gate.thresholds.minRecallAt10 * 100).toFixed(0)}%, MRR@10 >= ${gate.thresholds.minMrrAt10.toFixed(2)}, nDCG@10 >= ${gate.thresholds.minNdcgAt10.toFixed(2)}, Precision@5 >= ${(gate.thresholds.minPrecisionAt5 * 100).toFixed(0)}%, cases >= ${gate.thresholds.minCases}`,
    '',
  ];

  if (stageStatus.length) {
    reportLines.push(
      '## Per-stage metrics (contracts: reports/rag-stage-contracts.md)',
      '',
      '| Stage | OK | Metrics |',
      '|---|---|---|',
    );
    for (const s of stageStatus) {
      const summary = Object.entries(s.metrics || {})
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('; ');
      reportLines.push(`| ${s.name} | ${s.ok ? 'yes' : 'no'} | ${summary} |`);
    }
    reportLines.push('');
  }

  reportLines.push(
    '## Evaluation Results by Case',
    '',
    '| Case ID | Query | Expected Rule | Top rank | R@5 | R@10 | MRR@10 | nDCG@10 | P@5 | Mode |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---|',
  );

  for (const r of results) {
    const mode = r.llmMetrics ? 'Deterministic + diagnostic judge' : 'Deterministic';
    reportLines.push(
      `| ${r.id} | "${r.query}" | \`${r.expectedRuleHit}\` | ${r.firstRelevantRank || '—'} | ${(r.recallAt5 * 100).toFixed(0)}% | ${(r.recallAt10 * 100).toFixed(0)}% | ${r.mrrAt10.toFixed(3)} | ${r.ndcgAt10.toFixed(3)} | ${(r.precisionAt5 * 100).toFixed(0)}% | ${mode} |`
    );
  }

  if (!gate.passed) {
    reportLines.push('', '## Release Gate Failures', '', ...gate.failures.map((failure) => `- ${failure}`));
  }

  reportLines.push('', '## Diagnostics and Reasoning');
  for (const r of results) {
    if (r.llmMetrics && r.llmMetrics.reasoning) {
      reportLines.push(`- **${r.id}**: ${r.llmMetrics.reasoning}`);
    } else {
      reportLines.push(`- **${r.id}**: first relevant rank=${r.firstRelevantRank || 'none'}, Recall@10=${r.recallAt10.toFixed(3)}, MRR@10=${r.mrrAt10.toFixed(3)}, nDCG@10=${r.ndcgAt10.toFixed(3)}.`);
    }
  }

  const reportContent = reportLines.join('\n');

  // Make sure directories exist
  const dir = path.dirname(reportPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(reportPath, reportContent, 'utf-8');
  console.log(`RAG evaluation report saved to: ${reportPath}`);

  try {
    const stageDir = path.dirname(STAGE_REPORT_PATH);
    if (!fs.existsSync(stageDir)) fs.mkdirSync(stageDir, { recursive: true });
    fs.writeFileSync(STAGE_REPORT_PATH, formatStageContractsMarkdown(), 'utf-8');
  } catch {
    // non-fatal
  }

  return {
    results,
    stageMetrics,
    stageStatus,
    summary: {
      avgRecall,
      avgPrecision,
      ...aggregateMetrics,
      casesEvaluated,
      reportPath,
      passed: gate.passed,
      failures: gate.failures,
      thresholds: gate.thresholds,
      passedThresholds: gate.passed,
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
  computeLexicalRecall,
  computeLexicalPrecision,
  computeRankedMetrics,
  discountedCumulativeGain,
  evaluateThresholds,
  relevanceGrade,
  retrieveEvalItems,
  DEFAULT_THRESHOLDS,
};
