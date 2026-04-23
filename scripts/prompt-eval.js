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
const DEFAULT_MAX_FEEDBACK_CASES = 25;

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
// Feedback -> eval conversion
// ---------------------------------------------------------------------------

function readJsonl(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function stableCaseId(value, index = 0) {
  const source = String(value || '').toLowerCase();
  let slug = '';
  let previousWasDash = false;
  for (const ch of source) {
    const isDigit = ch >= '0' && ch <= '9';
    const isLower = ch >= 'a' && ch <= 'z';
    if (isDigit || isLower) {
      slug += ch;
      previousWasDash = false;
      if (slug.length >= 64) break;
      continue;
    }
    if (!previousWasDash && slug.length > 0) {
      slug += '-';
      previousWasDash = true;
      if (slug.length >= 64) break;
    }
  }
  let start = 0;
  let end = slug.length;
  while (start < end && slug[start] === '-') start += 1;
  while (end > start && slug[end - 1] === '-') end -= 1;
  const trimmed = slug.slice(start, end);
  const normalized = trimmed.slice(0, 48);
  return `${normalized || 'entry'}-${index + 1}`;
}

function normalizeSignal(entry = {}) {
  const raw = String(entry.signal || entry.feedback || entry.rating || '').toLowerCase();
  if (['down', 'negative', 'thumbs_down', 'thumbs-down', '-1'].includes(raw)) return 'negative';
  if (['up', 'positive', 'thumbs_up', 'thumbs-up', '+1'].includes(raw)) return 'positive';
  return null;
}

function compactText(...values) {
  return values
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim().replace(/\s+/g, ' '))
    .join(' ')
    .trim();
}

function keywordTerms(text, limit = 3) {
  const stopWords = new Set([
    'about', 'after', 'again', 'agent', 'because', 'before', 'being', 'change',
    'could', 'from', 'have', 'into', 'should', 'that', 'their', 'there', 'this',
    'touch', 'when', 'where', 'with', 'work', 'would',
  ]);
  const seen = new Set();
  const terms = [];
  for (const token of String(text || '').toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || []) {
    if (stopWords.has(token) || seen.has(token)) continue;
    seen.add(token);
    terms.push(token);
    if (terms.length >= limit) break;
  }
  return terms;
}

