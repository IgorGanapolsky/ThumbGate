#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveFeedbackDir: resolveSharedFeedbackDir } = require('./feedback-paths');

const ROOT = path.join(__dirname, '..');
const DEFAULT_CATALOG_PATH = path.join(ROOT, 'config', 'model-candidates.json');
const DEFAULT_WORKLOAD = 'pretool-gating';
const TOKENIZER_BRITTLENESS_WORKLOAD = 'tokenizer-brittleness';

const DEFAULT_TOKENIZER_BRITTLENESS_CASES = Object.freeze([
  {
    id: 'malformed-jsonl-control-char',
    input: '{"event":"gate","path":"/tmp/build\\u0000.log","ok":tru',
    expectedSignals: ['malformed-json', 'control-char', 'file-path'],
  },
  {
    id: 'unicode-confusable-secret',
    input: 'OPENAI_API_KEY=sk-prоj-confusable-value with Cyrillic о and zero\u200bwidth marker',
    expectedSignals: ['secret-like', 'unicode-confusable', 'zero-width'],
  },
  {
    id: 'stack-trace-symbols',
    input: 'TypeError: Cannot read properties of undefined\n    at run (/repo/src/api/server.js:281:17)\n    at async main (/repo/bin/cli.js:42:3)',
    expectedSignals: ['stack-trace', 'file-path', 'code-symbols'],
  },
  {
    id: 'sql-json-path',
    input: "select json_extract(payload, '$.checkout.session.id') from billing_events where customer_email like '%@example.com';",
    expectedSignals: ['sql', 'json-path', 'code-symbols'],
  },
  {
    id: 'mixed-language-code',
    input: '修复 gate-check: if (状态 !== "通过") throw new Error("阻止 deploy🚫");',
    expectedSignals: ['non-ascii', 'code-symbols', 'emoji'],
  },
]);

const COST_CLASS_SCORES = Object.freeze({
  low: 12,
  medium: 8,
  high: 4,
});

