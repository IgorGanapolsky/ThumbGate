#!/usr/bin/env node
/**
 * RLHF Feedback Loop (local-first)
 *
 * Pipeline:
 *   thumbs up/down -> resolve action -> validate memory -> append logs
 *   -> compute analytics -> generate prevention rules
 */

const fs = require('fs');
const path = require('path');
const {
  resolveFeedbackAction,
  prepareForStorage,
} = require('./feedback-schema');
const {
  buildRubricEvaluation,
} = require('./rubric-engine');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_FEEDBACK_DIR = path.join(PROJECT_ROOT, '.claude', 'memory', 'feedback');

function getFeedbackPaths() {
  const feedbackDir = process.env.RLHF_FEEDBACK_DIR || DEFAULT_FEEDBACK_DIR;
  return {
    FEEDBACK_DIR: feedbackDir,
    FEEDBACK_LOG_PATH: path.join(feedbackDir, 'feedback-log.jsonl'),
    MEMORY_LOG_PATH: path.join(feedbackDir, 'memory-log.jsonl'),
    SUMMARY_PATH: path.join(feedbackDir, 'feedback-summary.json'),
    PREVENTION_RULES_PATH: path.join(feedbackDir, 'prevention-rules.md'),
  };
}

function getContextFsModule() {
  try {
    return require('./contextfs');
  } catch {
    return null;
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function appendJSONL(filePath, record) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeSignal(signal) {
  const value = String(signal || '').trim().toLowerCase();
  if (['up', 'thumbsup', 'thumbs-up', 'positive', 'good'].includes(value)) return 'positive';
  if (['down', 'thumbsdown', 'thumbs-down', 'negative', 'bad'].includes(value)) return 'negative';
  if (value === 'thumbs_up') return 'positive';
  if (value === 'thumbs_down') return 'negative';
  return null;
}

function parseOptionalObject(input, name) {
  if (input == null) return {};
  if (typeof input === 'object' && !Array.isArray(input)) return input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return {};
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${name} must be an object`);
    }
    return parsed;
  }
  throw new Error(`${name} must be object or JSON string`);
}

function loadSummary() {
  const { SUMMARY_PATH } = getFeedbackPaths();
  if (!fs.existsSync(SUMMARY_PATH)) {
    return {
      total: 0,
      positive: 0,
      negative: 0,
      accepted: 0,
      rejected: 0,
      lastUpdated: null,
    };
  }
  return JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf-8'));
}

function saveSummary(summary) {
  const { SUMMARY_PATH } = getFeedbackPaths();
  ensureDir(path.dirname(SUMMARY_PATH));
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
}

function captureFeedback(params) {
  const { FEEDBACK_LOG_PATH, MEMORY_LOG_PATH } = getFeedbackPaths();
  const signal = normalizeSignal(params.signal);
  if (!signal) {
    return {
      accepted: false,
      reason: `Invalid signal "${params.signal}". Use up/down or positive/negative.`,
    };
  }

  const tags = Array.isArray(params.tags)
    ? params.tags
    : String(params.tags || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

  let rubricEvaluation = null;
  try {
    if (params.rubricScores != null || params.guardrails != null) {
      rubricEvaluation = buildRubricEvaluation({
        rubricScores: params.rubricScores,
        guardrails: parseOptionalObject(params.guardrails, 'guardrails'),
      });
    }
  } catch (err) {
    return {
      accepted: false,
      reason: `Invalid rubric payload: ${err.message}`,
    };
  }

  const action = resolveFeedbackAction({
    signal,
    context: params.context || '',
    whatWentWrong: params.whatWentWrong,
    whatToChange: params.whatToChange,
    whatWorked: params.whatWorked,
    tags,
    rubricEvaluation,
  });

  const now = new Date().toISOString();
  const feedbackEvent = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    signal,
    context: params.context || '',
    whatWentWrong: params.whatWentWrong || null,
    whatToChange: params.whatToChange || null,
    whatWorked: params.whatWorked || null,
    tags,
    skill: params.skill || null,
    rubric: rubricEvaluation
      ? {
        rubricId: rubricEvaluation.rubricId,
        weightedScore: rubricEvaluation.weightedScore,
        failingCriteria: rubricEvaluation.failingCriteria,
        failingGuardrails: rubricEvaluation.failingGuardrails,
        judgeDisagreements: rubricEvaluation.judgeDisagreements,
        promotionEligible: rubricEvaluation.promotionEligible,
      }
      : null,
    actionType: action.type,
    actionReason: action.reason || null,
    timestamp: now,
  };

  const summary = loadSummary();
  summary.total += 1;
  summary[signal] += 1;

  if (action.type === 'no-action') {
    summary.rejected += 1;
    summary.lastUpdated = now;
    saveSummary(summary);
    appendJSONL(FEEDBACK_LOG_PATH, feedbackEvent);
    return {
      accepted: false,
      reason: action.reason,
      feedbackEvent,
    };
  }

  const prepared = prepareForStorage(action.memory);
  if (!prepared.ok) {
    summary.rejected += 1;
    summary.lastUpdated = now;
    saveSummary(summary);
    appendJSONL(FEEDBACK_LOG_PATH, {
      ...feedbackEvent,
      validationIssues: prepared.issues,
    });
    return {
      accepted: false,
      reason: `Schema validation failed: ${prepared.issues.join('; ')}`,
      feedbackEvent,
      issues: prepared.issues,
    };
  }

  const memoryRecord = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ...prepared.memory,
    sourceFeedbackId: feedbackEvent.id,
    timestamp: now,
  };

  appendJSONL(FEEDBACK_LOG_PATH, feedbackEvent);
  appendJSONL(MEMORY_LOG_PATH, memoryRecord);

  const contextFs = getContextFsModule();
  if (contextFs && typeof contextFs.registerFeedback === 'function') {
    try {
      contextFs.registerFeedback(feedbackEvent, memoryRecord);
    } catch {
      // Non-critical; feedback remains in primary logs
    }
  }

  summary.accepted += 1;
  summary.lastUpdated = now;
  saveSummary(summary);

  return {
    accepted: true,
    feedbackEvent,
    memoryRecord,
  };
}

function analyzeFeedback(logPath) {
  const { FEEDBACK_LOG_PATH } = getFeedbackPaths();
  const entries = readJSONL(logPath || FEEDBACK_LOG_PATH);
  const skills = {};
  const tags = {};
  const rubricCriteria = {};
  let rubricSamples = 0;
  let blockedPromotions = 0;

  let totalPositive = 0;
  let totalNegative = 0;

  for (const entry of entries) {
    if (entry.signal === 'positive') totalPositive++;
    if (entry.signal === 'negative') totalNegative++;

    if (entry.skill) {
      if (!skills[entry.skill]) skills[entry.skill] = { positive: 0, negative: 0, total: 0 };
      skills[entry.skill][entry.signal] += 1;
      skills[entry.skill].total += 1;
    }

    for (const tag of entry.tags || []) {
      if (!tags[tag]) tags[tag] = { positive: 0, negative: 0, total: 0 };
      tags[tag][entry.signal] += 1;
      tags[tag].total += 1;
    }

    if (entry.actionType === 'no-action' && typeof entry.actionReason === 'string' && entry.actionReason.includes('Rubric gate')) {
      blockedPromotions += 1;
    }

    if (entry.rubric && entry.rubric.weightedScore != null) {
      rubricSamples += 1;
    }

    if (entry.rubric && Array.isArray(entry.rubric.failingCriteria)) {
      for (const criterion of entry.rubric.failingCriteria) {
        if (!rubricCriteria[criterion]) rubricCriteria[criterion] = { failures: 0 };
        rubricCriteria[criterion].failures += 1;
      }
    }
  }

  const total = totalPositive + totalNegative;
  const approvalRate = total > 0 ? Math.round((totalPositive / total) * 1000) / 1000 : 0;
  const recent = entries.slice(-20);
  const recentPos = recent.filter((e) => e.signal === 'positive').length;
  const recentRate = recent.length > 0 ? Math.round((recentPos / recent.length) * 1000) / 1000 : 0;

  const recommendations = [];

  for (const [skill, stat] of Object.entries(skills)) {
    const negRate = stat.total > 0 ? stat.negative / stat.total : 0;
    if (stat.total >= 3 && negRate >= 0.5) {
      recommendations.push(`IMPROVE skill '${skill}' (${stat.negative}/${stat.total} negative)`);
    }
  }

  for (const [tag, stat] of Object.entries(tags)) {
    const posRate = stat.total > 0 ? stat.positive / stat.total : 0;
    if (stat.total >= 3 && posRate >= 0.8) {
      recommendations.push(`REUSE pattern '${tag}' (${stat.positive}/${stat.total} positive)`);
    }
  }

  if (recent.length >= 10 && recentRate < approvalRate - 0.1) {
    recommendations.push('DECLINING trend in last 20 signals; tighten verification before response.');
  }

  return {
    total,
    totalPositive,
    totalNegative,
    approvalRate,
    recentRate,
    skills,
    tags,
    rubric: {
      samples: rubricSamples,
      blockedPromotions,
      failingCriteria: rubricCriteria,
    },
    recommendations,
  };
}

function buildPreventionRules(minOccurrences = 2) {
  const { MEMORY_LOG_PATH } = getFeedbackPaths();
  const memories = readJSONL(MEMORY_LOG_PATH).filter((m) => m.category === 'error');
  if (memories.length === 0) {
    return '# Prevention Rules\n\nNo mistake memories recorded yet.';
  }

  const buckets = {};
  const rubricBuckets = {};
  for (const m of memories) {
    const key = (m.tags || []).find((t) => !['feedback', 'negative', 'positive'].includes(t)) || 'general';
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(m);

    const failed = m.rubricSummary && Array.isArray(m.rubricSummary.failingCriteria)
      ? m.rubricSummary.failingCriteria
      : [];
    failed.forEach((criterion) => {
      if (!rubricBuckets[criterion]) rubricBuckets[criterion] = [];
      rubricBuckets[criterion].push(m);
    });
  }

  const lines = ['# Prevention Rules', '', 'Generated from negative feedback memories.'];

  Object.entries(buckets)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([domain, items]) => {
      if (items.length < minOccurrences) return;
      const latest = items[items.length - 1];
      const avoid = (latest.content || '').split('\n').find((l) => l.toLowerCase().startsWith('how to avoid:')) || 'How to avoid: Investigate and prevent recurrence';
      lines.push('');
      lines.push(`## ${domain}`);
      lines.push(`- Recurrence count: ${items.length}`);
      lines.push(`- Rule: ${avoid.replace(/^How to avoid:\s*/i, '')}`);
      lines.push(`- Latest mistake: ${latest.title}`);
    });

  const rubricEntries = Object.entries(rubricBuckets).sort((a, b) => b[1].length - a[1].length);
  if (rubricEntries.length > 0) {
    lines.push('');
    lines.push('## Rubric Failure Dimensions');
    rubricEntries.forEach(([criterion, items]) => {
      if (items.length < minOccurrences) return;
      lines.push(`- ${criterion}: ${items.length} failures`);
    });
  }

  if (lines.length === 3) {
    lines.push('');
    lines.push(`No domain has reached the threshold (${minOccurrences}) yet.`);
  }

  return lines.join('\n');
}

