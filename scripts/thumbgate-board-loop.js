#!/usr/bin/env node
'use strict';

/**
 * ThumbGate board loop — classify + act on the Issues + PR wall.
 *
 * Why this exists: GitHub's PR list "4/4" is not mergeable. Dependabot PRs
 * go BEHIND after each Trunk land, and agent-automerge historically skipped
 * `dependabot/*` plus left workflow_run events with no PR number.
 *
 * Never approve. Never --admin. Never gh pr merge --auto.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const FIXED_GH_BINARIES = Object.freeze([
  '/opt/homebrew/bin/gh',
  '/usr/local/bin/gh',
  '/usr/bin/gh',
]);

function resolveGhBinary(options = {}) {
  const accessSync = options.accessSync || fs.accessSync;
  const candidates = [];
  const configuredBinary = options.ghBinary || process.env.THUMBGATE_GH_BINARY;
  if (configuredBinary) {
    if (!path.isAbsolute(configuredBinary)) {
      throw new Error(`Unsafe GH binary path: ${configuredBinary}`);
    }
    candidates.push(configuredBinary);
  }
  candidates.push(...FIXED_GH_BINARIES);
  for (const candidate of candidates) {
    try {
      accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`Unable to locate GH CLI in fixed paths: ${candidates.join(', ')}`);
}


const MARKER = '<!-- thumbgate-board-loop -->';
const SOURCE = 'thumbgate-board-loop';

const ECI_ISSUE_RE = /llm adjudicat|two-tier guardrail|adjudicator tier/i;
const UMBRELLA_ISSUE_RE = /gulli|gap map|agentic design patterns/i;
const IMPLEMENT_ISSUE_RE = /ideabrowser/i;

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    json: false,
    apply: false,
    help: false,
    maxUpdateBranch: 1,
    maxPrManage: 1,
    maxComments: 4,
    skipPr: null,
  };
  for (const arg of argv) {
    if (arg === '--json') out.json = true;
    else if (arg === '--apply') out.apply = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--max-update-branch=')) {
      out.maxUpdateBranch = Math.max(0, Number(arg.slice('--max-update-branch='.length)) || 0);
    } else if (arg.startsWith('--max-pr-manage=')) {
      out.maxPrManage = Math.max(0, Number(arg.slice('--max-pr-manage='.length)) || 0);
    } else if (arg.startsWith('--max-comments=')) {
      out.maxComments = Math.max(0, Number(arg.slice('--max-comments='.length)) || 0);
    } else if (arg.startsWith('--skip-pr=')) {
      out.skipPr = Number(arg.slice('--skip-pr='.length));
    }
  }
  return out;
}

function ciRollup(pr) {
  const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  if (pr.ciRollup) return String(pr.ciRollup).toUpperCase();
  if (!checks.length && pr.ci) return String(pr.ci).toUpperCase();
  let pending = 0;
  let failing = 0;
  for (const check of checks) {
    const name = String(check.name || '');
    if (/vercel|gitar|sonarcloud|merge blob/i.test(name)) continue;
    const conclusion = String(check.conclusion || '').toUpperCase();
    const status = String(check.status || '').toUpperCase();
    if (status && status !== 'COMPLETED') {
      pending += 1;
      continue;
    }
    if (['FAILURE', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'].includes(conclusion)) {
      failing += 1;
    }
  }
  if (failing) return 'FAILURE';
  if (pending) return 'PENDING';
  return checks.length ? 'SUCCESS' : 'UNKNOWN';
}

function classifyPr(pr, options = {}) {
  const number = Number(pr.number);
  const mss = String(pr.mergeStateStatus || '').toUpperCase();
  const mergeable = String(pr.mergeable || '').toUpperCase();
  const head = String(pr.headRefName || '');
  const ci = ciRollup(pr);
  const queued = options.trunkQueuedNumbers instanceof Set
    ? options.trunkQueuedNumbers
    : new Set(options.trunkQueuedNumbers || []);

  if (pr.isDraft && /^trunk-merge\/pr-/i.test(head)) {
    return { number, class: 'trunk_queued', action: 'skip', ci, mss, reason: 'trunk draft already queued' };
  }
  if (pr.isDraft) {
    return { number, class: 'draft', action: 'skip', ci, mss, reason: 'draft' };
  }
  if (queued.has(number) || queued.has(String(number))) {
    return { number, class: 'trunk_queued', action: 'skip', ci, mss, reason: 'sibling trunk-merge PR open' };
  }
  if (mss === 'DIRTY' || mergeable === 'CONFLICTING') {
    return { number, class: 'dirty', action: 'comment_needs_rebase', ci, mss, reason: 'conflicts vs main' };
  }
  if (ci === 'FAILURE') {
    return { number, class: 'failing', action: 'triage', ci, mss, reason: 'required check red' };
  }
  if (ci === 'PENDING' || ci === 'UNKNOWN') {
    return { number, class: 'pending', action: 'wait', ci, mss, reason: ci === 'UNKNOWN' ? 'no CI evidence yet' : 'required check pending' };
  }
  if (mss === 'BEHIND' && ci === 'SUCCESS') {
    return { number, class: 'behind', action: 'update_branch', ci, mss, reason: 'green but behind tip' };
  }
  if ((mss === 'CLEAN' || mss === 'UNSTABLE' || mss === 'HAS_HOOKS') && ci === 'SUCCESS') {
    return { number, class: 'ready', action: 'pr_manage', ci, mss, reason: 'terminal green, submit Trunk' };
  }
  if (mss === 'BLOCKED' && ci === 'SUCCESS') {
    return {
      number,
      class: 'blocked_protection',
      action: 'diagnose_threads',
      ci,
      mss,
      reason: 'green but BLOCKED — conversation resolution or review, never approve',
    };
  }
  return { number, class: 'unknown', action: 'report', ci, mss, reason: `unclassified mss=${mss} ci=${ci}` };
}

function classifyIssue(issue) {
  const title = String(issue.title || '');
  const number = Number(issue.number);
  if (ECI_ISSUE_RE.test(title)) {
    return { number, class: 'eci_pause', action: 'comment_keep', reason: 'net-new LLM adjudicator — ECI pause' };
  }
  if (UMBRELLA_ISSUE_RE.test(title)) {
    return { number, class: 'umbrella', action: 'comment_keep', reason: 'design umbrella, not one-PR closable' };
  }
  if (IMPLEMENT_ISSUE_RE.test(title)) {
    return { number, class: 'implement', action: 'comment_residual', reason: 'leftover AC not on origin/main' };
  }
  return { number, class: 'keep', action: 'comment_keep', reason: 'open product issue' };
}

function detectForbidden(text) {
  const t = String(text || '');
  const hits = [];
  if (/gh pr merge[^\n]*--auto/.test(t)) hits.push('raw_auto_merge');
  if (/event:\s*"APPROVE"|pulls\.createReview|gh pr review[^\n]*--approve/.test(t)) hits.push('approve');
  if (/--admin\b/.test(t)) hits.push('admin_bypass');
  return hits;
}

function trunkQueuedNumbers(prs) {
  const set = new Set();
  for (const pr of prs) {
    const head = String(pr.headRefName || '');
    const m = head.match(/^trunk-merge\/pr-(\d+)\//i);
    if (m) set.add(Number(m[1]));
  }
  return set;
}

function alreadyMarked(comments) {
  const list = Array.isArray(comments) ? comments : [];
  return list.some((c) => String(c.body || c).includes(MARKER));
}

function issueCommentBody(classified, tipSha) {
  const sha = tipSha || 'unverified';
  if (classified.class === 'eci_pause') {
    return `${MARKER}\n### Board-loop disposition\n\n**KEEP OPEN / ECI pause.** ${classified.reason}. Deterministic hard-block tier stays. Do not dual-build an LLM-in-the-gate SKU. Tip \`${sha}\`.`;
  }
  if (classified.class === 'implement') {
    return `${MARKER}\n### Board-loop disposition\n\n**KEEP OPEN — IMPLEMENT residual.** ${classified.reason}. No close without a merge SHA on \`origin/main\`. Tip \`${sha}\`.`;
  }
  return `${MARKER}\n### Board-loop disposition\n\n**KEEP OPEN.** ${classified.reason}. Tip \`${sha}\`.`;
}

function dirtyPrCommentBody(classified) {
  return `${MARKER}\nBoard-loop: **DIRTY/CONFLICTING** (ci=${classified.ci} mss=${classified.mss}). Needs successor rebase onto \`origin/main\`, not \`--admin\`. Not stale-closed (<30d failing PRs stay).`;
}

function runGh(args, runner) {
  if (typeof runner === 'function') return runner(args);
  return spawnSync(resolveGhBinary(), args, { encoding: 'utf8' });
}

function parseJson(stdout, fallback) {
  try {
    return JSON.parse(stdout || '');
  } catch {
    return fallback;
  }
}

function loadBoard(runner) {
  const prsRes = runGh([
    'pr', 'list', '--state', 'open', '--limit', '50',
    '--json', 'number,title,author,isDraft,mergeable,mergeStateStatus,headRefName,url,statusCheckRollup,comments',
  ], runner);
  const issuesRes = runGh([
    'issue', 'list', '--state', 'open', '--limit', '50',
    '--json', 'number,title,url,comments',
  ], runner);
  const prs = prsRes.status === 0 ? parseJson(prsRes.stdout, []) : [];
  const issues = issuesRes.status === 0 ? parseJson(issuesRes.stdout, []) : [];
  return { prs, issues, prsError: prsRes.status === 0 ? null : prsRes.stderr, issuesError: issuesRes.status === 0 ? null : issuesRes.stderr };
}

function planBoard(prs, issues) {
  const queued = trunkQueuedNumbers(prs);
  const prPlan = prs.map((pr) => {
    const classified = classifyPr(pr, { trunkQueuedNumbers: queued });
    return {
      ...classified,
      title: pr.title,
      url: pr.url,
      author: pr.author && (pr.author.login || pr.author),
      headRefName: pr.headRefName,
      alreadyMarked: alreadyMarked(pr.comments),
    };
  });
  const issuePlan = issues.map((issue) => ({
    ...classifyIssue(issue),
    title: issue.title,
    url: issue.url,
    alreadyMarked: alreadyMarked(issue.comments),
  }));
  return { prPlan, issuePlan, queued: [...queued] };
}

function applyPlan(plan, options, runner) {
  const actions = [];
  const forbidden = detectForbidden(JSON.stringify(options));
  if (forbidden.length) {
    return { actions, refused: forbidden };
  }

  let updates = 0;
  let manages = 0;
  let comments = 0;
  const skip = Number(options.skipPr) || null;

  for (const row of plan.prPlan) {
    if (skip && row.number === skip) continue;
    if (row.action === 'update_branch' && updates < options.maxUpdateBranch) {
      const res = runGh(['pr', 'update-branch', String(row.number)], runner);
      actions.push({
        kind: 'update_branch',
        number: row.number,
        ok: res.status === 0,
        detail: (res.stderr || res.stdout || '').trim().slice(0, 200),
      });
      updates += 1;
    } else if (row.action === 'pr_manage' && manages < options.maxPrManage) {
      const script = path.join(__dirname, 'pr-manager.js');
      const res = typeof runner === 'function'
        ? runner(['node', script, String(row.number)])
        : spawnSync(process.execPath, [script, String(row.number)], { encoding: 'utf8' });
      actions.push({
        kind: 'pr_manage',
        number: row.number,
        ok: res.status === 0,
        detail: (res.stdout || res.stderr || '').trim().slice(0, 200),
      });
      manages += 1;
    } else if (
      row.action === 'comment_needs_rebase'
      && !row.alreadyMarked
      && comments < options.maxComments
    ) {
      const res = runGh([
        'pr', 'comment', String(row.number), '--body', dirtyPrCommentBody(row),
      ], runner);
      actions.push({
        kind: 'pr_comment',
        number: row.number,
        ok: res.status === 0,
        detail: 'needs-rebase',
      });
      comments += 1;
    }
  }

  for (const row of plan.issuePlan) {
    if (row.alreadyMarked) continue;
    if (comments >= options.maxComments) break;
    if (row.action === 'comment_keep' || row.action === 'comment_residual') {
      const res = runGh([
        'issue', 'comment', String(row.number), '--body', issueCommentBody(row, options.tipSha),
      ], runner);
      actions.push({
        kind: 'issue_comment',
        number: row.number,
        ok: res.status === 0,
        class: row.class,
      });
      comments += 1;
    }
  }

  return { actions, refused: [] };
}

function buildReport(options = {}, io = {}) {
  const loaded = (io.prs || io.issues)
    ? {
      prs: io.prs || [],
      issues: io.issues || [],
      prsError: io.prsError || null,
      issuesError: io.issuesError || null,
    }
    : loadBoard(io.runner);
  const errors = [loaded.prsError, loaded.issuesError].filter(Boolean);
  const plan = planBoard(loaded.prs || [], loaded.issues || []);
  const counts = {};
  for (const row of plan.prPlan) {
    counts[row.class] = (counts[row.class] || 0) + 1;
  }
  let applied = { actions: [], refused: [] };
  if (options.apply && errors.length === 0) {
    applied = applyPlan(plan, options, io.runner);
  }
  return {
    name: SOURCE,
    ok: errors.length === 0,
    errors,
    never: ['approve a PR', 'gh pr merge --auto', '--admin', 'close DIRTY <30d without evidence'],
    prs: plan.prPlan.length,
    issues: plan.issuePlan.length,
    trunkQueued: plan.queued,
    counts,
    prPlan: plan.prPlan,
    issuePlan: plan.issuePlan,
    applied: options.apply ? applied.actions : [],
    refused: applied.refused,
  };
}

function formatReport(report) {
  const lines = [
    'ThumbGate board loop',
    `PRs ${report.prs}  Issues ${report.issues}  Trunk-queued ${report.trunkQueued.join(',') || '(none)'}`,
    `Counts ${JSON.stringify(report.counts)}`,
  ];
  for (const row of report.prPlan) {
    lines.push(`  PR #${row.number} ${row.class}/${row.action} ci=${row.ci} mss=${row.mss} ${row.title || ''}`);
  }
  for (const row of report.issuePlan) {
    lines.push(`  Issue #${row.number} ${row.class}/${row.action} ${row.title || ''}`);
  }
  if (report.applied.length) {
    lines.push('Applied:');
    for (const act of report.applied) {
      lines.push(`  ${act.kind} #${act.number} ok=${act.ok}`);
    }
  }
  lines.push(`Never: ${(report.never || []).join('; ')}`);
  return `${lines.join('\n')}\n`;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/thumbgate-board-loop.js [--apply] [--json]

Classify every open ThumbGate PR + Issue. --apply update-branches at most one
BEHIND green PR, submits at most one READY PR via pr-manager, comments DIRTY
and Issues with a dedupe marker. Never approves. Never --admin.
`);
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const report = buildReport(args);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatReport(report));
  return 0;
}

module.exports = {
  MARKER,
  parseArgs,
  ciRollup,
  classifyPr,
  classifyIssue,
  detectForbidden,
  trunkQueuedNumbers,
  alreadyMarked,
  planBoard,
  applyPlan,
  buildReport,
  formatReport,
  resolveGhBinary,
  FIXED_GH_BINARIES,
  main,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = main();
}
