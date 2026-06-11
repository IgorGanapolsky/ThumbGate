#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { constructContextPack } = require('./contextfs');
const { BUILTIN_EVAL_CASES } = require('./eval-harness');
const llmClient = require('./llm-client');

const REPORT_PATH = path.join(__dirname, '..', 'reports', 'eval-rag-report.md');

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

async function runRagEval() {
  console.log('Starting RAG Evaluation (Async Stack simulation)...');
  const results = [];
  let totalRecall = 0;
  let totalPrecision = 0;
  let casesEvaluated = 0;

  for (const evalCase of BUILTIN_EVAL_CASES) {
    let pack;
    try {
      pack = constructContextPack({ query: evalCase.query, maxItems: 5, maxChars: 3000 });
    } catch (err) {
      pack = { items: [], usedChars: 0 };
    }

    const items = pack.items || [];
    const allText = items.map(i => (i.structuredContext && i.structuredContext.rawContent) || i.content || '').join('\n');

    // Lexical baseline scores
    const lexicalRecall = computeLexicalRecall(evalCase.expectedRuleHit, allText);
    const lexicalPrecision = computeLexicalPrecision(evalCase.expectedRuleHit, items);

    // Dynamic LLM Ragas evaluation (optional)
    const llmMetrics = await evaluateMetricsWithLlm(evalCase.query, evalCase.expectedRuleHit, items);

    const finalRecall = llmMetrics ? llmMetrics.context_recall : lexicalRecall;
    const finalPrecision = llmMetrics ? llmMetrics.context_precision : lexicalPrecision;

    totalRecall += finalRecall;
    totalPrecision += finalPrecision;
    casesEvaluated++;

    results.push({
      id: evalCase.id,
      query: evalCase.query,
      expectedRuleHit: evalCase.expectedRuleHit,
      retrievedCount: items.length,
      lexicalRecall,
      lexicalPrecision,
      llmMetrics,
      finalRecall,
      finalPrecision,
    });
  }

  const avgRecall = casesEvaluated > 0 ? (totalRecall / casesEvaluated) : 0;
  const avgPrecision = casesEvaluated > 0 ? (totalPrecision / casesEvaluated) : 0;

  // Render markdown report
  const reportLines = [
    '# RAG Precision & Evaluation Report (Ragas Metrics)',
    '',
    `**Timestamp**: ${new Date().toISOString()}`,
    `**Average Context Recall**: ${(avgRecall * 100).toFixed(1)}%`,
    `**Average Context Precision**: ${(avgPrecision * 100).toFixed(1)}%`,
    `**API Key Available**: ${llmClient.isAvailable() ? 'Yes (LLM-as-a-judge active)' : 'No (Fallback to deterministic keyword eval)'}`,
    '',
    '## Evaluation Results by Case',
    '',
    '| Case ID | Query | Expected Rule | Retrieved | Recall | Precision | Mode |',
    '|---|---|---|---|---|---|---|',
  ];

  for (const r of results) {
    const mode = r.llmMetrics ? 'LLM-Judge' : 'Lexical-Fallback';
    reportLines.push(
      `| ${r.id} | "${r.query}" | \`${r.expectedRuleHit}\` | ${r.retrievedCount} | ${(r.finalRecall * 100).toFixed(0)}% | ${(r.finalPrecision * 100).toFixed(0)}% | ${mode} |`
    );
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
  const dir = path.dirname(REPORT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(REPORT_PATH, reportContent, 'utf-8');
  console.log(`RAG evaluation report saved to: ${REPORT_PATH}`);

  return {
    results,
    summary: {
      avgRecall,
      avgPrecision,
      reportPath: REPORT_PATH,
    }
  };
}

if (require.main === module) {
  runRagEval().catch(err => {
    console.error('RAG evaluation failed:', err);
    process.exit(1);
  });
}

module.exports = {
  runRagEval,
  computeLexicalRecall,
  computeLexicalPrecision,
};
