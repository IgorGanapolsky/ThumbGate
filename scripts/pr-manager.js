#!/usr/bin/env node
/**
 * PR Manager — High-Throughput Merge & Blocker Diagnosis
 * 
 * Inspired by the 2026 GitHub 'Quick Access' update. Centralizes merge status 
 * detection and triggers autonomous self-healing for common blockers.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const PR_FIELDS = 'number,state,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision,isDraft,title,url,headRefOid,baseRefName,mergeCommit,mergedAt,mergedBy';
const PR_CHECK_FIELDS = 'bucket,name,state,workflow,link,event';
const MERGE_QUALITY_CHECKS = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'merge-quality-checks.json'), 'utf8')
);
const FIXED_GH_BINARIES = [
  '/usr/bin/gh',
  '/usr/local/bin/gh',
  '/opt/homebrew/bin/gh',
];
const SUCCESSFUL_CHECK_CONCLUSIONS = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
const FAILING_CHECK_CONCLUSIONS = new Set([
  'ACTION_REQUIRED',
  'CANCELLED',
  'FAILURE',
  'STALE',
  'STARTUP_FAILURE',
  'TIMED_OUT',
]);
const PASSING_BUCKETS = new Set((MERGE_QUALITY_CHECKS.passingBuckets || []).map((value) => String(value || '').toLowerCase()));
const PENDING_BUCKETS = new Set((MERGE_QUALITY_CHECKS.pendingBuckets || []).map((value) => String(value || '').toLowerCase()));
const FAILING_BUCKETS = new Set((MERGE_QUALITY_CHECKS.failingBuckets || []).map((value) => String(value || '').toLowerCase()));

function assertSafeGhArgs(args) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error('GH CLI args must be a non-empty array.');
  }

  return args.map((arg) => {
    const normalized = String(arg ?? '');
    if (!normalized || /\0/.test(normalized)) {
      throw new Error(`Unsafe GH CLI arg: ${arg}`);
    }
    return normalized;
  });
}

function normalizePrNumber(prNumber, { allowEmpty = true } = {}) {
  const normalized = String(prNumber ?? '').trim();
  if (!normalized) {
    if (allowEmpty) {
      return '';
    }
    throw new Error('PR number is required.');
  }

  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`Unsafe PR number: ${prNumber}`);
  }

  return normalized;
}

function resolveGhBinary(options = {}) {
  const accessSync = options.accessSync || fs.accessSync;
  const candidates = [];
  const configuredBinary = String(process.env.THUMBGATE_GH_BIN || '').trim();

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

function buildGhEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  if (!env.GH_TOKEN && !env.GITHUB_TOKEN && env.GH_PAT) {
    env.GH_TOKEN = env.GH_PAT;
  }
  return env;
}

function runGh(args, options = {}) {
  return spawnSync(resolveGhBinary(options), assertSafeGhArgs(args), {
    encoding: 'utf-8',
    env: buildGhEnv(options.env || process.env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function formatGhError(result) {
  return (result.stderr || result.stdout || 'Unknown GH CLI failure').trim();
}

function isMissingCurrentBranchPr(result, prNumber) {
  if (prNumber) {
    return false;
  }

  return /no pull requests found for branch/i.test(formatGhError(result))
    || /could not determine current branch/i.test(formatGhError(result))
    || /not on any branch/i.test(formatGhError(result));
}

/**
 * Fetch granular PR status using GH CLI
 */
function getPrStatus(prNumber = '', runner = runGh) {
  const normalizedPrNumber = normalizePrNumber(prNumber);
  const args = ['pr', 'view'];
  if (normalizedPrNumber) args.push(normalizedPrNumber);
  args.push('--json', PR_FIELDS);

  const result = runner(args);
  if (result.status !== 0) {
    if (isMissingCurrentBranchPr(result, normalizedPrNumber)) {
      return null;
    }

    throw new Error(`Failed to fetch PR status: ${formatGhError(result)}`);
  }
  return JSON.parse(result.stdout);
}

