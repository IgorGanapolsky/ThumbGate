#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { constructContextPack } = require('./contextfs');
const { BUILTIN_EVAL_CASES } = require('./eval-harness');
const { getSkillPack, matchSkillPacks } = require('./skill-packs');
const llmClient = require('./llm-client');

const REPORT_PATH = path.join(__dirname, '..', 'reports', 'eval-rag-report.md');
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
  const domainPack = getSkillPack(evalCase.domain);
  const matchedPack = domainPack || matchSkillPacks(evalCase.query)[0] || null;
  const items = [];

  if (matchedPack) {
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

async function runRagEval(options = {}) {
  console.log('Starting RAG Evaluation (Async Stack simulation)...');
  const evalCases = options.cases || BUILTIN_EVAL_CASES;
  const retrieveItems = options.retrieveItems || retrieveEvalItems;
  const reportPath = options.reportPath || REPORT_PATH;
  const enableLlmJudge = options.enableLlmJudge !== false;
  const results = [];
  let totalRecall = 0;
  let totalPrecision = 0;
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

    totalRecall += lexicalRecall;
    totalPrecision += lexicalPrecision;
    casesEvaluated++;

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

  const avgRecall = casesEvaluated > 0 ? (totalRecall / casesEvaluated) : 0;
  const avgPrecision = casesEvaluated > 0 ? (totalPrecision / casesEvaluated) : 0;
  const gate = evaluateThresholds({
    casesEvaluated,
    avgRecall,
    avgPrecision,
    results,
  }, options.thresholds || DEFAULT_THRESHOLDS);

  // Render markdown report
  const reportLines = [
    '# RAG Precision & Evaluation Report',
    '',
    `**Timestamp**: ${new Date().toISOString()}`,
    `**Release Gate**: ${gate.passed ? 'PASS' : 'FAIL'}`,
    `**Deterministic Context Recall**: ${(avgRecall * 100).toFixed(1)}%`,
    `**Deterministic Context Precision**: ${(avgPrecision * 100).toFixed(1)}%`,
    `**Cases**: ${casesEvaluated}`,
    `**LLM Judge**: ${llmClient.isAvailable() && enableLlmJudge ? 'Diagnostic only' : 'Not active'}`,
    `**Thresholds**: recall >= ${(gate.thresholds.minRecall * 100).toFixed(0)}%, precision >= ${(gate.thresholds.minPrecision * 100).toFixed(0)}%, cases >= ${gate.thresholds.minCases}, every case recall >= ${(gate.thresholds.minCaseRecall * 100).toFixed(0)}%`,
    '',
    '## Evaluation Results by Case',
    '',
    '| Case ID | Query | Expected Rule | Retrieved | Recall | Precision | Mode |',
    '|---|---|---|---|---|---|---|',
  ];

  for (const r of results) {
    const mode = r.llmMetrics ? 'Deterministic + diagnostic judge' : 'Deterministic';
    reportLines.push(
      `| ${r.id} | "${r.query}" | \`${r.expectedRuleHit}\` | ${r.retrievedCount} | ${(r.finalRecall * 100).toFixed(0)}% | ${(r.finalPrecision * 100).toFixed(0)}% | ${mode} |`
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
      reportLines.push(`- **${r.id}**: Retrieved ${r.retrievedCount} chunks. Deterministic keyword match was ${r.lexicalRecall ? 'successful' : 'unsuccessful'}.`);
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

  return {
    results,
    summary: {
      avgRecall,
      avgPrecision,
      casesEvaluated,
      reportPath,
      passed: gate.passed,
      failures: gate.failures,
      thresholds: gate.thresholds,
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
  computeLexicalRecall,
  computeLexicalPrecision,
  evaluateThresholds,
  retrieveEvalItems,
  DEFAULT_THRESHOLDS,
};
