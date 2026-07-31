#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { evaluateAnswerQuality } = require('./rag-structured-output');

const DEFAULT_GOLDEN_PATH = path.join(
  __dirname,
  '..',
  'config',
  'evals',
  'rag-answer-quality-golden.json',
);

function loadAnswerGolden(goldenPath = DEFAULT_GOLDEN_PATH) {
  const fixture = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  if (!Array.isArray(fixture.cases)) throw new TypeError('answer-quality golden must include cases[]');
  return fixture;
}

function evaluateAnswerGolden(options = {}) {
  const goldenPath = options.goldenPath || DEFAULT_GOLDEN_PATH;
  const golden = options.golden || loadAnswerGolden(goldenPath);
  const thresholds = { ...(golden.thresholds || {}), ...(options.thresholds || {}) };
  const cases = golden.cases.map((sample) => {
    const result = evaluateAnswerQuality(sample, options.metricThresholds || {});
    return {
      id: sample.id,
      shouldPass: sample.shouldPass === true,
      predictedPass: result.passed,
      correct: result.passed === (sample.shouldPass === true),
      metrics: result.metrics,
      failures: result.failures,
    };
  });
  const correct = cases.filter((sample) => sample.correct).length;
  const falsePasses = cases.filter((sample) => !sample.shouldPass && sample.predictedPass).length;
  const classificationAccuracy = cases.length ? correct / cases.length : 0;
  const failures = [];
  if (cases.length < Number(thresholds.minCases || 1)) {
    failures.push(`cases ${cases.length} < ${thresholds.minCases}`);
  }
  if (classificationAccuracy < Number(thresholds.minClassificationAccuracy || 1)) {
    failures.push(`classification accuracy ${classificationAccuracy.toFixed(3)} < ${thresholds.minClassificationAccuracy}`);
  }
  if (falsePasses > Number(thresholds.maxFalsePasses || 0)) {
    failures.push(`false passes ${falsePasses} > ${thresholds.maxFalsePasses}`);
  }
  return {
    goldenPath,
    mode: 'metric-behavior-regression-not-model-quality',
    thresholds,
    summary: {
      cases: cases.length,
      correct,
      falsePasses,
      classificationAccuracy,
    },
    cases,
    failures,
    passed: failures.length === 0,
  };
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  const result = evaluateAnswerGolden();
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

module.exports = {
  DEFAULT_GOLDEN_PATH,
  loadAnswerGolden,
  evaluateAnswerGolden,
};
