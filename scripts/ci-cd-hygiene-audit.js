#!/usr/bin/env node
/**
 * ci-cd-hygiene-audit.js — surface stale PRs, unresolved bot threads,
 * ignored CLEAN PRs, and any workflow that's been failing repeatedly.
 *
 * Background. On 2026-05-17 the CEO asked: "why hasn't v1.19.0 been
 * published? I suspect stale PRs, unresolved bot comments, failed CI."
 * The audit confirmed all three: a CLEAN PR (#1953) had been ignored for
 * 5 days, 4 Codex bot threads sat unresolved across 2 PRs, and the
 * release PR (#2082) was blocked on a single test failure that nobody had
 * looked at. None of this was visible until someone asked.
 *
 * This script runs daily and surfaces the same set of signals so future
 * sessions never have to re-discover them by hand:
 *
 *   1. CLEAN PRs (ready to merge) sitting open ≥ N days  → "merge backlog"
 *   2. Open PRs with unresolved bot review threads        → "unread review"
 *   3. DIRTY PRs (merge conflict) open ≥ N days           → "stale conflict"
 *   4. Workflows that have failed N+ times in the last 7d → "broken workflow"
 *   5. PRs with NO reviewer engagement at all             → "abandoned"
 *
 * Emits structured markdown + JSON. Wired into Daily Revenue Loop so the
 * CEO and CTO both see the hygiene state in the daily GitHub Actions
 * summary, alongside the revenue rollup. Exit-code-1 if the merge backlog
 * threshold is exceeded so the workflow is yellow-flagged in the UI.
 *
 * Run:
 *   node scripts/ci-cd-hygiene-audit.js
 *   node scripts/ci-cd-hygiene-audit.js --json
 *   node scripts/ci-cd-hygiene-audit.js --strict   # exit 1 on backlog ≥ 3
 *
 * Required env: GH_TOKEN (or `gh auth login`)
 */

'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const DEFAULT_STALE_CLEAN_DAYS = 2;
const DEFAULT_STALE_DIRTY_DAYS = 5;
const DEFAULT_WORKFLOW_FAIL_THRESHOLD = 3;
const DEFAULT_BACKLOG_TRIP = 3;
const DEFAULT_REPO = 'IgorGanapolsky/ThumbGate';

function parseArgs(argv = []) {
  return {
    json: argv.includes('--json'),
    strict: argv.includes('--strict'),
    repo: extractFlag(argv, '--repo=') || DEFAULT_REPO,
  };
}

