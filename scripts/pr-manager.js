#!/usr/bin/env node
/**
 * PR Manager — High-Throughput Merge & Blocker Diagnosis
 * 
 * Inspired by the 2026 GitHub 'Quick Access' update. Centralizes merge status 
 * detection and triggers autonomous self-healing for common blockers.
 */

'use strict';

const { spawnSync } = require('child_process');
const PR_FIELDS = 'number,state,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision,isDraft,title';
const SUCCESSFUL_CHECK_CONCLUSIONS = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
const FAILING_CHECK_CONCLUSIONS = new Set([
  'ACTION_REQUIRED',
  'CANCELLED',
  'FAILURE',
  'STALE',
  'STARTUP_FAILURE',
  'TIMED_OUT',
]);

function runGh(args) {
  return spawnSync('gh', args, { encoding: 'utf-8' });
}

function formatGhError(result) {
  return (result.stderr || result.stdout || 'Unknown GH CLI failure').trim();
}

function isMissingCurrentBranchPr(result, prNumber) {
  if (prNumber) {
    return false;
  }

  return /no pull requests found for branch/i.test(formatGhError(result));
}

/**
 * Fetch granular PR status using GH CLI
 */
function getPrStatus(prNumber = '', runner = runGh) {
  const args = ['pr', 'view'];
  if (prNumber) args.push(prNumber);
  args.push('--json', PR_FIELDS);

  const result = runner(args);
  if (result.status !== 0) {
    if (isMissingCurrentBranchPr(result, prNumber)) {
      return null;
    }

    throw new Error(`Failed to fetch PR status: ${formatGhError(result)}`);
  }
  return JSON.parse(result.stdout);
}

function listOpenPrs(runner = runGh) {
  const result = runner(['pr', 'list', '--state', 'open', '--json', PR_FIELDS]);
  if (result.status !== 0) {
    throw new Error(`Failed to list open PRs: ${formatGhError(result)}`);
  }

  return JSON.parse(result.stdout || '[]');
}

function isOpenPr(pr) {
  return Boolean(pr) && String(pr.state || 'OPEN').toUpperCase() === 'OPEN';
}

function loadManagedPrs(prNumber = '', runner = runGh) {
  if (prNumber) {
    return [getPrStatus(prNumber, runner)];
  }

  const currentBranchPr = getPrStatus('', runner);
  if (isOpenPr(currentBranchPr)) {
    return [currentBranchPr];
  }

  return listOpenPrs(runner);
}

function summarizeChecks(checks = []) {
  const failing = [];
  const pending = [];

  for (const check of checks) {
    const name = check.name || 'unknown-check';
    const conclusion = check.conclusion || null;
    const status = check.status || (conclusion ? 'COMPLETED' : 'UNKNOWN');

    if (status !== 'COMPLETED') {
      pending.push(name);
      continue;
    }

    if (conclusion && FAILING_CHECK_CONCLUSIONS.has(conclusion)) {
      failing.push(name);
      continue;
    }

    if (conclusion && !SUCCESSFUL_CHECK_CONCLUSIONS.has(conclusion)) {
      pending.push(name);
    }
  }

  return { failing, pending };
}

/**
 * Diagnose and resolve blockers autonomously
 */
async function resolveBlockers(pr, runner = runGh) {
  const title = pr.title || 'Untitled PR';
  const mergeState = pr.mergeStateStatus || 'UNKNOWN';
  const mergeable = pr.mergeable || 'UNKNOWN';

  console.log(`[PR Manager] Diagnosing PR #${pr.number}: "${title}"`);
  console.log(`[PR Manager] Merge State: ${mergeState} | Mergeable: ${mergeable}`);

  if (pr.isDraft) {
    console.log('[PR Manager] PR is a draft. Skipping.');
    return { status: 'skipped', reason: 'draft' };
  }

  // 1. Handle Outdated Branch (BEHIND)
  if (pr.mergeStateStatus === 'BEHIND') {
    console.log('[PR Manager] PR is behind main. Triggering auto-update...');
    const update = runner(['pr', 'update-branch', pr.number.toString()]);
    if (update.status === 0) {
      return { status: 'healing', action: 'update-branch' };
    }
  }

  // 2. Handle Merge Conflicts (DIRTY)
  if (pr.mergeStateStatus === 'DIRTY' || pr.mergeable === 'CONFLICTING') {
    console.log('[PR Manager] CRITICAL: Merge conflicts detected. Manual intervention or advanced rebase required.');
    return { status: 'blocked', reason: 'conflicts' };
  }

  // 3. Handle CI Failures
  const checkSummary = summarizeChecks(pr.statusCheckRollup || []);
  const failingChecks = checkSummary.failing;

  if (failingChecks.length > 0) {
    console.log(`[PR Manager] BLOCKED: ${failingChecks.length} failing CI checks.`);
    return { status: 'blocked', reason: 'ci_failure', checks: failingChecks };
  }

  if (checkSummary.pending.length > 0) {
    console.log(`[PR Manager] BLOCKED: ${checkSummary.pending.length} CI checks still pending.`);
    return { status: 'blocked', reason: 'ci_pending', checks: checkSummary.pending };
  }

  // 4. Handle Review Blockers
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    console.log('[PR Manager] BLOCKED: Changes requested by reviewer.');
    return { status: 'blocked', reason: 'changes_requested' };
  }

  if (pr.reviewDecision === 'REVIEW_REQUIRED') {
    console.log('[PR Manager] BLOCKED: Required review is still outstanding.');
    return { status: 'blocked', reason: 'review_required' };
  }

  // 5. Ready to Merge
  if (pr.mergeStateStatus === 'CLEAN' && pr.mergeable === 'MERGEABLE') {
    console.log('[PR Manager] SUCCESS: PR is ready for protected autonomous merge.');
    return { status: 'ready' };
  }

  return { status: 'pending', reason: 'unknown_state' };
}

/**
 * Perform autonomous merge
 */
function performMerge(prNumber, runner = runGh) {
  const args = ['pr', 'merge', prNumber.toString(), '--squash', '--delete-branch', '--auto'];
  console.log(`[PR Manager] Initiating protected squash merge for PR #${prNumber}...`);
  const result = runner(args);
  if (result.status === 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const mode = /merge queue|queued|auto-merge/i.test(output) ? 'queued_or_auto' : 'merged';
    console.log(`[PR Manager] Merge accepted for PR #${prNumber} (${mode}).`);
    return { ok: true, mode, args };
  } else {
    console.error(`[PR Manager] Merge failed: ${formatGhError(result)}`);
    return { ok: false, mode: 'failed', args, error: formatGhError(result) };
  }
}

async function managePrs(prNumber = '', runner = runGh) {
  const prs = loadManagedPrs(prNumber, runner).filter(Boolean);

  if (prs.length === 0) {
    console.log('[PR Manager] No open pull requests found.');
    return { status: 'noop', prs: [] };
  }

  const results = [];
  for (const pr of prs) {
    const outcome = await resolveBlockers(pr, runner);
    if (outcome.status === 'ready') {
      const mergeResult = performMerge(pr.number, runner);
      outcome.mergeRequested = mergeResult.ok;
      outcome.mergeMode = mergeResult.mode;
    }

    results.push({
      number: pr.number,
      title: pr.title,
      outcome,
    });
  }

  return { status: 'ok', prs: results };
}

if (require.main === module) {
  const prNum = process.argv[2];
  managePrs(prNum).then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  getPrStatus,
  listOpenPrs,
  isOpenPr,
  loadManagedPrs,
  resolveBlockers,
  performMerge,
  managePrs,
};
