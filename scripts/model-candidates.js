#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveFeedbackDir: resolveSharedFeedbackDir } = require('./feedback-paths');

const ROOT = path.join(__dirname, '..');
const DEFAULT_CATALOG_PATH = path.join(ROOT, 'config', 'model-candidates.json');
const DEFAULT_WORKLOAD = 'pretool-gating';

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
    '   Benchmark commands:',
    ...candidate.benchmarkPlan.commands.map((entry) => `   - ${entry.command}`),
    `   Benchmark metrics: ${candidate.benchmarkPlan.metrics.join(', ')}`,
    '',
  ]);
  lines.push(...recommendationLines);

  return `${lines.join('\n').trimEnd()}\n`;
}

module.exports = {
  DEFAULT_CATALOG_PATH,
  DEFAULT_WORKLOAD,
  buildBenchmarkPlan,
  buildModelCandidatesReport,
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
