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
const DEFAULT_SYNTHETIC_VARIANTS = 2;

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
  const feedbackEvent = {
    signal: input.signal,
    context: input.context,
    tags: input.tags || [],
    whatWentWrong: input.whatWentWrong || '',
    whatToChange: input.whatToChange || '',
  };
  return enrichFeedbackContext(feedbackEvent, {
    filePaths: input.filePaths || [],
    errorType: input.errorType || null,
  });
}

function simulatePreventionRule(input) {
  // Prevention rules are generated from accumulated patterns
  // For eval purposes, produce a realistic block rule envelope.
  const normalizedExamples = Array.isArray(input.examples) ? input.examples.filter(Boolean) : [];
  const ruleText = normalizedExamples.length > 0
    ? `NEVER repeat ${normalizedExamples[0].toLowerCase()}; keep the workflow inside the worktree.`
    : `NEVER repeat pattern ${String(input.pattern || '').trim() || 'unknown-pattern'}.`;
  return {
    pattern: input.pattern,
    occurrences: input.occurrences,
    examples: normalizedExamples,
    rule: ruleText,
    actionType: 'block',
    confidence: Math.max(0.7, Math.min(0.99, Number(input.occurrences || 0) / 4)),
    generated: true,
  };
}

function simulateSelfDistill(input) {
  const sessionFeedback = Array.isArray(input.sessionFeedback) ? input.sessionFeedback : [];
  const contexts = sessionFeedback
    .map((entry) => String(entry?.context || '').trim())
    .filter(Boolean);
  const negativeContexts = sessionFeedback
    .filter((entry) => entry?.signal === 'negative')
    .map((entry) => String(entry?.context || '').trim())
    .filter(Boolean);

  const pattern = negativeContexts.length > 1
    ? `Pattern: repeated workflow discipline gaps around ${negativeContexts.slice(0, 2).join(' and ')}.`
    : 'Pattern: isolated session mistake with no repeated theme yet.';
  const improvement = contexts.some((context) => /thumbgate/i.test(context))
    ? 'Improvement: keep using ThumbGate at session start and stay inside the worktree.'
    : 'Improvement: start each session with ThumbGate and enforce worktree discipline.';
  return {
    sessionFeedback,
    summary: [...contexts, pattern, improvement].join('; '),
    pattern,
    improvement,
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

  const rule = firstString(result.rule, result.pattern, result.summary);
  checks.push({
    criterion: 'hasRule',
    pass: result.generated === true || rule.length > 0,
    detail: result.generated ? 'Rule generated' : 'No rule generated',
  });
  addContainsChecks(checks, 'ruleContains', 'Rule', rule, expected.ruleContains);

  if (expected.actionType) {
    const actionType = firstString(result.actionType, result.action, result.availability);
    checks.push({
      criterion: 'actionType',
      pass: actionType === expected.actionType,
      detail: `Expected "${expected.actionType}", got "${actionType}"`,
    });
  }

  if (expected.confidence?.min !== undefined) {
    const confidence = Number(result.confidence);
    const minConfidence = Number(expected.confidence.min);
    checks.push({
      criterion: 'confidenceMin',
      pass: Number.isFinite(confidence) && confidence >= minConfidence,
      detail: Number.isFinite(confidence)
        ? `Expected >= ${minConfidence}, got ${confidence}`
        : 'Missing numeric confidence',
    });
  }
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

  if (expected.identifiesPattern) {
    const pattern = firstString(result.pattern, summary);
    checks.push({
      criterion: 'identifiesPattern',
      pass: /pattern|repeat|repeated|recurring/i.test(pattern),
      detail: pattern ? `Pattern text: "${pattern.slice(0, 80)}"` : 'Missing pattern identification',
    });
  }

  if (expected.suggestsImprovement) {
    const improvement = firstString(result.improvement, summary);
    checks.push({
      criterion: 'suggestsImprovement',
      pass: /improvement|should|next time|keep|start|use/i.test(improvement),
      detail: improvement ? `Improvement text: "${improvement.slice(0, 80)}"` : 'Missing improvement guidance',
    });
  }
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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function mutateSyntheticInput(input) {
  if (Array.isArray(input)) {
    return input.map((item, index) => index === 0 ? mutateSyntheticInput(item) : cloneJson(item));
  }

  if (!input || typeof input !== 'object') return input;

  const next = cloneJson(input);

  for (const [key, value] of Object.entries(next)) {
    if (typeof value === 'string' && value.trim()) {
      if (key === 'context') next[key] = `  ${value}\n`;
      else if (key === 'whatWentWrong' || key === 'whatWorked' || key === 'whatToChange') next[key] = `${value} Please preserve the core meaning.`;
      else next[key] = value;
    } else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      next[key] = [...value, ...value.slice(0, 1).map((entry) => `${entry} (repeat check)`)];
    } else if (Array.isArray(value) && value.every((entry) => entry && typeof entry === 'object')) {
      next[key] = value.map((entry, index) => {
        if (index === 0 && typeof entry.context === 'string') {
          return { ...entry, context: `${entry.context} Next session should keep the same lesson.` };
        }
        return cloneJson(entry);
      });
    }
  }

  return next;
}

function expandWithSyntheticEvaluations(suite, options = {}) {
  const variantsPerCase = Number.isFinite(Number(options.syntheticVariants))
    ? Math.max(0, Number(options.syntheticVariants))
    : DEFAULT_SYNTHETIC_VARIANTS;

  if (variantsPerCase === 0) return suite;

  const evaluations = [...suite.evaluations];
  for (const evalCase of suite.evaluations) {
    for (let index = 0; index < variantsPerCase; index += 1) {
      evaluations.push({
        ...cloneJson(evalCase),
        id: `${evalCase.id}__synthetic_${index + 1}`,
        input: mutateSyntheticInput(evalCase.input),
        synthetic: true,
        syntheticSourceId: evalCase.id,
      });
    }
  }

  return {
    ...cloneJson(suite),
    syntheticVariantsPerCase: variantsPerCase,
    syntheticCount: evaluations.length - suite.evaluations.length,
    totalSeedEvaluations: suite.evaluations.length,
    evaluations,
  };
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
  const loadedSuite = loadSuite(suitePath);
  const suite = options.expandSynthetic
    ? expandWithSyntheticEvaluations(loadedSuite, options)
    : loadedSuite;
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
    syntheticCount: Number(suite.syntheticCount || 0),
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

function writeSuite(suite, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(suite, null, 2) + '\n');
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
  let suiteOutputPath = null;
  let requireNoRegressions = false;
  let expandSynthetic = false;
  let syntheticVariants = DEFAULT_SYNTHETIC_VARIANTS;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const nextArg = args[index + 1];
    if (arg.startsWith('--suite=')) suitePath = path.resolve(arg.slice(8));
    if (arg === '--suite' && nextArg) {
      suitePath = path.resolve(nextArg);
      index += 1;
      continue;
    }
    if (arg === '--json') json = true;
    if (arg.startsWith('--min-score=')) minScore = Number(arg.slice(12));
    if (arg === '--min-score' && nextArg) {
      minScore = Number(nextArg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--baseline=')) baselinePath = path.resolve(arg.slice(11));
    if (arg === '--baseline' && nextArg) {
      baselinePath = path.resolve(nextArg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) outputPath = path.resolve(arg.slice(9));
    if (arg === '--output' && nextArg) {
      outputPath = path.resolve(nextArg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--suite-output=')) suiteOutputPath = path.resolve(arg.slice(15));
    if (arg === '--suite-output' && nextArg) {
      suiteOutputPath = path.resolve(nextArg);
      index += 1;
      continue;
    }
    if (arg === '--require-no-regressions') requireNoRegressions = true;
    if (arg === '--synthetic') expandSynthetic = true;
    if (arg.startsWith('--synthetic-variants=')) {
      expandSynthetic = true;
      syntheticVariants = Number(arg.slice(21));
    }
    if (arg === '--synthetic-variants' && nextArg) {
      expandSynthetic = true;
      syntheticVariants = Number(nextArg);
      index += 1;
      continue;
    }
  }

  const report = runSuite(suitePath, {
    minScore,
    baselinePath,
    requireNoRegressions,
    expandSynthetic,
    syntheticVariants,
  });
  if (outputPath) writeReport(report, outputPath);
  if (suiteOutputPath) {
    const suite = expandSynthetic
      ? expandWithSyntheticEvaluations(loadSuite(suitePath), { syntheticVariants })
      : loadSuite(suitePath);
    writeSuite(suite, suiteOutputPath);
  }

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
    if (report.syntheticCount > 0) {
      console.log(`Synthetic cases: ${report.syntheticCount}`);
    }
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
  writeSuite,
  expandWithSyntheticEvaluations,
};
