#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PACKAGE_PATH = path.join(__dirname, '..', 'package.json');
const DEFAULT_OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'marketing');
const KNOWN_REPOS = Object.freeze({
  '@anthropic-ai/sdk': 'anthropics/anthropic-sdk-typescript',
  '@google/genai': 'googleapis/js-genai',
  '@huggingface/transformers': 'huggingface/transformers.js',
  '@lancedb/lancedb': 'lancedb/lancedb',
  'apache-arrow': 'apache/arrow-js',
  'better-sqlite3': 'WiseLibs/better-sqlite3',
  dotenv: 'motdotla/dotenv',
  'playwright-core': 'microsoft/playwright',
  protobufjs: 'protobufjs/protobuf.js',
  stripe: 'stripe/stripe-node',
  '@changesets/changelog-github': 'changesets/changesets',
  '@changesets/cli': 'changesets/changesets',
  c8: 'bcoe/c8',
  undici: 'nodejs/undici',
});

const BOUNTY_KEYWORDS = [
  'bug bounty',
  'bounty',
  'good first issue',
  'help wanted',
  'security',
  'repro',
  'regression',
  'docs',
  'typescript',
  'test failure',
];

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .split('')
    .map((char) => (/[a-z0-9]/.test(char) ? char : '-'))
    .join('')
    .split('-')
    .filter(Boolean)
    .join('-');
}

function loadPackage(packagePath = DEFAULT_PACKAGE_PATH) {
  return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
}

function dependencyNames(pkg = {}) {
  return [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
  ].sort((a, b) => a.localeCompare(b));
}

function repoFromDependency(name) {
  return KNOWN_REPOS[name] || '';
}

function buildIssueSearchQueries(repo) {
  return [
    `repo:${repo} is:issue is:open label:"good first issue"`,
    `repo:${repo} is:issue is:open label:"help wanted"`,
    `repo:${repo} is:issue is:open bounty OR "bug bounty"`,
    `repo:${repo} is:issue is:open regression test failure`,
  ];
}

function scoreOpportunity(depName, repo, options = {}) {
  let score = 0;
  const reasons = [];
  if (repo) {
    score += 20;
    reasons.push('known upstream repository');
  }
  if (/sdk|genai|stripe|playwright|lancedb|transformers|sqlite|undici/i.test(depName)) {
    score += 20;
    reasons.push('high product adjacency for agent tooling');
  }
  if (/anthropic|google|huggingface|stripe|microsoft|nodejs/i.test(repo)) {
    score += 15;
    reasons.push('large ecosystem visibility');
  }
  if (options.includeBounties) {
    score += 10;
    reasons.push('bounty search enabled');
  }
  if (/docs|changelog|dotenv|c8/i.test(depName)) {
    score += 8;
    reasons.push('lower-risk contribution surface');
  }
  return { score, reasons };
}

function buildOpportunity(depName, options = {}) {
  const repo = repoFromDependency(depName);
  const scoring = scoreOpportunity(depName, repo, options);
  const repoUrl = repo ? `https://github.com/${repo}` : '';
  return {
    id: slugify(`${depName}-${repo || 'unknown'}`),
    dependency: depName,
    repo,
    repoUrl,
    score: scoring.score,
    reasons: scoring.reasons,
    issueSearchQueries: repo ? buildIssueSearchQueries(repo) : [],
    bountyQueries: repo ? [
      `repo:${repo} is:issue is:open "bug bounty"`,
      `repo:${repo} is:issue is:open bounty security`,
    ] : [],
    safeFixLanes: [
      'reproduce issue locally before claiming it is fixed',
      'prefer docs, tests, typed edge cases, and minimal bug fixes',
      'open one focused PR per issue after reading contribution guidelines',
      'include ThumbGate only as a transparent proof note when relevant, never as hidden promotion',
    ],
    prReadinessGates: [
      'issue linked or maintainer pain clearly documented',
      'local reproduction or failing test captured',
      'fix is minimal and scoped to the issue',
      'tests or verification output attached',
      'no bounty, security, or maintainer-policy claim without source link',
    ],
    outreachDraft: repo
      ? `I found this while using ${depName} in ThumbGate. I reproduced the issue, added a minimal fix with tests, and kept the PR scoped to the maintainer's issue.`
      : '',
  };
}

