#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  claimSupportScore,
  evaluateAnswerQuality,
  queryCoverage,
  splitAnswerClaims,
} = require('./rag-structured-output');

const DEFAULT_THRESHOLDS = {
  faithfulness: 0.72,
  answerRelevance: 0.45,
  contextPrecision: 0.5,
  groundedness: 0.75,
  citationPrecision: 1,
};

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function overlapScore(left, right) {
  const leftTokens = unique(tokenize(left));
  const rightSet = new Set(tokenize(right));
  if (leftTokens.length === 0) return 0;
  const matches = leftTokens.filter((token) => rightSet.has(token)).length;
  return matches / leftTokens.length;
}

function splitClaims(response) {
  return splitAnswerClaims(response);
}

function normalizeContexts(contexts) {
  if (Array.isArray(contexts)) return contexts.map(String).filter(Boolean);
  if (contexts) return [String(contexts)];
  return [];
}

function scoreFaithfulness(response, contexts) {
  const claims = splitClaims(response);
  const contextItems = normalizeContexts(contexts);
  if (claims.length === 0) return { score: 0, supportedClaims: 0, totalClaims: 0 };
  const supportedClaims = claims.filter((claim) => {
    return contextItems.some((context) => claimSupportScore(claim, context) >= 0.4);
  }).length;
  return {
    score: Number((supportedClaims / claims.length).toFixed(4)),
    supportedClaims,
    totalClaims: claims.length,
  };
}

function scoreAnswerRelevance(question, response) {
  const score = queryCoverage(question, response);
  return {
    score: Number(score.toFixed(4)),
    matchedQuestionTerms: unique(tokenize(question).filter((token) => tokenize(response).includes(token))),
  };
}

function scoreContextPrecision(question, contexts, reference = '') {
  const normalizedContexts = normalizeContexts(contexts);
  const target = [question, reference].filter(Boolean).join('\n');
  if (normalizedContexts.length === 0) return { score: 0, relevantContexts: 0, totalContexts: 0 };

  let precisionSum = 0;
  let relevantContexts = 0;
  normalizedContexts.forEach((context, index) => {
    const relevant = overlapScore(target, context) >= 0.22 || overlapScore(context, target) >= 0.22;
    if (relevant) relevantContexts += 1;
    const precisionAtK = relevantContexts / (index + 1);
    if (relevant) precisionSum += precisionAtK;
  });

  const score = relevantContexts === 0 ? 0 : precisionSum / relevantContexts;
  return {
    score: Number(score.toFixed(4)),
    relevantContexts,
    totalContexts: normalizedContexts.length,
  };
}

function evaluateGeneration(testCase, options = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };
  const contexts = normalizeContexts(testCase.retrievedContexts || testCase.contexts || testCase.retrieved_contexts);
  const faithfulness = scoreFaithfulness(testCase.response || testCase.answer, contexts);
  const answerRelevance = scoreAnswerRelevance(testCase.question || testCase.user_input, testCase.response || testCase.answer);
  const contextPrecision = scoreContextPrecision(
    testCase.question || testCase.user_input,
    contexts,
    testCase.reference || testCase.groundTruth || ''
  );
  const answerQuality = evaluateAnswerQuality({
    query: testCase.question || testCase.user_input,
    answer: testCase.response || testCase.answer,
    referenceAnswer: testCase.reference || testCase.groundTruth || '',
    citations: testCase.citations,
    contexts: contexts.map((text, index) => ({ id: `context-${index + 1}`, text })),
  }, {
    minFaithfulness: thresholds.faithfulness,
    minGroundedness: thresholds.groundedness,
    minAnswerRelevance: thresholds.answerRelevance,
  });
  const scores = {
    faithfulness: faithfulness.score,
    answerRelevance: answerRelevance.score,
    contextPrecision: contextPrecision.score,
    groundedness: answerQuality.metrics.groundedness,
    citationPrecision: answerQuality.metrics.citationPrecision,
  };
  const passed = scores.faithfulness >= thresholds.faithfulness
    && scores.answerRelevance >= thresholds.answerRelevance
    && scores.contextPrecision >= thresholds.contextPrecision
    && scores.groundedness >= thresholds.groundedness
    && scores.citationPrecision >= thresholds.citationPrecision;

  return {
    id: String(testCase.id || testCase.traceId || 'case'),
    traceId: String(testCase.traceId || testCase.id || ''),
    passed,
    scores,
    thresholds,
    details: {
      faithfulness,
      answerRelevance,
      contextPrecision,
      answerQuality,
    },
  };
}

