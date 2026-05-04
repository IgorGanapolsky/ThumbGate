#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'docs', 'marketing');

const DEFAULT_REPO_OVERRIDES = Object.freeze({
  '@anthropic-ai/sdk': 'anthropics/anthropic-sdk-typescript',
  '@google/genai': 'googleapis/js-genai',
  '@huggingface/transformers': 'huggingface/transformers.js',
  '@lancedb/lancedb': 'lancedb/lancedb',
  'apache-arrow': 'apache/arrow',
  'better-sqlite3': 'WiseLibs/better-sqlite3',
  dotenv: 'motdotla/dotenv',
  'playwright-core': 'microsoft/playwright',
  protobufjs: 'protobufjs/protobuf.js',
  stripe: 'stripe/stripe-node',
  '@changesets/cli': 'changesets/changesets',
  '@changesets/changelog-github': 'changesets/changesets',
  c8: 'bcoe/c8',
  undici: 'nodejs/undici',
});

function normalizeRepo(value) {
  if (!value) return '';
  let source = String(value).trim();
  source = source.replace(/^git\+/, '').replace(/\.git$/, '');
  source = source.replace(/^https:\/\/github\.com\//i, '');
  source = source.replace(/^git@github\.com:/i, '');
  const match = source.match(/^([^/\s]+)\/([^/\s#?]+)/);
  return match ? `${match[1]}/${match[2]}` : '';
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function listDirectPackages(root = ROOT) {
  const pkg = readJson(path.join(root, 'package.json'), {});
  const runtime = Object.keys(pkg.dependencies || {}).map((name) => ({ name, dependencyType: 'runtime' }));
  const dev = Object.keys(pkg.devDependencies || {}).map((name) => ({ name, dependencyType: 'dev' }));
  const seen = new Set();
  return [...runtime, ...dev].filter((entry) => {
    if (seen.has(entry.name)) return false;
    seen.add(entry.name);
    return true;
  });
}

function resolvePackageRepo(name, options = {}) {
  const overrides = { ...DEFAULT_REPO_OVERRIDES, ...(options.repoOverrides || {}) };
  if (overrides[name]) return overrides[name];

  const packageLock = options.packageLock || readJson(path.join(options.root || ROOT, 'package-lock.json'), {});
  const lockEntry = packageLock.packages && packageLock.packages[`node_modules/${name}`];
  const fromLock = normalizeRepo(lockEntry && lockEntry.repository && (lockEntry.repository.url || lockEntry.repository));
  if (fromLock) return fromLock;

  const metadata = options.packageMetadata && options.packageMetadata[name];
  const fromMetadata = normalizeRepo(metadata && metadata.repository && (metadata.repository.url || metadata.repository));
  if (fromMetadata) return fromMetadata;

  return '';
}

function packageIssueQueries(pkg) {
  const terms = [
    'is:issue is:open label:bug',
    'is:issue is:open label:"good first issue"',
    'is:issue is:open label:"help wanted"',
    'is:issue is:open bounty',
    'is:issue is:open "bug bounty"',
    'is:issue is:open security',
    'is:issue is:open regression',
    'is:issue is:open docs OR documentation',
    'is:issue is:open typescript OR types',
    'is:issue is:open test OR ci OR flake',
  ];
  return terms.map((term) => `repo:${pkg.repo} ${term}`);
}

function packageIssueSearchTerms() {
  return [
    'label:bug',
    'label:"good first issue"',
    'label:"help wanted"',
    'bounty',
    '"bug bounty"',
    'security',
    'regression',
    'docs OR documentation',
    'typescript OR types',
    'test OR ci OR flake',
  ];
}

function parseGhIssueList(stdout, repo) {
  const payload = readJsonFromString(stdout, []);
  return payload.map((issue) => ({
    repo,
    number: issue.number,
    title: issue.title || '',
    url: issue.url || `https://github.com/${repo}/issues/${issue.number}`,
    labels: (issue.labels || []).map((label) => typeof label === 'string' ? label : label.name).filter(Boolean),
    updatedAt: issue.updatedAt || issue.updated_at || '',
    commentSignals: detectCommentSignals((issue.comments || []).map((comment) => comment.body || '')),
  }));
}

function readJsonFromString(source, fallback) {
  try {
    return JSON.parse(source);
  } catch (_) {
    return fallback;
  }
}

function detectCommentSignals(commentBodies = []) {
  const combined = commentBodies.join('\n').toLowerCase();
  const claimed = /\b(take|taking this|take this up|would like to work|like to work on this|i'?d like to work|i'?d like to take|i'?ll work|working on this)\b/.test(combined);
  const existingPr = /\b(opened|made|created|proposal)\s+(a\s+)?pr\b|\/pull\/\d+|pull\/new|resolved in #\d+|will be resolved in #\d+/.test(combined);
  return {
    claimed,
    existingPr,
    blocked: claimed || existingPr,
  };
}

function fetchRepoIssues(repo, options = {}) {
  if (options.offline) return [];
  const gh = options.ghBinary || 'gh';
  const limit = Math.max(1, Number(options.limit || 30));
  const perQueryLimit = Math.max(5, Math.ceil(limit / 2));
  const seen = new Set();
  const issues = [];

  for (const search of packageIssueSearchTerms()) {
    if (issues.length >= limit) break;
    const result = spawnSync(gh, [
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--search',
      search,
      '--limit',
      String(perQueryLimit),
      '--json',
      'number,title,url,labels,updatedAt,comments',
    ], {
      encoding: 'utf8',
      timeout: options.timeoutMs || 10000,
    });
    if (result.status !== 0) continue;
    for (const issue of parseGhIssueList(result.stdout, repo)) {
      const key = `${repo}#${issue.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(issue);
      if (issues.length >= limit) break;
    }
  }

  return issues;
}

function issueScore(issue, pkg) {
  const labels = (issue.labels || []).map((label) => String(label).toLowerCase());
  const title = String(issue.title || '').toLowerCase();
  let score = pkg.dependencyType === 'runtime' ? 20 : 12;
  if (labels.some((label) => /bug|regression|defect/.test(label)) || /\bbug|regression|crash|fail/.test(title)) score += 25;
  if (labels.some((label) => /good first issue|help wanted|up for grabs/.test(label))) score += 18;
  if (labels.some((label) => /security|vulnerability/.test(label)) || /\bsecurity|vulnerability|cve\b/.test(title)) score += 16;
  if (labels.some((label) => /bounty|reward|paid/.test(label)) || /\bbounty|reward|paid\b/.test(title)) score += 22;
  if (/\b(?:docs?|test|typescript|types|ci|flake)\b/.test(title)) score += 10;
  return score;
}

function buildPatchReadiness(issue, pkg) {
  const labels = (issue.labels || []).map((label) => String(label).toLowerCase());
  const title = String(issue.title || '').toLowerCase();
  const commentSignals = issue.commentSignals || {};
  const explicitSmallLabel = labels.some((label) => /good first issue|documentation|docs|test|typescript|types|ci/.test(label));
  const smallPatchTitle = /\b(?:docs?|documentation|readme|example|test|typescript|types|ci|flake|lint|typo)\b/.test(title);
  const helpWantedOnly = labels.some((label) => /help wanted|up for grabs/.test(label))
    && !explicitSmallLabel
    && !smallPatchTitle;
  const highRiskTitle = /\bcrash|segfault|sigill|security|vulnerability|cve|attestation|supply chain|silent data|corruption\b/.test(title);
  const smallPatch = (explicitSmallLabel || smallPatchTitle) && (!highRiskTitle || smallPatchTitle);
  const canAutofix = smallPatch && !helpWantedOnly && !commentSignals.blocked;
  const evidenceGate = commentSignals.blocked
    ? 'claimed-or-existing-pr'
    : canAutofix ? 'autonomous-patch-ready' : 'triage-before-pr';
  return {
    canAutofix,
    prAllowed: canAutofix,
    effort: canAutofix ? 'small' : 'needs-triage',
    evidenceGate,
    blockers: [
      commentSignals.claimed ? 'issue appears claimed in comments' : '',
      commentSignals.existingPr ? 'issue appears to have an existing PR or proposal' : '',
    ].filter(Boolean),
    requiredProof: [
      'Fork or branch only; never push to upstream default branch.',
      'Reproduce or cite the issue before changing code.',
      'Run the upstream repo test command for the touched package path.',
      'Do not open a public PR if reproduction, test proof, or maintainer relevance is missing.',
      'Open a PR only with a minimal patch, issue link, test proof, and no ThumbGate sales copy.',
    ],
    promotionRule: 'Earn trust by fixing the dependency; mention ThumbGate only in profile/context, not in the PR body unless directly relevant.',
    suggestedBranch: `codex/upstream-${pkg.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}-${issue.number || 'issue'}`,
  };
}

function buildUpstreamContributionPlan(options = {}) {
  const root = options.root || ROOT;
  const issuesByRepo = options.issuesByRepo || {};
  const packages = listDirectPackages(root)
    .map((pkg) => ({ ...pkg, repo: resolvePackageRepo(pkg.name, { ...options, root }) }))
    .filter((pkg) => pkg.repo)
    .sort((left, right) => {
      const leftHasEvidence = Object.prototype.hasOwnProperty.call(issuesByRepo, left.repo) ? 1 : 0;
      const rightHasEvidence = Object.prototype.hasOwnProperty.call(issuesByRepo, right.repo) ? 1 : 0;
      if (leftHasEvidence !== rightHasEvidence) return rightHasEvidence - leftHasEvidence;
      return left.name.localeCompare(right.name);
    });
  const maxRepos = Math.max(1, Number(options.maxRepos || options['max-repos'] || 12));
  const maxIssues = Math.max(1, Number(options.maxIssues || options['max-issues'] || 5));

  const repoRows = packages
    .slice(0, maxRepos)
    .map((pkg) => {
      const issues = issuesByRepo[pkg.repo] || fetchRepoIssues(pkg.repo, {
        offline: options.offline !== false,
        limit: options.issueFetchLimit || 30,
        ghBinary: options.ghBinary,
        timeoutMs: options.timeoutMs,
      });
      const rankedIssues = issues
        .map((issue) => ({
          ...issue,
          score: issueScore(issue, pkg),
          readiness: buildPatchReadiness(issue, pkg),
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, maxIssues);
      return {
        package: pkg.name,
        dependencyType: pkg.dependencyType,
        repo: pkg.repo,
        searchQueries: packageIssueQueries(pkg),
        issues: rankedIssues,
        nextAction: rankedIssues.some((issue) => issue.readiness.canAutofix)
          ? 'Clone/fork the top autofix-ready issue, produce a minimal patch, run upstream tests, then open PR with proof.'
          : 'Monitor issue search queries; wait for a small bug, docs, CI, type, or test issue before patching.',
      };
    });

  const opportunities = repoRows
    .flatMap((row) => row.issues.map((issue) => ({
      package: row.package,
      repo: row.repo,
      issueNumber: issue.number,
      issueUrl: issue.url,
      title: issue.title,
      score: issue.score,
      canAutofix: issue.readiness.canAutofix,
      evidenceGate: issue.readiness.evidenceGate,
      blockers: issue.readiness.blockers,
      suggestedBranch: issue.readiness.suggestedBranch,
    })))
    .sort((left, right) => right.score - left.score);

  return {
    name: 'thumbgate-upstream-contribution-engine',
    generatedAt: new Date().toISOString(),
    status: opportunities.length > 0 ? 'actionable' : 'discovery-ready',
    summary: {
      packageCount: packages.length,
      repoCount: repoRows.length,
      issueCount: repoRows.reduce((sum, row) => sum + row.issues.length, 0),
      autofixReadyCount: opportunities.filter((entry) => entry.canAutofix).length,
    },
    guardrails: [
      'Only target repos ThumbGate actually depends on or uses in shipped workflows.',
      'Do not create promotional PRs; fix real upstream issues with tests.',
      'Prefer small bugs, tests, docs, types, CI flakes, and security hardening over large feature work.',
      'Open external PRs only after reproduction evidence, a minimal patch, and upstream tests pass.',
      'Never paste secrets, customer data, or private ThumbGate context into upstream issues or PRs.',
    ],
    autonomousWorkflow: [
      'Run live discovery on schedule and rank only dependency-backed upstream repos.',
      'Clone/fork the highest autonomous-patch-ready issue into the suggested branch.',
      'Capture reproduction, apply the smallest patch, and run upstream tests.',
      'Open a public PR only when the evidence gate is autonomous-patch-ready and proof artifacts exist.',
      'Stop at a local worktree and operator report when the issue is high-risk, security-sensitive, or unreproduced.',
    ],
    repos: repoRows,
    opportunities,
  };
}

function renderUpstreamContributionPlan(plan) {
  const lines = [
    '# Upstream Contribution Engine',
    '',
    'Use this to earn developer trust by fixing repos ThumbGate actually depends on. This is not a spam lane.',
    '',
    `Status: ${plan.status}`,
    `Repos scanned: ${plan.summary.repoCount}`,
    `Issues ranked: ${plan.summary.issueCount}`,
    `Autofix-ready: ${plan.summary.autofixReadyCount}`,
    '',
    '## Guardrails',
    '',
    ...plan.guardrails.map((item) => `- ${item}`),
    '',
    '## Autonomous Workflow',
    '',
    ...plan.autonomousWorkflow.map((item) => `- ${item}`),
    '',
    '## Top Opportunities',
    '',
  ];

  if (plan.opportunities.length === 0) {
    lines.push('No live issues were provided or discovered. Run with GitHub access enabled or review the search queries below.');
  } else {
    for (const item of plan.opportunities.slice(0, 20)) {
      lines.push(`- ${item.repo}#${item.issueNumber || 'n/a'} (${item.score}, ${item.evidenceGate}) ${item.title}`);
      lines.push(`  ${item.issueUrl || `https://github.com/${item.repo}/issues`}`);
      lines.push(`  Branch: ${item.suggestedBranch}`);
      if (item.blockers.length > 0) lines.push(`  Blockers: ${item.blockers.join('; ')}`);
    }
  }

  lines.push('', '## Repo Search Queries', '');
  for (const repo of plan.repos) {
    lines.push(`### ${repo.package} -> ${repo.repo}`);
    for (const query of repo.searchQueries) lines.push(`- ${query}`);
    lines.push(`- Next: ${repo.nextAction}`, '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function writeUpstreamContributionPlan(plan, outputDir = DEFAULT_OUTPUT_DIR) {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'upstream-contribution-engine.json');
  const mdPath = path.join(outputDir, 'upstream-contribution-engine.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(mdPath, renderUpstreamContributionPlan(plan));
  return { jsonPath, mdPath };
}

module.exports = {
  DEFAULT_REPO_OVERRIDES,
  buildPatchReadiness,
  buildUpstreamContributionPlan,
  detectCommentSignals,
  fetchRepoIssues,
  issueScore,
  listDirectPackages,
  normalizeRepo,
  packageIssueQueries,
  renderUpstreamContributionPlan,
  resolvePackageRepo,
  writeUpstreamContributionPlan,
};
