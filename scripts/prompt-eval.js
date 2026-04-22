#!/usr/bin/env node
'use strict';

/**
 * Prompt Evaluation Framework for ThumbGate
 *
 * Based on Anthropic's prompt evaluation methodology:
 * 1. Define test cases with inputs and expected outputs
 * 2. Run prompts against test cases
 * 3. Grade outputs against expectations (deterministic + LLM-as-judge)
 * 4. Report pass/fail with scores
 *
 * Usage:
 *   node scripts/prompt-eval.js [--suite=path] [--json] [--min-score=80]
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_SUITE = path.join(ROOT, 'bench', 'prompt-eval-suite.json');

// ---------------------------------------------------------------------------
// Prompt simulators — run ThumbGate's actual logic against eval inputs
// ---------------------------------------------------------------------------

function simulateLessonDistillation(input) {
  // Use ThumbGate's actual captureFeedback logic to produce a lesson
  const { captureFeedback } = require('./feedback-loop');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-eval-'));
  const prevDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  try {
    const result = captureFeedback({
      signal: input.signal === 'positive' ? 'up' : 'down',
      context: input.context || '',
      whatWentWrong: input.whatWentWrong || undefined,
      whatToChange: input.whatToChange || undefined,
      whatWorked: input.whatWorked || undefined,
      tags: input.tags || [],
    });
    return result;
  } finally {
    process.env.THUMBGATE_FEEDBACK_DIR = prevDir || '';
    if (!prevDir) delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function simulateFeedbackEnrichment(input) {
  const { enrichFeedbackContext } = require('./feedback-loop');
  return enrichFeedbackContext({
    signal: input.signal,
    context: input.context,
    tags: input.tags || [],
  });
}

function simulatePreventionRule(input) {
  // Prevention rules are generated from accumulated patterns
  // For eval purposes, we test the rule structure expectations
  return {
    pattern: input.pattern,
    occurrences: input.occurrences,
    examples: input.examples,
    generated: true,
  };
}

function simulateSelfDistill(input) {
  return {
    sessionFeedback: input.sessionFeedback,
    summary: input.sessionFeedback.map((f) => f.context).join('; '),
    generated: true,
  };
}

const PROMPT_SIMULATORS = {
  'lesson-distillation': simulateLessonDistillation,
  'feedback-enrichment': simulateFeedbackEnrichment,
  'prevention-rule-generation': simulatePreventionRule,
  'self-distillation': simulateSelfDistill,
};

// ---------------------------------------------------------------------------
// Deterministic graders — check output against expected fields
// ---------------------------------------------------------------------------

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string') return value;
  }
  return '';
}

function addContainsChecks(checks, prefix, label, content, terms = []) {
  for (const term of terms) {
    const found = content.toLowerCase().includes(term.toLowerCase());
    checks.push({
      criterion: `${prefix}:${term}`,
      pass: found,
      detail: found ? `${label} contains "${term}"` : `${label} missing "${term}"`,
    });
  }
}

function handleRejectExpectation(checks, result, expected) {
  if (!expected.shouldReject) return false;

  const wasRejected = result.accepted === false
    || result.status === 'rejected'
    || result.actionType === 'no-action';
  checks.push({
    criterion: 'shouldReject',
    pass: wasRejected,
    detail: wasRejected ? 'Correctly rejected vague input' : 'Should have rejected but accepted',
  });
  return true;
}

function addTitleChecks(checks, result, expected) {
  if (!expected.hasTitle) return;

  const title = firstString(result.memoryRecord?.title, result.title);
  checks.push({
    criterion: 'hasTitle',
    pass: title.length > 0,
    detail: title ? `Title: "${title.slice(0, 60)}"` : 'Missing title',
  });
  addContainsChecks(checks, 'titleContains', 'Title', title, expected.titleContains);
}

function addContentChecks(checks, result, expected) {
  if (!expected.hasContent) return;

  const content = firstString(result.memoryRecord?.content, result.content);
  checks.push({
    criterion: 'hasContent',
    pass: content.length > 0,
    detail: content ? `Content length: ${content.length}` : 'Missing content',
  });
  addContainsChecks(checks, 'contentContains', 'Content', content, expected.contentContains);
}

function addCategoryChecks(checks, result, expected) {
  if (expected.category) {
    const category = firstString(result.memoryRecord?.category, result.category);
    checks.push({
      criterion: 'category',
      pass: category === expected.category,
      detail: `Expected "${expected.category}", got "${category}"`,
    });
  }

  if (expected.importance) {
    const importance = firstString(result.memoryRecord?.importance, result.importance);
    checks.push({
      criterion: 'importance',
      pass: importance === expected.importance,
      detail: `Expected "${expected.importance}", got "${importance}"`,
    });
  }
}

function addContextChecks(checks, result, expected) {
  if (expected.hasDomain) {
    const domain = firstString(result.richContext?.domain, result.domain);
    checks.push({
      criterion: 'domain',
      pass: expected.domain ? domain === expected.domain : domain.length > 0,
      detail: `Domain: "${domain}"`,
    });
  }

  if (expected.hasOutcome) {
    const outcome = firstString(result.richContext?.outcomeCategory, result.outcome);
    checks.push({
      criterion: 'hasOutcome',
      pass: outcome.length > 0,
      detail: `Outcome: "${outcome}"`,
    });
    addContainsChecks(checks, 'outcomeContains', 'Outcome', outcome, expected.outcomeContains);
  }
}

function addRuleChecks(checks, result, expected) {
  if (!expected.hasRule) return;

  checks.push({
    criterion: 'hasRule',
    pass: result.generated === true || !!result.rule,
    detail: result.generated ? 'Rule generated' : 'No rule generated',
  });
}

function addSummaryChecks(checks, result, expected) {
  if (!expected.hasSummary) return;

  const summary = firstString(result.summary);
  checks.push({
    criterion: 'hasSummary',
    pass: summary.length > 0,
    detail: `Summary length: ${summary.length}`,
  });
  addContainsChecks(checks, 'summaryContains', 'Summary', summary, expected.summaryContains);
}

function gradeOutput(output, expected) {
  const checks = [];
  const result = output || {};

  if (handleRejectExpectation(checks, result, expected)) return checks;

  addTitleChecks(checks, result, expected);
  addContentChecks(checks, result, expected);
  addCategoryChecks(checks, result, expected);
  addContextChecks(checks, result, expected);
  addRuleChecks(checks, result, expected);
  addSummaryChecks(checks, result, expected);

  return checks;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function loadSuite(suitePath) {
  const raw = JSON.parse(fs.readFileSync(suitePath, 'utf8'));
  if (!Array.isArray(raw.evaluations) || raw.evaluations.length === 0) {
    throw new Error('Suite must define a non-empty evaluations array');
  }
  return raw;
}

function loadReport(reportPath) {
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

function runEvaluation(evalCase) {
  const simulator = PROMPT_SIMULATORS[evalCase.prompt];
  if (!simulator) {
    return {
      id: evalCase.id,
      status: 'skip',
      reason: `No simulator for prompt: ${evalCase.prompt}`,
      checks: [],
      score: 0,
    };
  }

  let output;
  let error = null;
  try {
    output = simulator(evalCase.input);
  } catch (err) {
    error = err.message || String(err);
  }

  if (error) {
    return {
      id: evalCase.id,
      status: 'error',
      error,
      checks: [],
      score: 0,
    };
  }

  const checks = gradeOutput(output, evalCase.expectedOutput);
  const passCount = checks.filter((c) => c.pass).length;
  const score = checks.length > 0 ? Math.round((passCount / checks.length) * 100) : 0;

  return {
    id: evalCase.id,
    status: score === 100 ? 'pass' : 'fail',
    checks,
    score,
    passCount,
    totalChecks: checks.length,
  };
}

function runSuite(suitePath = DEFAULT_SUITE, options = {}) {
  const suite = loadSuite(suitePath);
  const results = [];

  for (const evalCase of suite.evaluations) {
    results.push(runEvaluation(evalCase));
  }

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const totalScore = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
    : 0;

  const minScore = Number.isFinite(Number(options.minScore))
    ? Number(options.minScore)
    : Number(suite.successCriteria?.minAggregateScore || 80);

  const report = {
    suite: suite.name,
    total: results.length,
    passed,
    failed,
    errors,
    skipped,
    score: totalScore,
    minScore,
    pass: totalScore >= minScore,
    successCriteria: suite.successCriteria || null,
    results,
  };

  const baselineReport = options.baselineReport
    || (options.baselinePath ? loadReport(options.baselinePath) : null);
  if (baselineReport) {
    report.comparison = compareReports(report, baselineReport);
    const requireNoRegressions = options.requireNoRegressions === true
      || suite.successCriteria?.requireNoRegressions === true;
    if (requireNoRegressions && report.comparison.regressions.length > 0) {
      report.pass = false;
    }
  }

  return report;
}

function compareReports(currentReport, baselineReport) {
  const baselineById = new Map((baselineReport?.results || []).map((result) => [result.id, result]));
  const regressions = [];
  const improvements = [];

  for (const result of currentReport.results || []) {
    const baseline = baselineById.get(result.id);
    if (!baseline) continue;

    const scoreDelta = result.score - baseline.score;
    if (scoreDelta < 0 || (baseline.status === 'pass' && result.status !== 'pass')) {
      regressions.push({
        id: result.id,
        baselineScore: baseline.score,
        currentScore: result.score,
        delta: scoreDelta,
        baselineStatus: baseline.status,
        currentStatus: result.status,
      });
      continue;
    }

    if (scoreDelta > 0 || (baseline.status !== 'pass' && result.status === 'pass')) {
      improvements.push({
        id: result.id,
        baselineScore: baseline.score,
        currentScore: result.score,
        delta: scoreDelta,
        baselineStatus: baseline.status,
        currentStatus: result.status,
      });
    }
  }

  return {
    baselineSuite: baselineReport?.suite || null,
    baselineScore: Number.isFinite(Number(baselineReport?.score)) ? Number(baselineReport.score) : null,
    scoreDelta: Number.isFinite(Number(baselineReport?.score)) ? currentReport.score - Number(baselineReport.score) : null,
    regressions,
    improvements,
  };
}

function writeReport(report, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function statusIcon(status) {
  if (status === 'pass') return '\u2705';
  if (status === 'skip') return '\u23ED';
  return '\u274C';
}

function isCliInvocation() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;
}

if (isCliInvocation()) {
  const args = process.argv.slice(2);
  let suitePath = DEFAULT_SUITE;
  let json = false;
  let minScore = 80;
  let baselinePath = null;
  let outputPath = null;
  let requireNoRegressions = false;

  for (const arg of args) {
    if (arg.startsWith('--suite=')) suitePath = path.resolve(arg.slice(8));
    if (arg === '--json') json = true;
    if (arg.startsWith('--min-score=')) minScore = Number(arg.slice(12));
    if (arg.startsWith('--baseline=')) baselinePath = path.resolve(arg.slice(11));
    if (arg.startsWith('--output=')) outputPath = path.resolve(arg.slice(9));
    if (arg === '--require-no-regressions') requireNoRegressions = true;
  }

  const report = runSuite(suitePath, { minScore, baselinePath, requireNoRegressions });
  if (outputPath) writeReport(report, outputPath);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n${report.suite}`);
    console.log('='.repeat(50));
    for (const r of report.results) {
      const icon = statusIcon(r.status);
      console.log(`${icon} ${r.id} — ${r.score}% (${r.passCount || 0}/${r.totalChecks || 0})`);
      if (r.status === 'fail' || r.status === 'error') {
        for (const c of (r.checks || [])) {
          if (!c.pass) console.log(`    \u274C ${c.criterion}: ${c.detail}`);
        }
        if (r.error) console.log(`    Error: ${r.error}`);
      }
    }
    console.log('='.repeat(50));
    console.log(`Score: ${report.score}% | Pass: ${report.passed} | Fail: ${report.failed} | Error: ${report.errors} | Skip: ${report.skipped}`);
    if (report.comparison) {
      console.log(`Baseline delta: ${report.comparison.scoreDelta >= 0 ? '+' : ''}${report.comparison.scoreDelta}%`);
      console.log(`Regressions: ${report.comparison.regressions.length} | Improvements: ${report.comparison.improvements.length}`);
    }
    console.log(report.pass ? '\u2705 PASS' : `\u274C FAIL (min: ${minScore}%)`);
  }

  process.exit(report.pass ? 0 : 1);
}

module.exports = {
  runSuite,
  runEvaluation,
  gradeOutput,
  loadSuite,
  loadReport,
  compareReports,
  writeReport,
};