function buildRagasCompatibleRows(cases) {
  return cases.map((testCase) => ({
    user_input: testCase.question || testCase.user_input || '',
    response: testCase.response || testCase.answer || '',
    retrieved_contexts: normalizeContexts(testCase.retrievedContexts || testCase.contexts || testCase.retrieved_contexts),
    reference: testCase.reference || testCase.groundTruth || '',
  }));
}

function buildLangSmithCompatibleRuns(cases, results) {
  return cases.map((testCase, index) => ({
    id: testCase.traceId || testCase.id || `case-${index + 1}`,
    name: 'thumbgate_async_rag_eval',
    inputs: { question: testCase.question || testCase.user_input || '' },
    outputs: { response: testCase.response || testCase.answer || '' },
    metadata: {
      evaluator: 'thumbgate-async-eval-observability',
      caseId: testCase.id || null,
    },
    feedback: Object.entries(results[index].scores).map(([key, score]) => ({
      key,
      score,
    })),
  }));
}

function buildEvalReport(cases, options = {}) {
  const normalizedCases = Array.isArray(cases) ? cases : [];
  const results = normalizedCases.map((testCase) => evaluateGeneration(testCase, options));
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  const aggregate = {
    faithfulness: average(results.map((result) => result.scores.faithfulness)),
    answerRelevance: average(results.map((result) => result.scores.answerRelevance)),
    contextPrecision: average(results.map((result) => result.scores.contextPrecision)),
    groundedness: average(results.map((result) => result.scores.groundedness)),
    citationPrecision: average(results.map((result) => result.scores.citationPrecision)),
  };

  return {
    generatedAt: new Date().toISOString(),
    mode: 'async-post-generation',
    total: results.length,
    passed,
    failed,
    passRate: results.length === 0 ? 0 : Number(((passed / results.length) * 100).toFixed(2)),
    aggregate,
    passedThreshold: failed === 0,
    metrics: ['faithfulness', 'answerRelevance', 'contextPrecision', 'groundedness', 'citationPrecision'],
    sinks: {
      ci: true,
      langsmithCompatible: true,
      ragasCompatible: true,
    },
    results,
    ragasDataset: buildRagasCompatibleRows(normalizedCases),
    langsmithRuns: buildLangSmithCompatibleRuns(normalizedCases, results),
  };
}

function average(values) {
  const numeric = values.filter((value) => Number.isFinite(value));
  if (numeric.length === 0) return 0;
  return Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(4));
}

async function runAsyncEvaluation(cases, options = {}) {
  const report = await new Promise((resolve) => {
    setImmediate(() => resolve(buildEvalReport(cases, options)));
  });
  if (options.outputPath) {
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

function loadCases(inputPath) {
  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  return Array.isArray(payload) ? payload : payload.cases || [];
}

async function main(argv = process.argv.slice(2)) {
  const inputIndex = argv.indexOf('--input');
  const outputIndex = argv.indexOf('--output');
  const inputPath = inputIndex >= 0 ? argv[inputIndex + 1] : 'bench/observability-eval-suite.json';
  const outputPath = outputIndex >= 0 ? argv[outputIndex + 1] : 'proof/async-eval-observability-report.json';
  const report = await runAsyncEvaluation(loadCases(inputPath), { outputPath });
  process.stdout.write(`${JSON.stringify({
    outputPath,
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    passRate: report.passRate,
  }, null, 2)}\n`);
  if (!report.passedThreshold) process.exitCode = 1;
}

module.exports = {
  DEFAULT_THRESHOLDS,
  buildEvalReport,
  buildLangSmithCompatibleRuns,
  buildRagasCompatibleRows,
  evaluateGeneration,
  runAsyncEvaluation,
  scoreAnswerRelevance,
  scoreContextPrecision,
  scoreFaithfulness,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
}