function writePreventionRules(filePath, minOccurrences = 2) {
  const { PREVENTION_RULES_PATH } = getFeedbackPaths();
  const outPath = filePath || PREVENTION_RULES_PATH;
  const markdown = buildPreventionRules(minOccurrences);
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, `${markdown}\n`);

  const contextFs = getContextFsModule();
  if (contextFs && typeof contextFs.registerPreventionRules === 'function') {
    try {
      contextFs.registerPreventionRules(markdown, { minOccurrences, outputPath: outPath });
    } catch {
      // Non-critical
    }
  }
  return { path: outPath, markdown };
}

function feedbackSummary(recentN = 20) {
  const { FEEDBACK_LOG_PATH } = getFeedbackPaths();
  const entries = readJSONL(FEEDBACK_LOG_PATH);
  if (entries.length === 0) {
    return '## Feedback Summary\nNo feedback recorded yet.';
  }

  const recent = entries.slice(-recentN);
  const positive = recent.filter((e) => e.signal === 'positive').length;
  const negative = recent.filter((e) => e.signal === 'negative').length;
  const pct = Math.round((positive / recent.length) * 100);

  const analysis = analyzeFeedback(FEEDBACK_LOG_PATH);

  const lines = [
    `## Feedback Summary (last ${recent.length})`,
    `- Positive: ${positive}`,
    `- Negative: ${negative}`,
    `- Approval: ${pct}%`,
    `- Overall approval: ${Math.round(analysis.approvalRate * 100)}%`,
  ];

  if (analysis.recommendations.length > 0) {
    lines.push('- Recommendations:');
    analysis.recommendations.slice(0, 5).forEach((r) => lines.push(`  - ${r}`));
  }

  return lines.join('\n');
}