function normalizeSlug(value, fallback = '') {
  if (value === undefined || value === null || value === '') return fallback;
  const source = String(value).trim().toLowerCase();
  let normalized = '';
  let previousWasDash = false;

  for (const char of source) {
    const isAlphaNumeric = (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9');
    if (isAlphaNumeric) {
      normalized += char;
      previousWasDash = false;
      continue;
    }
    if (!previousWasDash && normalized) {
      normalized += '-';
      previousWasDash = true;
    }
  }

  if (normalized.endsWith('-')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized || fallback;
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function countCodePoints(value) {
  return Array.from(String(value || '')).length;
}

function detectTokenizerBrittlenessSignals(input) {
  const text = String(input || '');
  const signals = new Set();

  if (/[\u0000-\u001F\u007F]/u.test(text) || /\\u00[0-1][0-9a-f]/i.test(text)) signals.add('control-char');
  if (/[\u200B-\u200D\uFEFF]/u.test(text)) signals.add('zero-width');
  if (/[^\x00-\x7F]/u.test(text)) signals.add('non-ascii');
  if (/[\u0400-\u04FF]/u.test(text) && /[A-Za-z]/.test(text)) signals.add('unicode-confusable');
  if (/\p{Extended_Pictographic}/u.test(text)) signals.add('emoji');
  if (/(api[_-]?key|secret|token|password)\s*[:=]/i.test(text)) signals.add('secret-like');
  if (/\/[A-Za-z0-9._/-]+(?:\.[A-Za-z0-9]+)?(?::\d+)?/u.test(text)) signals.add('file-path');
  if (/\bat\s+(?:async\s+)?[\w$.<>-]+\s*\([^)]*:\d+:\d+\)/u.test(text) || /\b(?:TypeError|ReferenceError|SyntaxError):/u.test(text)) signals.add('stack-trace');
  if (/\b(select|insert|update|delete|from|where|join)\b/i.test(text)) signals.add('sql');
  if (/\$\.[A-Za-z0-9_[\].-]+/u.test(text)) signals.add('json-path');
  if (/[{}()[\];=<>!|&$]|\bfunction\b|\bconst\b|\blet\b|\bthrow\b/u.test(text)) signals.add('code-symbols');

  const trimmed = text.trim();
  const looksJsonLike = trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.includes('}{');
  if (looksJsonLike) {
    try {
      JSON.parse(trimmed);
    } catch {
      signals.add('malformed-json');
    }
  }

  return Array.from(signals).sort((a, b) => a.localeCompare(b));
}

function evaluateTokenizerBrittlenessCases(cases = DEFAULT_TOKENIZER_BRITTLENESS_CASES) {
  const normalizedCases = Array.isArray(cases) ? cases : DEFAULT_TOKENIZER_BRITTLENESS_CASES;
  const evaluated = normalizedCases.map((entry, index) => {
    const input = String(entry && entry.input ? entry.input : '');
    const expectedSignals = Array.isArray(entry && entry.expectedSignals) ? entry.expectedSignals : [];
    const signals = detectTokenizerBrittlenessSignals(input);
    const missingSignals = expectedSignals.filter((signal) => !signals.includes(signal));
    const byteLength = Buffer.byteLength(input, 'utf8');
    const codePointLength = countCodePoints(input);
    return {
      id: entry && entry.id ? String(entry.id) : `case-${index + 1}`,
      byteLength,
      codePointLength,
      byteToCodePointRatio: codePointLength > 0 ? Number((byteLength / codePointLength).toFixed(2)) : 0,
      expectedSignals,
      signals,
      missingSignals,
      passed: missingSignals.length === 0,
    };
  });

  const coveredSignals = new Set(evaluated.flatMap((entry) => entry.signals));
  const failed = evaluated.filter((entry) => !entry.passed);
  return {
    caseCount: evaluated.length,
    passed: failed.length === 0,
    passRate: evaluated.length > 0 ? Number(((evaluated.length - failed.length) / evaluated.length).toFixed(4)) : 1,
    coveredSignals: Array.from(coveredSignals).sort((a, b) => a.localeCompare(b)),
    cases: evaluated,
  };
}

function buildTokenizerBrittlenessPlan(options = {}) {
  const evaluation = evaluateTokenizerBrittlenessCases(options.cases);
  return {
    name: 'tokenizer-brittleness-readiness',
    evaluation,
    routingPolicy: {
      productionDefault: 'existing-token-models-with-gates',
      experimentalTarget: 'byte-level-or-tokenizer-free-models',
      allowProductionRouting: false,
      reason: 'Fast BLT is a research direction; ThumbGate should first preserve symbols, secrets, paths, JSONL structure, and stack traces through evals before adopting a byte-level runtime.',
    },
    recommendations: [
      'Keep tokenizer-brittleness fixtures in the model benchmark path for log, code, SQL, JSONL, and security workloads.',
      'Prefer tokenizer-free or byte-level candidates only after they beat current routing on symbol preservation and secret-detection recall.',
      'Do not add a BLT runtime dependency until maintained weights, serving code, and wall-clock latency evidence exist.',
    ],
  };
}

function resolveFeedbackDir(explicitDir) {
  return resolveSharedFeedbackDir({ feedbackDir: explicitDir });
}

function getModelCandidatesReportPath(feedbackDir) {
  return path.join(resolveFeedbackDir(feedbackDir), 'model-candidates-report.json');
}

function loadCatalog(catalogPath = DEFAULT_CATALOG_PATH) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  if (!catalog || typeof catalog !== 'object') {
    throw new Error('Model candidate catalog must be an object.');
  }
  if (!catalog.workloads || typeof catalog.workloads !== 'object') {
    throw new Error('Model candidate catalog requires workloads.');
  }
  if (!Array.isArray(catalog.candidates) || catalog.candidates.length === 0) {
    throw new Error('Model candidate catalog requires a non-empty candidates array.');
  }
  return catalog;
}

function listCandidates(options = {}) {
  const catalog = options.catalog || loadCatalog(options.catalogPath);
  const providerFilter = normalizeSlug(options.provider);
  const familyFilter = normalizeSlug(options.family);
  const gatewayFilter = normalizeSlug(options.gateway);

  return catalog.candidates.filter((candidate) => {
    if (providerFilter && normalizeSlug(candidate.provider) !== providerFilter) return false;
    if (familyFilter && normalizeSlug(candidate.family) !== familyFilter) return false;
    if (gatewayFilter && normalizeSlug(candidate.gateway) !== gatewayFilter) return false;
    return true;
  });
}

function scoreCandidate(candidate, workload) {
  const strengths = Array.isArray(candidate.strengths) ? candidate.strengths : [];
  const desiredStrengths = Array.isArray(workload.desiredStrengths) ? workload.desiredStrengths : [];
  const matchedStrengths = desiredStrengths.filter((strength) => strengths.includes(strength));
  const strengthScore = matchedStrengths.length * 18;
  const contextWindow = parseNumber(candidate.contextWindow, 0);
  const targetContextWindow = parseNumber(workload.targetContextWindow, 0);
  const contextScore = contextWindow >= targetContextWindow
    ? 18
    : Math.max(0, Math.round((contextWindow / Math.max(1, targetContextWindow)) * 12));
  const longContextBonus = strengths.includes('long-context') && targetContextWindow >= 128000 ? 8 : 0;
  const fastInferenceBonus = strengths.includes('fast-inference') && workload.id !== 'long-trace-review' ? 6 : 0;
  const costScore = COST_CLASS_SCORES[normalizeSlug(candidate.costClass)] || 0;
  const totalScore = strengthScore + contextScore + longContextBonus + fastInferenceBonus + costScore;

  return {
    totalScore,
    matchedStrengths,
    scoreBreakdown: {
      strengthScore,
      contextScore,
      longContextBonus,
      fastInferenceBonus,
      costScore,
    },
  };
}

function buildBenchmarkPlan(candidate, workload) {
  const benchmarkCommands = Array.isArray(workload.benchmarkCommands) ? workload.benchmarkCommands : [];
  const metrics = Array.isArray(workload.metrics) ? workload.metrics : [];
  return {
    workload: workload.id,
    suiteCount: benchmarkCommands.length,
    commands: benchmarkCommands.map((command, index) => ({
      id: `${workload.id}-${index + 1}`,
      command,
    })),
    metrics,
    candidateId: candidate.id,
    provider: candidate.provider,
  };
}

function buildReadinessNotes(candidate, workloadId) {
  const notes = [];
  if (candidate.researchOnly) {
    notes.push('research-only: benchmark target, not production routing');
  }
  if (workloadId === TOKENIZER_BRITTLENESS_WORKLOAD && !(candidate.strengths || []).includes('tokenizer-free')) {
    notes.push('requires tokenizer-brittleness eval before code/log/security routing');
  }
  return notes;
}

function recommendCandidates(options = {}) {
  const catalog = options.catalog || loadCatalog(options.catalogPath);
  const workloadId = normalizeSlug(options.workload, DEFAULT_WORKLOAD);
  const workload = catalog.workloads[workloadId];
  if (!workload) {
    throw new Error(`Unknown workload "${workloadId}". Valid workloads: ${Object.keys(catalog.workloads).join(', ')}`);
  }

  const scopedCandidates = listCandidates({
    catalog,
    provider: options.provider,
    family: options.family,
    gateway: options.gateway,
  });
  const ranked = scopedCandidates
    .map((candidate) => {
      const scoring = scoreCandidate(candidate, { ...workload, id: workloadId });
      return {
        ...candidate,
        matchedStrengths: scoring.matchedStrengths,
        score: scoring.totalScore,
        scoreBreakdown: scoring.scoreBreakdown,
        benchmarkPlan: buildBenchmarkPlan(candidate, { ...workload, id: workloadId }),
        readinessNotes: buildReadinessNotes(candidate, workloadId),
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return parseNumber(right.contextWindow, 0) - parseNumber(left.contextWindow, 0);
    });

  const maxCandidates = Math.max(1, Math.floor(parseNumber(options.maxCandidates, 3)));

  return {
    workloadId,
    workload: { id: workloadId, ...workload },
    recommended: ranked.slice(0, maxCandidates),
    considered: ranked.length,
  };
}

function buildModelCandidatesReport(options = {}) {
  const catalog = options.catalog || loadCatalog(options.catalogPath);
  const recommendation = recommendCandidates({
    catalog,
    workload: options.workload,
    provider: options.provider,
    family: options.family,
    gateway: options.gateway,
    maxCandidates: options.maxCandidates || 3,
  });

  return {
    generatedAt: new Date().toISOString(),
    workload: recommendation.workload,
    filters: {
      provider: normalizeSlug(options.provider) || null,
      family: normalizeSlug(options.family) || null,
      gateway: normalizeSlug(options.gateway) || null,
    },
    considered: recommendation.considered,
    recommended: recommendation.recommended,
    summary: recommendation.recommended.length > 0
      ? `${recommendation.recommended[0].id} is the top candidate for ${recommendation.workload.label}.`
      : 'No candidates matched the selected filters.',
    tokenizerBrittleness: recommendation.workloadId === TOKENIZER_BRITTLENESS_WORKLOAD || options.includeTokenizerBrittleness
      ? buildTokenizerBrittlenessPlan(options.tokenizerBrittleness)
      : null,
    catalogVersion: catalog.version || 1,
  };
}

function writeModelCandidatesReport(feedbackDir, options = {}) {
  const report = buildModelCandidatesReport(options);
  const reportPath = getModelCandidatesReportPath(feedbackDir);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { reportPath, report };
}

function renderModelCandidatesReport(report) {
  const lines = [
    `# Managed Model Candidates - ${report.workload.label}`,
    '',
    report.workload.summary,
    '',
    `Catalog version: ${report.catalogVersion}`,
    `Candidates considered: ${report.considered}`,
  ];
  if (report.filters.provider) lines.push(`Provider filter: ${report.filters.provider}`);
  if (report.filters.family) lines.push(`Family filter: ${report.filters.family}`);
  lines.push('');

  if (!Array.isArray(report.recommended) || report.recommended.length === 0) {
    lines.push('No candidates matched the selected filters.');
    return `${lines.join('\n')}\n`;
  }

  const recommendationLines = report.recommended.flatMap((candidate, index) => [
    `${index + 1}. ${candidate.id}`,
    `   Score: ${candidate.score}`,
    `   Context window: ${candidate.contextWindow}`,
    `   Cost class: ${candidate.costClass}`,
    `   Matched strengths: ${candidate.matchedStrengths.join(', ') || 'none'}`,
    `   Notes: ${candidate.notes}`,
    ...(Array.isArray(candidate.readinessNotes) && candidate.readinessNotes.length
      ? [`   Readiness: ${candidate.readinessNotes.join('; ')}`]
      : []),
    '   Benchmark commands:',
    ...candidate.benchmarkPlan.commands.map((entry) => `   - ${entry.command}`),
    `   Benchmark metrics: ${candidate.benchmarkPlan.metrics.join(', ')}`,
    '',
  ]);
  lines.push(...recommendationLines);

  if (report.tokenizerBrittleness) {
    lines.push('Tokenizer brittleness readiness:', '');
    lines.push(`- Cases: ${report.tokenizerBrittleness.evaluation.caseCount}`);
    lines.push(`- Pass rate: ${report.tokenizerBrittleness.evaluation.passRate}`);
    lines.push(`- Production routing: ${report.tokenizerBrittleness.routingPolicy.allowProductionRouting ? 'allowed' : 'blocked until benchmarked'}`);
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

module.exports = {
  DEFAULT_CATALOG_PATH,
  DEFAULT_TOKENIZER_BRITTLENESS_CASES,
  DEFAULT_WORKLOAD,
  TOKENIZER_BRITTLENESS_WORKLOAD,
  buildTokenizerBrittlenessPlan,
  buildBenchmarkPlan,
  buildModelCandidatesReport,
  detectTokenizerBrittlenessSignals,
  evaluateTokenizerBrittlenessCases,
  getModelCandidatesReportPath,
  listCandidates,
  loadCatalog,
  recommendCandidates,
  renderModelCandidatesReport,
  resolveFeedbackDir,
  scoreCandidate,
  writeModelCandidatesReport,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  const report = buildModelCandidatesReport();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