function getPrChecks(prNumber = '', runner = runGh) {
  const normalizedPrNumber = normalizePrNumber(prNumber, { allowEmpty: false });
  const result = runner(['pr', 'checks', normalizedPrNumber, '--json', PR_CHECK_FIELDS]);
  if (result.status !== 0) {
    throw new Error(`Failed to fetch PR checks: ${formatGhError(result)}`);
  }

  return JSON.parse(result.stdout || '[]');
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
    const explicitPr = getPrStatus(prNumber, runner);
    return isOpenPr(explicitPr) ? [explicitPr] : [];
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
    const bucket = String(check.bucket || '').toLowerCase();
    if (bucket) {
      if (FAILING_BUCKETS.has(bucket)) {
        failing.push(name);
        continue;
      }

      if (PENDING_BUCKETS.has(bucket)) {
        pending.push(name);
        continue;
      }

      if (PASSING_BUCKETS.has(bucket)) {
        continue;
      }
    }

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

function sleep(ms) {
  if (!ms || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
  let checks = pr.statusCheckRollup || [];
  let checkSource = 'statusCheckRollup';

  if (pr.number) {
    try {
      checks = getPrChecks(pr.number, runner);
      checkSource = 'gh pr checks';
    } catch (error) {
      console.warn(`[PR Manager] Falling back to statusCheckRollup for PR #${pr.number}: ${error.message}`);
    }
  }

  const checkSummary = summarizeChecks(checks);
  const failingChecks = checkSummary.failing;

  if (failingChecks.length > 0) {
    console.log(`[PR Manager] BLOCKED: ${failingChecks.length} failing quality checks via ${checkSource}.`);
    return { status: 'blocked', reason: 'ci_failure', checks: failingChecks, checkSource };
  }

  if (checkSummary.pending.length > 0) {
    console.log(`[PR Manager] BLOCKED: ${checkSummary.pending.length} quality checks still pending via ${checkSource}.`);
    return { status: 'blocked', reason: 'ci_pending', checks: checkSummary.pending, checkSource };
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

function waitForMergeCommit(prNumber, runner = runGh, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 300000;
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 10000;
  const startedAt = Date.now();

  do {
    const pr = getPrStatus(prNumber, runner);
    if (pr && String(pr.state || '').toUpperCase() === 'MERGED' && pr.mergeCommit && pr.mergeCommit.oid) {
      return {
        finalized: true,
        merged: true,
        mergeCommit: pr.mergeCommit.oid,
        mergedAt: pr.mergedAt || null,
        mergedBy: pr.mergedBy && pr.mergedBy.login ? pr.mergedBy.login : null,
        pr,
      };
    }

    if (pr && String(pr.state || '').toUpperCase() === 'CLOSED') {
      return {
        finalized: true,
        merged: false,
        reason: 'closed_without_merge',
        pr,
      };
    }

    if (intervalMs <= 0) {
      break;
    }

    if ((Date.now() - startedAt + intervalMs) > timeoutMs) {
      break;
    }

    sleep(intervalMs);
  } while ((Date.now() - startedAt) <= timeoutMs);

  return {
    finalized: false,
    merged: false,
    reason: 'merge_commit_pending',
  };
}

function submitTrunkMergeRequest(prNumber, runner = runGh) {
  const normalizedPrNumber = normalizePrNumber(prNumber, { allowEmpty: false });
  const args = ['pr', 'comment', normalizedPrNumber, '--body', '/trunk merge'];
  console.log(`[PR Manager] Requesting Trunk merge queue for PR #${normalizedPrNumber}...`);
  const result = runner(args);
  if (result.status !== 0) {
    console.error(`[PR Manager] Queue request failed: ${formatGhError(result)}`);
    return { ok: false, mode: 'failed', args, error: formatGhError(result) };
  }

  console.log(`[PR Manager] Queue request accepted for PR #${normalizedPrNumber} (/trunk merge).`);
  return {
    ok: true,
    mode: 'queued',
    args,
    finalized: false,
    merged: false,
    reason: 'merge_commit_pending',
  };
}

/**
 * Perform autonomous merge
 */
function performMerge(prInput, runner = runGh, options = {}) {
  const pr = (prInput && typeof prInput === 'object')
    ? prInput
    : { number: prInput, baseRefName: options.baseRefName || '' };
  const normalizedPrNumber = normalizePrNumber(pr.number, { allowEmpty: false });

  if (String(pr.baseRefName || '').toLowerCase() === 'main') {
    return submitTrunkMergeRequest(normalizedPrNumber, runner);
  }

  const args = ['pr', 'merge', normalizedPrNumber, '--squash', '--delete-branch'];
  console.log(`[PR Manager] Initiating protected squash merge for PR #${normalizedPrNumber}...`);
  const result = runner(args);
  if (result.status === 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const mode = /merge queue|queued/i.test(output) ? 'queued' : 'merged';
    console.log(`[PR Manager] Merge accepted for PR #${normalizedPrNumber} (${mode}).`);
    const mergeStatus = options.waitForMerge === false
      ? { finalized: false, merged: false, reason: 'merge_commit_pending' }
      : waitForMergeCommit(normalizedPrNumber, runner, options);
    return { ok: true, mode, args, ...mergeStatus };
  }

  console.error(`[PR Manager] Merge failed: ${formatGhError(result)}`);
  return { ok: false, mode: 'failed', args, error: formatGhError(result) };
}

async function managePrs(prNumber = '', runner = runGh, options = {}) {
  const prs = loadManagedPrs(prNumber, runner).filter(Boolean);

  if (prs.length === 0) {
    console.log('[PR Manager] No open pull requests found.');
    return { status: 'noop', prs: [] };
  }

  const results = [];
  for (const pr of prs) {
    const outcome = await resolveBlockers(pr, runner);
    if (outcome.status === 'ready') {
      const mergeResult = performMerge(pr, runner, options);
      outcome.mergeRequested = mergeResult.ok;
      outcome.mergeMode = mergeResult.mode;
      if (mergeResult.mergeCommit) {
        outcome.mergeCommit = mergeResult.mergeCommit;
      }
      if (mergeResult.finalized !== undefined) {
        outcome.mergeFinalized = mergeResult.finalized;
      }
      if (mergeResult.reason) {
        outcome.mergeResolution = mergeResult.reason;
      }
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
  assertSafeGhArgs,
  buildGhEnv,
  getPrStatus,
  getPrChecks,
  listOpenPrs,
  isOpenPr,
  loadManagedPrs,
  normalizePrNumber,
  resolveBlockers,
  resolveGhBinary,
  waitForMergeCommit,
  performMerge,
  managePrs,
  summarizeChecks,
};