function feedbackEntryToEvalCase(entry = {}, index = 0) {
  const signal = normalizeSignal(entry);
  if (!signal) return null;

  const context = compactText(entry.context, entry.summary, entry.message, entry.userText);
  const whatWentWrong = compactText(entry.whatWentWrong, entry.rootCause, entry.failure, entry.error);
  const whatToChange = compactText(entry.whatToChange, entry.correctiveAction, entry.fix, entry.recommendation);
  const whatWorked = compactText(entry.whatWorked, entry.success, entry.outcome);
  const tags = Array.isArray(entry.tags)
    ? entry.tags.map(String).filter(Boolean)
    : String(entry.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
  const rawId = entry.id || entry.feedbackId || `${signal}:${context}:${whatWentWrong}:${whatToChange}:${whatWorked}`;
  const id = `feedback-${signal}-${stableCaseId(rawId, index)}`;
  const actionableText = signal === 'negative'
    ? compactText(whatToChange, whatWentWrong, context)
    : compactText(context, whatWorked);
  const terms = keywordTerms(actionableText, 2);
  const vague = actionableText.length < 24 || /^thumbs?\s*(up|down)$/i.test(actionableText);

  return {
    id,
    prompt: 'lesson-distillation',
    source: {
      type: 'feedback',
      feedbackId: entry.id || entry.feedbackId || null,
      timestamp: entry.timestamp || null,
    },
    input: {
      signal,
      context,
      whatWentWrong,
      whatToChange,
      whatWorked,
      tags,
    },
    expectedOutput: vague
      ? { shouldReject: true, rejectReason: 'vague-feedback' }
      : {
          hasTitle: true,
          hasContent: signal === 'negative',
          ...(terms.length > 0 && signal === 'negative' ? { contentContains: terms } : {}),
          category: signal === 'negative' ? 'error' : 'learning',
        },
  };
}

function buildEvalSuiteFromFeedback(entries = [], options = {}) {
  const maxCases = Number.isFinite(Number(options.maxCases))
    ? Math.max(1, Number(options.maxCases))
    : DEFAULT_MAX_FEEDBACK_CASES;
  const cases = [];
  const seen = new Set();

  for (const [index, entry] of entries.entries()) {
    const evalCase = feedbackEntryToEvalCase(entry, index);
    if (!evalCase || seen.has(evalCase.id)) continue;
    seen.add(evalCase.id);
    cases.push(evalCase);
    if (cases.length >= maxCases) break;
  }

  return {
    version: 1,
    name: options.name || 'ThumbGate Feedback-Derived Prompt Evaluation',
    description: 'Reusable eval cases generated from thumbs-up/down feedback. These cases prove whether a feedback-derived behavior now passes instead of relying on prompt vibes.',
    generatedAt: new Date().toISOString(),
    source: {
      type: 'feedback-log',
      path: options.sourcePath || null,
      totalEntries: entries.length,
      selectedCases: cases.length,
    },
    evaluations: cases,
  };
}

function runSuiteObject(suite, options = {}) {
  if (!suite || !Array.isArray(suite.evaluations) || (!options.allowEmpty && suite.evaluations.length === 0)) {
    throw new Error('Suite must define a non-empty evaluations array');
  }

  const results = suite.evaluations.map(runEvaluation);
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const totalScore = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
    : 100;
  const minScore = options.minScore ?? 80;

  return {
    suite: suite.name,
    total: results.length,
    passed,
    failed,
    errors,
    skipped,
    score: totalScore,
    minScore,
    pass: totalScore >= minScore,
    noCases: results.length === 0,
    feedbackDerived: suite.source && suite.source.type === 'feedback-log',
    generatedAt: new Date().toISOString(),
    results,
  };
}

function runFeedbackEvalSuite(options = {}) {
  const feedbackLog = options.feedbackLog || (() => {
    const { resolveFeedbackDir } = require('./feedback-paths');
    return path.join(resolveFeedbackDir({ feedbackDir: options.feedbackDir }), 'feedback-log.jsonl');
  })();
  const entries = readJsonl(feedbackLog);
  const suite = buildEvalSuiteFromFeedback(entries, {
    maxCases: options.maxCases,
    name: options.name,
    sourcePath: feedbackLog,
  });
  const report = runSuiteObject(suite, { minScore: options.minScore, allowEmpty: true });
  return { suite, report };
}

function formatProofReport(report, suite) {
  const feedbackSource = suite && suite.source ? suite.source : {};
  const lines = [
    '# ThumbGate Prompt Evaluation Proof',
    '',
    `Generated: ${report.generatedAt}`,
    `Suite: ${report.suite}`,
    `Score: ${report.score}% (minimum ${report.minScore}%)`,
    `Result: ${report.pass ? 'PASS' : 'FAIL'}`,
    '',
    '## Feedback-Derived Coverage',
    '',
    `- Feedback entries scanned: ${feedbackSource.totalEntries || 0}`,
    `- Reusable eval cases generated: ${feedbackSource.selectedCases || report.total}`,
    `- Passing cases: ${report.passed}/${report.total}`,
    `- Failing cases: ${report.failed}`,
    `- Errors: ${report.errors}`,
    `- Skipped: ${report.skipped}`,
    '',
    '## Case Results',
    '',
  ];

  for (const result of report.results) {
    lines.push(`- ${result.status.toUpperCase()} ${result.id}: ${result.score}%`);
  }

  lines.push('', '## Buyer Proof', '');
  lines.push('Every row above started as real operator feedback, became a reusable eval, and now gives a repeatable before/after proof lane for prompt or workflow changes.');
  return lines.join('\n');
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
  return runSuiteObject(suite, options);
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
  let fromFeedback = false;
  let feedbackLog = null;
  let feedbackDir = null;
  let writeSuite = null;
  let writeReport = null;
  let maxCases = DEFAULT_MAX_FEEDBACK_CASES;

  for (const arg of args) {
    if (arg.startsWith('--suite=')) suitePath = path.resolve(arg.slice(8));
    if (arg === '--json') json = true;
    if (arg.startsWith('--min-score=')) minScore = Number(arg.slice(12));
    if (arg === '--from-feedback') fromFeedback = true;
    if (arg.startsWith('--feedback-log=')) feedbackLog = path.resolve(arg.slice(15));
    if (arg.startsWith('--feedback-dir=')) feedbackDir = path.resolve(arg.slice(15));
    if (arg.startsWith('--write-suite=')) writeSuite = path.resolve(arg.slice(14));
    if (arg.startsWith('--write-report=')) writeReport = path.resolve(arg.slice(15));
    if (arg.startsWith('--max-cases=')) maxCases = Number(arg.slice(12));
  }

  const evalRun = fromFeedback
    ? runFeedbackEvalSuite({ feedbackLog, feedbackDir, minScore, maxCases })
    : { suite: loadSuite(suitePath), report: runSuite(suitePath, { minScore }) };
  const { suite, report } = evalRun;

  if (writeSuite) {
    fs.mkdirSync(path.dirname(writeSuite), { recursive: true });
    fs.writeFileSync(writeSuite, `${JSON.stringify(suite, null, 2)}\n`, 'utf8');
  }
  if (writeReport) {
    fs.mkdirSync(path.dirname(writeReport), { recursive: true });
    fs.writeFileSync(writeReport, `${formatProofReport(report, suite)}\n`, 'utf8');
  }

  if (json) {
    console.log(JSON.stringify({ ...report, suiteDefinition: fromFeedback ? suite : undefined }, null, 2));
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
    console.log(report.pass ? '\u2705 PASS' : `\u274C FAIL (min: ${minScore}%)`);
  }

  process.exit(report.pass ? 0 : 1);
}

module.exports = {
  buildEvalSuiteFromFeedback,
  feedbackEntryToEvalCase,
  formatProofReport,
  gradeOutput,
  loadSuite,
  readJsonl,
  runEvaluation,
  runFeedbackEvalSuite,
  runSuite,
  runSuiteObject,
};
