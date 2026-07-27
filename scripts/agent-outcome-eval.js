#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  TASK_OUTCOME_SCHEMA,
  calculateTaskOutcomeMetrics,
  normalizeTaskOutcome,
} = require('./task-outcomes');
const { validateToolContract } = require('./tool-contract-validator');

const ROOT = path.join(__dirname, '..');
const DEFAULT_SUITE = path.join(ROOT, 'config', 'evals', 'agent-outcomes-golden.json');
const DEFAULT_BASELINE = path.join(ROOT, 'config', 'evals', 'agent-outcomes-baseline.json');

function runCase(testCase = {}) {
  const receipt = normalizeTaskOutcome(testCase.receipt, new Date('2026-07-26T00:00:00.000Z'));
  const validation = validateToolContract(TASK_OUTCOME_SCHEMA, receipt);
  const expectedReasons = [...(testCase.expected?.reasons || [])]
    .sort((left, right) => left.localeCompare(right));
  const actualReasons = [...(receipt.workingReasons || [])]
    .sort((left, right) => left.localeCompare(right));
  const checks = [
    {
      id: 'schema_valid',
      pass: validation.valid,
      detail: validation.valid ? 'receipt schema valid' : validation.errors.join('; '),
    },
    {
      id: 'working_verdict',
      pass: receipt.working === testCase.expected?.working,
      detail: `expected ${testCase.expected?.working}, got ${receipt.working}`,
    },
    {
      id: 'reason_codes',
      pass: JSON.stringify(actualReasons) === JSON.stringify(expectedReasons),
      detail: `expected [${expectedReasons.join(', ')}], got [${actualReasons.join(', ')}]`,
    },
  ];
  const passed = checks.every((check) => check.pass);
  return {
    id: testCase.id,
    status: passed ? 'pass' : 'fail',
    score: Math.round((checks.filter((check) => check.pass).length / checks.length) * 100),
    severity: testCase.severity,
    split: testCase.split,
    checks,
    receipt,
  };
}

function runAgentOutcomeEval(options = {}) {
  const suitePath = path.resolve(options.suitePath || DEFAULT_SUITE);
  const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'));
  if (!Array.isArray(suite.cases) || suite.cases.length === 0) {
    throw new Error('Agent outcome suite must contain non-empty cases');
  }
  const results = suite.cases.map(runCase);
  const passed = results.filter((result) => result.status === 'pass').length;
  const score = Math.round((results.reduce((sum, result) => sum + result.score, 0) / results.length));
  const minimumCases = Number(suite.successCriteria?.minimumCases || 1);
  const minimumScore = Number(suite.successCriteria?.minAggregateScore || 100);
  const baselinePath = path.resolve(options.baselinePath || DEFAULT_BASELINE);
  const baseline = fs.existsSync(baselinePath)
    ? JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
    : null;
  const regressions = compareBaseline(results, baseline);
  const report = {
    suite: suite.name,
    generatedAt: new Date().toISOString(),
    evidenceStatus: results.length >= minimumCases ? 'measured' : 'insufficient_evidence',
    total: results.length,
    passed,
    failed: results.length - passed,
    score,
    minimumScore,
    minimumCases,
    regressions,
    pass: results.length >= minimumCases
      && score >= minimumScore
      && (!suite.successCriteria?.requireNoRegressions || regressions.length === 0),
    metrics: calculateTaskOutcomeMetrics(results.map((result) => result.receipt)),
    results,
  };
  return report;
}

function compareBaseline(results, baseline) {
  if (!baseline) return [];
  const current = new Map(results.map((result) => [result.id, result]));
  const regressions = [];
  for (const previous of baseline.results || []) {
    const result = current.get(previous.id);
    if (!result) {
      regressions.push({ id: previous.id, reason: 'missing_case' });
    } else if (result.score < previous.score || (previous.status === 'pass' && result.status !== 'pass')) {
      regressions.push({
        id: previous.id,
        reason: 'score_or_status_regression',
        baselineScore: previous.score,
        currentScore: result.score,
      });
    }
  }
  return regressions;
}

function isCliInvocation() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;
}

if (isCliInvocation()) {
  const suitePath = process.argv.find((arg) => arg.startsWith('--suite='))?.slice(8);
  const baselinePath = process.argv.find((arg) => arg.startsWith('--baseline='))?.slice(11);
  const outputPath = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9);
  const report = runAgentOutcomeEval({ suitePath, baselinePath });
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.pass ? 0 : 1;
}

module.exports = {
  compareBaseline,
  runAgentOutcomeEval,
  runCase,
};