function parseArgs(argv) {
  const args = {};
  argv.forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length > 0 ? rest.join('=') : true;
  });
  return args;
}

function runCli() {
  const args = parseArgs(process.argv.slice(2));

  if (args.test) {
    runTests();
    return;
  }

  if (args.capture) {
    const result = captureFeedback({
      signal: args.signal,
      context: args.context || '',
      whatWentWrong: args['what-went-wrong'],
      whatToChange: args['what-to-change'],
      whatWorked: args['what-worked'],
      rubricScores: args['rubric-scores'],
      guardrails: args.guardrails,
      tags: args.tags,
      skill: args.skill,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.accepted ? 0 : 2);
  }

  if (args.analyze) {
    console.log(JSON.stringify(analyzeFeedback(), null, 2));
    return;
  }

  if (args.summary) {
    console.log(feedbackSummary(Number(args.recent || 20)));
    return;
  }

  if (args.rules) {
    const result = writePreventionRules(args.output, Number(args.min || 2));
    console.log(`Wrote prevention rules to ${result.path}`);
    return;
  }

  console.log(`Usage:
  node scripts/feedback-loop.js --capture --signal=up --context="..." --tags="verification,fix"
  node scripts/feedback-loop.js --capture --signal=up --context="..." --rubric-scores='[{\"criterion\":\"correctness\",\"score\":4}]' --guardrails='{\"testsPassed\":true}'
  node scripts/feedback-loop.js --analyze
  node scripts/feedback-loop.js --summary --recent=20
  node scripts/feedback-loop.js --rules [--min=2] [--output=path]
  node scripts/feedback-loop.js --test`);
}

function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      passed++;
      console.log(`  PASS ${name}`);
    } else {
      failed++;
      console.log(`  FAIL ${name}`);
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rlhf-loop-test-'));
  const localFeedbackLog = path.join(tmpDir, 'feedback-log.jsonl');
  process.env.RLHF_FEEDBACK_DIR = tmpDir;

  appendJSONL(localFeedbackLog, { signal: 'positive', tags: ['testing'], skill: 'verify' });
  appendJSONL(localFeedbackLog, { signal: 'negative', tags: ['testing'], skill: 'verify' });
  appendJSONL(localFeedbackLog, { signal: 'positive', tags: ['testing'], skill: 'verify' });

  const stats = analyzeFeedback(localFeedbackLog);
  assert(stats.total === 3, 'analyzeFeedback counts total events');
  assert(stats.totalPositive === 2, 'analyzeFeedback counts positives');
  assert(stats.totalNegative === 1, 'analyzeFeedback counts negatives');
  assert(stats.tags.testing.total === 3, 'analyzeFeedback tracks tags');

  const good = captureFeedback({
    signal: 'up',
    context: 'Ran tests and included output',
    whatWorked: 'Evidence-first flow',
    tags: ['verification', 'testing'],
    skill: 'executor',
  });
  assert(good.accepted, 'captureFeedback accepts valid positive feedback');

  const blocked = captureFeedback({
    signal: 'up',
    context: 'Looks good',
    whatWorked: 'Skipped proof',
    tags: ['verification'],
    rubricScores: JSON.stringify([
      { criterion: 'verification_evidence', score: 5, judge: 'judge-a' },
      { criterion: 'verification_evidence', score: 2, judge: 'judge-b', evidence: 'no test output present' },
    ]),
    guardrails: JSON.stringify({
      testsPassed: false,
      pathSafety: true,
      budgetCompliant: true,
    }),
  });
  assert(!blocked.accepted, 'captureFeedback blocks unsafe positive promotion via rubric gate');

  const bad = captureFeedback({ signal: 'down' });
  assert(!bad.accepted, 'captureFeedback rejects vague negative feedback');

  const summary = feedbackSummary(5);
  assert(summary.includes('Feedback Summary'), 'feedbackSummary returns text output');

  const rules = writePreventionRules(path.join(tmpDir, 'rules.md'), 1);
  assert(rules.markdown.includes('# Prevention Rules'), 'writePreventionRules writes markdown rules');
  const postStats = analyzeFeedback(path.join(tmpDir, 'feedback-log.jsonl'));
  assert(postStats.rubric.blockedPromotions >= 1, 'analyzeFeedback tracks blocked rubric promotions');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.RLHF_FEEDBACK_DIR;
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = {
  captureFeedback,
  analyzeFeedback,
  buildPreventionRules,
  writePreventionRules,
  feedbackSummary,
  readJSONL,
  getFeedbackPaths,
  get FEEDBACK_LOG_PATH() {
    return getFeedbackPaths().FEEDBACK_LOG_PATH;
  },
  get MEMORY_LOG_PATH() {
    return getFeedbackPaths().MEMORY_LOG_PATH;
  },
  get SUMMARY_PATH() {
    return getFeedbackPaths().SUMMARY_PATH;
  },
  get PREVENTION_RULES_PATH() {
    return getFeedbackPaths().PREVENTION_RULES_PATH;
  },
};

if (require.main === module) {
  runCli();
}