function buildOssPrOpportunityScoutPlan(rawOptions = {}) {
  const packagePath = normalizeText(rawOptions.packagePath || rawOptions['package-path']) || DEFAULT_PACKAGE_PATH;
  const pkg = loadPackage(packagePath);
  const explicitDeps = splitList(rawOptions.dependencies || rawOptions.deps);
  const includeBounties = rawOptions.includeBounties !== false && rawOptions['include-bounties'] !== false;
  const maxRepos = Math.max(1, Number.parseInt(String(rawOptions.maxRepos || rawOptions['max-repos'] || 12), 10) || 12);
  const deps = explicitDeps.length ? explicitDeps : dependencyNames(pkg);
  const opportunities = deps
    .map((dep) => buildOpportunity(dep, { includeBounties }))
    .filter((opportunity) => opportunity.repo)
    .sort((left, right) => right.score - left.score || left.dependency.localeCompare(right.dependency))
    .slice(0, maxRepos);

  return {
    name: 'thumbgate-oss-pr-opportunity-scout',
    packagePath,
    generatedAt: new Date().toISOString(),
    status: opportunities.length ? 'ready_to_scout' : 'needs_repo_mapping',
    summary: {
      dependencyCount: deps.length,
      mappedRepos: opportunities.length,
      includeBounties,
      topRepos: opportunities.slice(0, 5).map((item) => item.repo),
    },
    searchProtocol: {
      issueLabels: ['good first issue', 'help wanted', 'bug', 'regression', 'documentation', 'security'],
      bountyKeywords: BOUNTY_KEYWORDS,
      antiSpamRule: 'Do not open a PR unless the issue is reproduced, the fix is minimal, and verification output is attached.',
      promotionRule: 'Mention ThumbGate only as the toolchain context or proof discipline, not as unrelated advertising.',
    },
    opportunities,
    automationCommands: [
      'gh issue list --repo <owner/repo> --label "good first issue" --state open',
      'gh issue list --repo <owner/repo> --search "bounty OR bug bounty OR regression"',
      'gh repo fork <owner/repo> --clone',
      'npx thumbgate require-evidence-for-claim --claim "fix is ready" before opening the PR',
    ],
    marketingAngle: {
      headline: 'ThumbGate promotes itself by shipping proof-backed fixes, not drive-by ads.',
      subhead: 'Find upstream repos we actually use, fix real issues with tests, and let maintainers see the agent-governance workflow in the PR evidence.',
      replyDraft: 'This is a strong promotion loop as long as it is gated: use repos ThumbGate really depends on, fix issues maintainers already care about, attach reproduction plus tests, and make ThumbGate visible through the quality of the PR rather than a pitch.',
    },
  };
}

function formatOssPrOpportunityScoutPlan(report) {
  const lines = [
    '',
    'ThumbGate OSS PR Opportunity Scout',
    '-'.repeat(35),
    `Status      : ${report.status}`,
    `Package     : ${report.packagePath}`,
    `Mapped repos: ${report.summary.mappedRepos}`,
    '',
    'Top opportunities:',
  ];
  for (const opportunity of report.opportunities.slice(0, 10)) {
    lines.push(`  - ${opportunity.repo} (${opportunity.dependency}) score=${opportunity.score}`);
    lines.push(`    Search: ${opportunity.issueSearchQueries[0]}`);
  }
  lines.push('', 'PR gates:');
  for (const gate of report.searchProtocol.antiSpamRule ? [report.searchProtocol.antiSpamRule] : []) {
    lines.push(`  - ${gate}`);
  }
  lines.push('', `Reply draft: ${report.marketingAngle.replyDraft}`, '');
  return `${lines.join('\n')}\n`;
}

function writeOssPrOpportunityScoutPack(outputDir = DEFAULT_OUTPUT_DIR, options = {}) {
  const report = buildOssPrOpportunityScoutPlan(options);
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'oss-pr-opportunity-scout.json');
  const markdownPath = path.join(outputDir, 'oss-pr-opportunity-scout.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, formatOssPrOpportunityScoutPlan(report));
  return { report, jsonPath, markdownPath };
}

module.exports = {
  KNOWN_REPOS,
  buildIssueSearchQueries,
  buildOpportunity,
  buildOssPrOpportunityScoutPlan,
  formatOssPrOpportunityScoutPlan,
  writeOssPrOpportunityScoutPack,
};

function isCliInvocation(argv = process.argv) {
  return Boolean(argv[1] && path.resolve(argv[1]) === __filename);
}

if (isCliInvocation()) {
  const { jsonPath, markdownPath } = writeOssPrOpportunityScoutPack();
  console.log(JSON.stringify({ jsonPath, markdownPath }, null, 2));
}