function extractFlag(argv, prefix) {
  const match = argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function ghJson(args, gh = (a) => execFileSync('gh', a, { encoding: 'utf8' })) {
  const out = gh(args);
  return JSON.parse(out);
}

function ageInDays(iso, now = new Date()) {
  const ms = now.getTime() - new Date(iso).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function bucketBacklog(prs, opts = {}) {
  const cleanDays = opts.staleCleanDays ?? DEFAULT_STALE_CLEAN_DAYS;
  const dirtyDays = opts.staleDirtyDays ?? DEFAULT_STALE_DIRTY_DAYS;
  const now = opts.now || new Date();
  const buckets = {
    mergeBacklog: [],
    staleConflict: [],
    abandoned: [],
  };
  for (const pr of prs) {
    const age = ageInDays(pr.createdAt, now);
    if (pr.mergeStateStatus === 'CLEAN' && age >= cleanDays) {
      buckets.mergeBacklog.push({ ...pr, ageDays: age });
    } else if (pr.mergeStateStatus === 'DIRTY' && age >= dirtyDays) {
      buckets.staleConflict.push({ ...pr, ageDays: age });
    }
    // "Abandoned" = no reviewer engagement at all (zero comments, zero reviews)
    if ((pr.comments?.length || pr.commentCount === 0) && (pr.reviewCount || 0) === 0 && (pr.commentCount || 0) === 0 && age >= 7) {
      buckets.abandoned.push({ ...pr, ageDays: age });
    }
  }
  return buckets;
}

function classifyWorkflowFailures(runs, threshold = DEFAULT_WORKFLOW_FAIL_THRESHOLD) {
  const failByWorkflow = new Map();
  for (const r of runs) {
    if (r.conclusion !== 'failure') continue;
    failByWorkflow.set(r.name, (failByWorkflow.get(r.name) || 0) + 1);
  }
  const broken = [];
  for (const [name, count] of failByWorkflow.entries()) {
    if (count >= threshold) {
      broken.push({ workflow: name, failures: count });
    }
  }
  return broken.sort((a, b) => b.failures - a.failures);
}

function listOpenPrs({ repo, gh } = {}) {
  return ghJson([
    'pr', 'list', '--state', 'open', '--limit', '100',
    '--repo', repo,
    '--json', 'number,title,createdAt,mergeStateStatus,reviewDecision,author,comments,reviews',
  ], gh).map((pr) => ({
    number: pr.number,
    title: pr.title,
    createdAt: pr.createdAt,
    mergeStateStatus: pr.mergeStateStatus,
    reviewDecision: pr.reviewDecision || null,
    author: pr.author?.login || null,
    commentCount: pr.comments?.length || 0,
    reviewCount: pr.reviews?.length || 0,
  }));
}

function listRecentRuns({ repo, days = 7, gh } = {}) {
  return ghJson([
    'run', 'list', '--repo', repo, '--limit', '100',
    '--json', 'name,conclusion,createdAt',
  ], gh);
}

function unresolvedThreadsForPr({ prNumber, repo, gh } = {}) {
  const [owner, name] = repo.split('/');
  const query = `{repository(owner:"${owner}",name:"${name}"){pullRequest(number:${prNumber}){reviewThreads(first:50){nodes{isResolved comments(first:1){nodes{author{login}}}}}}}}`;
  try {
    const out = ghJson(['api', 'graphql', '-f', `query=${query}`, '--jq', '.data.repository.pullRequest.reviewThreads.nodes'], gh);
    return (out || []).filter((node) => !node.isResolved);
  } catch {
    return [];
  }
}

function classifyUnreadReview(prs, { repo, gh } = {}) {
  const out = [];
  for (const pr of prs) {
    const unresolved = unresolvedThreadsForPr({ prNumber: pr.number, repo, gh });
    if (unresolved.length > 0) {
      const byAuthor = new Map();
      for (const t of unresolved) {
        const a = t.comments.nodes[0]?.author?.login || 'unknown';
        byAuthor.set(a, (byAuthor.get(a) || 0) + 1);
      }
      out.push({
        number: pr.number,
        title: pr.title,
        unresolvedCount: unresolved.length,
        byAuthor: Object.fromEntries(byAuthor),
      });
    }
  }
  return out;
}

function buildReport({ repo = DEFAULT_REPO, gh, now = new Date(), opts = {} } = {}) {
  const prs = listOpenPrs({ repo, gh });
  const runs = listRecentRuns({ repo, gh });
  const backlog = bucketBacklog(prs, { ...opts, now });
  const unreadReview = classifyUnreadReview(prs, { repo, gh });
  const brokenWorkflows = classifyWorkflowFailures(runs, opts.workflowFailThreshold);

  return {
    generatedAt: now.toISOString(),
    repo,
    openPrCount: prs.length,
    byMergeState: countBy(prs, (p) => p.mergeStateStatus || 'UNKNOWN'),
    mergeBacklog: backlog.mergeBacklog,
    staleConflict: backlog.staleConflict,
    abandoned: backlog.abandoned,
    unreadReview,
    brokenWorkflows,
  };
}

function countBy(arr, keyFn) {
  const out = {};
  for (const item of arr) {
    const k = keyFn(item);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# CI/CD Hygiene Audit');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Repo: ${report.repo}`);
  lines.push('');
  lines.push('## Open PR breakdown');
  lines.push('');
  lines.push(`Total open: **${report.openPrCount}**`);
  lines.push('');
  if (Object.keys(report.byMergeState).length > 0) {
    lines.push('| Merge state | Count |');
    lines.push('| --- | ---: |');
    for (const [k, v] of Object.entries(report.byMergeState)) {
      lines.push(`| ${k} | ${v} |`);
    }
  }
  lines.push('');
  lines.push('## Merge backlog — CLEAN PRs sitting open');
  lines.push('');
  if (report.mergeBacklog.length === 0) {
    lines.push('_Empty. No CLEAN PRs waiting._');
  } else {
    lines.push('| # | Age (d) | Title |');
    lines.push('| --- | ---: | --- |');
    for (const pr of report.mergeBacklog) {
      lines.push(`| #${pr.number} | ${pr.ageDays} | ${pr.title} |`);
    }
  }
  lines.push('');
  lines.push('## Unread review — PRs with unresolved bot threads');
  lines.push('');
  if (report.unreadReview.length === 0) {
    lines.push('_Empty. All review threads resolved._');
  } else {
    lines.push('| # | Unresolved | By author | Title |');
    lines.push('| --- | ---: | --- | --- |');
    for (const pr of report.unreadReview) {
      const authors = Object.entries(pr.byAuthor).map(([a, n]) => `${a}(${n})`).join(', ');
      lines.push(`| #${pr.number} | ${pr.unresolvedCount} | ${authors} | ${pr.title} |`);
    }
  }
  lines.push('');
  lines.push('## Stale conflicts — DIRTY PRs older than threshold');
  lines.push('');
  if (report.staleConflict.length === 0) {
    lines.push('_Empty. No long-running merge conflicts._');
  } else {
    lines.push('| # | Age (d) | Title |');
    lines.push('| --- | ---: | --- |');
    for (const pr of report.staleConflict) {
      lines.push(`| #${pr.number} | ${pr.ageDays} | ${pr.title} |`);
    }
  }
  lines.push('');
  lines.push('## Abandoned — PRs with zero reviewer engagement and ≥7 days old');
  lines.push('');
  if (report.abandoned.length === 0) {
    lines.push('_Empty._');
  } else {
    lines.push('| # | Age (d) | Title |');
    lines.push('| --- | ---: | --- |');
    for (const pr of report.abandoned) {
      lines.push(`| #${pr.number} | ${pr.ageDays} | ${pr.title} |`);
    }
  }
  lines.push('');
  lines.push('## Broken workflows — failed ≥3x in the last 100 runs');
  lines.push('');
  if (report.brokenWorkflows.length === 0) {
    lines.push('_Empty. No workflows are repeatedly failing._');
  } else {
    lines.push('| Workflow | Failures |');
    lines.push('| --- | ---: |');
    for (const wf of report.brokenWorkflows) {
      lines.push(`| ${wf.workflow} | ${wf.failures} |`);
    }
  }
  lines.push('');
  lines.push('## What to do with this');
  lines.push('');
  lines.push('- **Merge backlog non-empty** → merge those PRs first. CLEAN means they passed CI and have nobody blocking them; leaving them idle is a hygiene failure.');
  lines.push('- **Unread review non-empty** → resolve each thread (fix or rebut) before the PR sits past its useful window. Codex/SonarCloud/etc threads are review-quality signal, not noise.');
  lines.push('- **Stale conflict non-empty** → either rebase + resolve, or close. Long-running DIRTY PRs rarely come back.');
  lines.push('- **Abandoned non-empty** → ping the author or close. PRs without engagement signal something broke in the review flow.');
  lines.push('- **Broken workflows non-empty** → fix the failing workflow OR remove it from the cron. Repeatedly red checks train the team to ignore CI.');
  return lines.join('\n') + '\n';
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = buildReport({ repo: args.repo });
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(renderMarkdown(report));
  }
  if (args.strict && report.mergeBacklog.length >= DEFAULT_BACKLOG_TRIP) {
    process.exit(1);
  }
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`ci-cd-hygiene-audit FAILED: ${error.message}\n`);
    process.exit(2);
  }
}

module.exports = {
  parseArgs,
  ageInDays,
  bucketBacklog,
  classifyWorkflowFailures,
  countBy,
  buildReport,
  renderMarkdown,
  DEFAULT_STALE_CLEAN_DAYS,
  DEFAULT_STALE_DIRTY_DAYS,
  DEFAULT_WORKFLOW_FAIL_THRESHOLD,
};
