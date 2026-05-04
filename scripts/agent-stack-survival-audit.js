#!/usr/bin/env node
'use strict';

/**
 * Agent Stack Survival Audit
 *
 * High-ROI response to the "AI scaffolding layer is collapsing" thesis:
 * keep ThumbGate thin, context-rich, model-agnostic, sandboxed, and easy to
 * throw away or swap as frontier model/tool patterns change.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

const HEAVY_SCAFFOLDING_DEPS = [
  'langchain',
  '@langchain/core',
  '@langchain/community',
  'llamaindex',
  'llama-index',
  'crew-ai',
  'autogen',
  'semantic-kernel',
];

const CONTEXT_MOAT_FILES = [
  'scripts/document-intake.js',
  'scripts/contextfs.js',
  'scripts/context-engine.js',
  'scripts/lesson-retrieval.js',
  'scripts/memalign.js',
  'config/mcp-allowlists.json',
];

const SANDBOX_FILES = [
  'scripts/cloudflare-dynamic-sandbox.js',
  'scripts/docker-sandbox-planner.js',
  'config/gates/computer-use.json',
  'config/gates/code-edit.json',
];

function buildStackSurvivalAudit(options = {}) {
  const root = path.resolve(options.root || REPO_ROOT);
  const packageJson = readJson(path.join(root, 'package.json'));
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
  };
  const dependencyNames = Object.keys(dependencies || {});
  const adapterDirs = listDirs(path.join(root, 'adapters'));
  const modelCandidates = readJson(path.join(root, 'config', 'model-candidates.json'));
  const guideFiles = listFiles(path.join(root, 'public', 'guides'));

  const heavyDeps = dependencyNames.filter((dep) => HEAVY_SCAFFOLDING_DEPS.includes(dep));
  const contextFilesPresent = CONTEXT_MOAT_FILES.filter((file) => exists(root, file));
  const sandboxFilesPresent = SANDBOX_FILES.filter((file) => exists(root, file));
  const contextGuides = guideFiles.filter((file) => /context|guardrail|pre-action|agent|workflow/i.test(file));
  const candidateCount = Object.keys(modelCandidates.candidates || modelCandidates || {}).length;

  const categories = {
    contextMoat: scoreCategory({
      score: contextFilesPresent.length / CONTEXT_MOAT_FILES.length,
      evidence: contextFilesPresent,
      recommendation: 'Prioritize parsers, context packs, lesson retrieval, and evidence surfaces over custom workflow scaffolding.',
    }),
    modularity: scoreCategory({
      score: Math.min(1, (adapterDirs.length / 6) * 0.55 + (candidateCount / 4) * 0.45),
      evidence: [
        `${adapterDirs.length} adapter directories`,
        `${candidateCount} model candidates`,
      ],
      recommendation: 'Keep providers swappable through adapters, MCP, and model routing rather than hard-coded orchestration.',
    }),
    sandboxReadiness: scoreCategory({
      score: sandboxFilesPresent.length / SANDBOX_FILES.length,
      evidence: sandboxFilesPresent,
      recommendation: 'Preserve agent-plus-sandbox controls for code edits, computer use, and risky workflow execution.',
    }),
    scaffoldingThinness: scoreCategory({
      score: heavyDeps.length === 0 ? 1 : Math.max(0, 1 - (heavyDeps.length * 0.2)),
      evidence: heavyDeps.length ? heavyDeps : ['no heavy orchestration framework dependencies detected'],
      recommendation: heavyDeps.length
        ? 'Reduce framework lock-in; keep orchestration disposable and context/gates durable.'
        : 'Good: no obvious heavy orchestration dependency lock-in in package.json.',
    }),
    aiSearchContext: scoreCategory({
      score: Math.min(1, contextGuides.length / 8),
      evidence: contextGuides.slice(0, 12),
      recommendation: 'Continue publishing context-rich guides that let AI search explain why ThumbGate survives stack churn.',
    }),
  };

  const overallScore = round(Object.values(categories).reduce((sum, category) => sum + category.score, 0) / Object.keys(categories).length);
  return {
    generatedAt: new Date().toISOString(),
    overallScore,
    verdict: overallScore >= 0.85 ? 'survives' : overallScore >= 0.65 ? 'watch' : 'fragile',
    categories,
    highRoiActions: buildHighRoiActions(categories),
  };
}

function buildHighRoiActions(categories = {}) {
  const actions = [];
  for (const [name, category] of Object.entries(categories)) {
    if (category.score >= 0.85) continue;
    actions.push({
      area: name,
      priority: category.score < 0.6 ? 'high' : 'medium',
      action: category.recommendation,
    });
  }
  if (actions.length === 0) {
    actions.push({
      area: 'stack',
      priority: 'maintenance',
      action: 'Keep ThumbGate thin: invest new effort in context extraction, evidence, gates, and adapters.',
    });
  }
  return actions;
}

function formatStackSurvivalReport(audit = {}) {
  const lines = [
    '# Agent Stack Survival Audit',
    '',
    `Generated: ${audit.generatedAt}`,
    `Verdict: ${audit.verdict}`,
    `Overall score: ${audit.overallScore}`,
    '',
    '## Categories',
    '',
  ];

  for (const [name, category] of Object.entries(audit.categories || {})) {
    lines.push(`- ${name}: ${category.score} (${category.status})`);
  }
  lines.push('', '## High-ROI Actions', '');
  for (const action of audit.highRoiActions || []) {
    lines.push(`- ${action.priority}: ${action.action}`);
  }
  lines.push('', 'Positioning: ThumbGate should sell durable context, evidence, and pre-action gates, not brittle orchestration scaffolding.', '');
  return `${lines.join('\n')}\n`;
}

function scoreCategory({ score, evidence, recommendation }) {
  const rounded = round(score);
  return {
    score: rounded,
    status: rounded >= 0.85 ? 'strong' : rounded >= 0.65 ? 'watch' : 'weak',
    evidence,
    recommendation,
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function exists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function listDirs(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function listFiles(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
}

function isCliInvocation(argv = process.argv) {
  return Boolean(argv[1] && path.resolve(argv[1]) === __filename);
}

if (isCliInvocation()) {
  const command = process.argv[2] || 'report';
  const audit = buildStackSurvivalAudit();
  if (command === 'json') {
    console.log(JSON.stringify(audit, null, 2));
  } else if (command === 'report') {
    console.log(formatStackSurvivalReport(audit));
  } else {
    console.error(`Unknown command: ${command}. Use: report, json`);
    process.exit(1);
  }
}

module.exports = {
  HEAVY_SCAFFOLDING_DEPS,
  buildStackSurvivalAudit,
  formatStackSurvivalReport,
};
