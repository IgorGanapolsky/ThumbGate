#!/usr/bin/env node
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

const SELF_REFERENTIAL_CHECKS = new Set(MERGE_QUALITY_CHECKS.selfReferentialChecks || []);
// Optional checks are ignored by summarizeChecks. Vercel is optional because it
// is not in requiredStatusCheckContexts / classic branch protection; free-tier
// deploy rate-limits must not stall Trunk when required checks are green.
const OPTIONAL_CHECKS = new Set(MERGE_QUALITY_CHECKS.optionalChecks || []);

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
    || /could not determine current branch:.*not on any branch/i.test(formatGhError(result));
}

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

    if (SELF_REFERENTIAL_CHECKS.has(name)) continue;
    if (OPTIONAL_CHECKS.has(name)) continue;

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
 * Read-only repository ruleset inventory for diagnosis.
 * Never mutates rulesets or bypass actors.
 */
function inspectRepositoryRulesets(repo = '', runner = runGh) {
  const normalizedRepo = String(repo || '').trim();
  const args = normalizedRepo
    ? ['api', `repos/${normalizedRepo}/rulesets`, '-H', 'Accept: application/vnd.github+json']
    : ['api', 'repos/{owner}/{repo}/rulesets', '-H', 'Accept: application/vnd.github+json'];

  try {
    const result = runner(args);
    if (result && result.status === 0 && result.stdout) {
      const rulesets = JSON.parse(result.stdout);
      if (Array.isArray(rulesets)) {
        return {
          ok: true,
          count: rulesets.length,
          activeRulesets: rulesets
            .filter((rs) => String(rs?.enforcement || '').toLowerCase() === 'active')
            .map((rs) => ({
              id: rs.id,
              name: rs.name,
              target: rs.target || 'branch',
              enforcement: rs.enforcement,
            })),
        };
      }
    }
  } catch {
    // Diagnostic only — never block merges on inventory failure.
  }

  return { ok: false, count: 0, activeRulesets: [] };
}

async function resolveBlockers(pr, runner = runGh) {
  const title = pr.title || 'Untitled PR';
  const mergeState = pr.mergeStateStatus || 'UNKNOWN';
  const mergeable = pr.mergeable || 'UNKNOWN';

  console.log(`[PR Manager] Diagnosing PR #${pr.number}: "${title}"`);
  console.log(`[PR Manager] Merge State: ${mergeState} | Mergeable: ${mergeable}`);

  // Live-default runner only: injected test runners must not have their mock
  // queues consumed by optional ruleset inventory.
  if (runner === runGh) {
    try {
      const rulesetInventory = inspectRepositoryRulesets('', runner);
      if (rulesetInventory.ok) {
        const names = rulesetInventory.activeRulesets.map((rs) => rs.name).join(', ') || '(none)';
        console.log(
          `[PR Manager] Repository rulesets: ${rulesetInventory.count} total, `
          + `${rulesetInventory.activeRulesets.length} active [${names}]`,
        );
      } else {
        console.log('[PR Manager] Repository rulesets: unavailable (diagnostic only)');
      }
    } catch {
      console.log('[PR Manager] Repository rulesets: unavailable (diagnostic only)');
    }
  }

  if (pr.isDraft) {
    console.log('[PR Manager] PR is a draft. Skipping.');
    return { status: 'skipped', reason: 'draft' };
  }

  if (pr.mergeStateStatus === 'BEHIND') {
    console.log('[PR Manager] PR is behind main. Triggering auto-update...');
    const update = runner(['pr', 'update-branch', pr.number.toString()]);
    if (update.status === 0) {
      return { status: 'healing', action: 'update-branch' };
    }
  }

  if (pr.mergeStateStatus === 'DIRTY' || pr.mergeable === 'CONFLICTING') {
    console.log('[PR Manager] CRITICAL: Merge conflicts detected. Manual intervention or advanced rebase required.');
    return { status: 'blocked', reason: 'conflicts' };
  }

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

  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    console.log('[PR Manager] BLOCKED: Changes requested by reviewer.');
    return { status: 'blocked', reason: 'changes_requested' };
  }

  if (pr.reviewDecision === 'REVIEW_REQUIRED') {
    console.log('[PR Manager] BLOCKED: Required review is still outstanding.');
    return { status: 'blocked', reason: 'review_required' };
  }

  if (
    (pr.mergeStateStatus === 'CLEAN' || pr.mergeStateStatus === 'UNSTABLE' || pr.mergeStateStatus === 'BLOCKED')
    && pr.mergeable === 'MERGEABLE'
  ) {
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

// Stale-PR steward. It never closes a PR. Claude Ship's PR Steward fixes PRs
// instead of closing them; the free version here does the mechanical part
// (rebase a branch that fell behind main) and labels the rest so the daily
// steward agent session (docs/ops/ship-pipeline.md) can fix the code.
// History: the old sweeper closed #5131 after 3 days as a draft.
const SWEEP_PR_FIELDS = 'number,state,isDraft,title,url,headRefName,headRefOid,baseRefName,updatedAt,createdAt,author,statusCheckRollup,mergeStateStatus,mergeable,labels';
// main has no "require up to date" rule, so GitHub never reports BEHIND here.
// The steward asks the compare API instead and updates a branch this far back.
const SWEEP_BEHIND_THRESHOLD = 3;
const SWEEP_LIST_LIMIT = '1000';
const SWEEP_REQUIRED_CHECKS_BASE = 'main';
const DEFAULT_RED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DRAFT_IDLE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const REQUIRED_CHECK_SET = new Set(MERGE_QUALITY_CHECKS.requiredStatusCheckContexts || []);
const STEWARD_LABELS = {
  stale: 'stale',
  needsFix: 'needs-fix',
  needsRebase: 'needs-rebase',
};
const STEWARD_LABEL_STYLE = {
  stale: ['C5DEF5', 'Steward: draft idle over 3 days'],
  'needs-fix': ['D93F0B', 'Ship gate: red checks or open review threads'],
  'needs-rebase': ['FBCA04', 'Steward: conflicts with main'],
};

/** Add a label, creating it first if the repo does not have it yet. */
function addStewardLabel(number, label, runner) {
  let res = runner(['pr', 'edit', String(number), '--add-label', label]);
  if (res.status !== 0 && /not found/i.test(formatGhError(res))) {
    const [color, description] = STEWARD_LABEL_STYLE[label] || ['EDEDED', 'Steward'];
    runner(['label', 'create', label, '--color', color, '--description', description]);
    res = runner(['pr', 'edit', String(number), '--add-label', label]);
  }
  return res;
}

function isProtectedSweepBranch(pr = {}) {
  const headRef = String(pr.headRefName || '').trim();
  const authorLogin = String(pr.author?.login || '').trim().toLowerCase();
  if (headRef.startsWith('dependabot/') || headRef.startsWith('trunk-merge/')) {
    return true;
  }
  return authorLogin === 'dependabot[bot]' || authorLogin === 'app/dependabot' || authorLogin === 'dependabot';
}

function isRequiredCheckFailing(check = {}) {
  const name = check.name || check.context || '';
  if (!name || SELF_REFERENTIAL_CHECKS.has(name) || OPTIONAL_CHECKS.has(name)) {
    return false;
  }
  if (REQUIRED_CHECK_SET.size > 0 && !REQUIRED_CHECK_SET.has(name)) {
    return false;
  }
  const bucket = String(check.bucket || '').toLowerCase();
  if (bucket) {
    return FAILING_BUCKETS.has(bucket);
  }
  const conclusion = String(check.conclusion || check.state || '').toUpperCase();
  return FAILING_CHECK_CONCLUSIONS.has(conclusion) || conclusion === 'ERROR';
}

function prLabels(pr = {}) {
  return new Set((pr.labels || []).map((l) => (typeof l === 'string' ? l : l.name)));
}

function classifyStalePr(pr = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const redMaxAgeMs = Number.isFinite(options.redMaxAgeMs) ? options.redMaxAgeMs : DEFAULT_RED_MAX_AGE_MS;
  const draftIdleMaxAgeMs = Number.isFinite(options.draftIdleMaxAgeMs)
    ? options.draftIdleMaxAgeMs
    : DEFAULT_DRAFT_IDLE_MAX_AGE_MS;
  const labels = prLabels(pr);

  if (isProtectedSweepBranch(pr)) {
    return { action: 'skip', reason: 'protected_branch', headRefName: pr.headRefName || '' };
  }
  if (labels.has('do-not-merge')) {
    return { action: 'skip', reason: 'on_hold' };
  }

  // A branch behind main is rebased whatever else is going on: that alone
  // often turns red checks green, and it keeps drafts mergeable.
  if (String(pr.mergeStateStatus || '').toUpperCase() === 'BEHIND') {
    return { action: 'update_branch', reason: 'behind_main' };
  }
  const behindThreshold = Number.isFinite(options.behindThreshold) ? options.behindThreshold : SWEEP_BEHIND_THRESHOLD;
  if (Number.isFinite(pr.behindBy) && pr.behindBy >= behindThreshold
    && String(pr.mergeStateStatus || '').toUpperCase() !== 'DIRTY') {
    // A merge update, not a rebase: it never rewrites a branch an agent may be working on.
    return { action: 'update_branch', reason: 'behind_main_by_commits', behindBy: pr.behindBy, rebase: false };
  }
  if (String(pr.mergeStateStatus || '').toUpperCase() === 'DIRTY' || String(pr.mergeable || '').toUpperCase() === 'CONFLICTING') {
    return labels.has(STEWARD_LABELS.needsRebase)
      ? { action: 'keep', reason: 'conflict_already_flagged' }
      : {
        action: 'label',
        label: STEWARD_LABELS.needsRebase,
        reason: 'merge_conflict',
        comment: `PR #${pr.number} has a merge conflict with \`main\`. Labelled \`${STEWARD_LABELS.needsRebase}\`; the steward session rebases it and resolves the conflict. Nothing was closed.`,
      };
  }

  if (pr.isDraft) {
    const updatedMs = Date.parse(pr.updatedAt || pr.createdAt || '');
    if (Number.isFinite(updatedMs) && (nowMs - updatedMs) > draftIdleMaxAgeMs) {
      const idleDays = Math.floor((nowMs - updatedMs) / (24 * 60 * 60 * 1000));
      if (labels.has(STEWARD_LABELS.stale)) {
        return { action: 'keep', reason: 'draft_idle_already_flagged', idleDays };
      }
      return {
        action: 'label',
        label: STEWARD_LABELS.stale,
        reason: 'draft_idle_over_3d',
        idleDays,
        comment: `Draft PR #${pr.number} has been idle ${idleDays}d. Labelled \`${STEWARD_LABELS.stale}\` so the steward session finishes it (tests, then ready for review). It stays open.`,
      };
    }
    return { action: 'keep', reason: 'draft_active' };
  }

  const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  const failingRequired = checks.filter((check) => isRequiredCheckFailing(check));
  if (failingRequired.length > 0 && String(pr.baseRefName || '') !== SWEEP_REQUIRED_CHECKS_BASE) {
    return { action: 'keep', reason: 'required_checks_unknown_for_base', baseRefName: pr.baseRefName || '' };
  }
  if (failingRequired.length > 0) {
    const checkTimestamps = failingRequired
      .map((check) => Date.parse(check.completedAt || check.startedAt || ''))
      .filter((ts) => Number.isFinite(ts));
    const fallbackMs = Date.parse(pr.updatedAt || pr.createdAt || '');
    const redSinceMs = checkTimestamps.length > 0 ? Math.max(...checkTimestamps) : fallbackMs;
    if (Number.isFinite(redSinceMs) && (nowMs - redSinceMs) > redMaxAgeMs) {
      const redHours = Math.floor((nowMs - redSinceMs) / (60 * 60 * 1000));
      const failingNames = [...new Set(failingRequired.map((c) => c.name || c.context))];
      if (labels.has(STEWARD_LABELS.needsFix)) {
        return { action: 'keep', reason: 'red_already_flagged', redHours, failingChecks: failingNames };
      }
      return {
        action: 'label',
        label: STEWARD_LABELS.needsFix,
        reason: 'red_checks_over_24h',
        redHours,
        failingChecks: failingNames,
        comment: `Required check(s) ${failingNames.join(', ')} on PR #${pr.number} have been red for ${redHours}h. Labelled \`${STEWARD_LABELS.needsFix}\`; the steward session fixes the failure and pushes. It stays open.`,
      };
    }
  }

  return { action: 'keep', reason: 'active' };
}

/**
 * gh pr list often reports mergeable/mergeStateStatus as UNKNOWN (GitHub
 * computes them lazily), and never reports BEHIND without an up-to-date rule.
 * Ask the REST API for the real merge state and how far behind the base the
 * head is. Read-only; skipped when the list gave no head SHA.
 */
function enrichSweepPr(pr, runner) {
  if (!pr || !pr.headRefOid || !pr.baseRefName || !pr.number) {
    return pr;
  }
  const out = { ...pr };
  const state = runner(['api', `repos/{owner}/{repo}/pulls/${pr.number}`, '--jq', '.mergeable_state']);
  if (state.status === 0) {
    const value = String(state.stdout || '').trim().toUpperCase();
    if (value === 'DIRTY') out.mergeStateStatus = 'DIRTY';
    else if (value === 'BEHIND') out.mergeStateStatus = 'BEHIND';
  }
  const compare = runner(['api', `repos/{owner}/{repo}/compare/${pr.baseRefName}...${pr.headRefOid}`, '--jq', '.behind_by']);
  if (compare.status === 0) {
    const behind = Number(String(compare.stdout || '').trim());
    if (Number.isFinite(behind)) out.behindBy = behind;
  }
  return out;
}

function stillNeedsAction(number, verdict, options, runner) {
  const viewResult = runner(['pr', 'view', String(number), '--json', SWEEP_PR_FIELDS]);
  if (viewResult.status !== 0) {
    return false;
  }
  try {
    const fresh = enrichSweepPr(JSON.parse(viewResult.stdout || '{}'), runner);
    const again = classifyStalePr(fresh, options);
    return fresh.state === 'OPEN' && again.action === verdict.action && again.reason === verdict.reason;
  } catch {
    return false;
  }
}

function applyStewardAction(pr, verdict, runner) {
  if (verdict.action === 'update_branch') {
    if (verdict.rebase !== false) {
      const rebase = runner(['pr', 'update-branch', String(pr.number), '--rebase']);
      if (rebase.status === 0) {
        return { applied: true, via: 'rebase' };
      }
    }
    // Rebase can fail on a conflict that a merge commit would not hit.
    const merge = runner(['pr', 'update-branch', String(pr.number)]);
    if (merge.status === 0) {
      return { applied: true, via: 'merge' };
    }
    addStewardLabel(pr.number, STEWARD_LABELS.needsRebase, runner);
    return { applied: false, via: 'flagged', error: formatGhError(merge) };
  }
  if (verdict.action === 'label') {
    const labelRes = addStewardLabel(pr.number, verdict.label, runner);
    if (labelRes.status !== 0) {
      throw new Error(`Failed to label PR #${pr.number}: ${formatGhError(labelRes)}`);
    }
    const commentRes = runner(['pr', 'comment', String(pr.number), '--body', verdict.comment]);
    if (commentRes.status !== 0) {
      throw new Error(`Failed to comment on PR #${pr.number}: ${formatGhError(commentRes)}`);
    }
    return { applied: true };
  }
  return { applied: false };
}

function sweepStalePrs(options = {}, runner = runGh) {
  const dryRun = Boolean(options.dryRun);
  const listResult = runner(['pr', 'list', '--state', 'open', '--limit', SWEEP_LIST_LIMIT, '--json', SWEEP_PR_FIELDS]);
  if (listResult.status !== 0) {
    throw new Error(`Failed to list open PRs for sweep: ${formatGhError(listResult)}`);
  }

  const prs = JSON.parse(listResult.stdout || '[]');
  const decisions = [];
  let actedCount = 0;
  let skippedCount = 0;
  let keptCount = 0;
  let errorCount = 0;

  for (const listed of prs) {
    const pr = isProtectedSweepBranch(listed) ? listed : enrichSweepPr(listed, runner);
    const verdict = classifyStalePr(pr, options);
    const record = {
      number: pr.number,
      title: pr.title || '',
      headRefName: pr.headRefName || '',
      isDraft: Boolean(pr.isDraft),
      ...verdict,
      applied: false,
    };
    delete record.comment;

    if (verdict.action === 'skip') {
      skippedCount += 1;
    } else if (verdict.action === 'keep') {
      keptCount += 1;
    } else if (!dryRun && !stillNeedsAction(pr.number, verdict, options, runner)) {
      record.action = 'keep';
      record.reason = 'eligibility_changed';
      keptCount += 1;
    } else {
      actedCount += 1;
      if (!dryRun) {
        // One PR's failure must not stop the sweep for the rest.
        try {
          Object.assign(record, applyStewardAction(pr, verdict, runner));
        } catch (err) {
          record.error = err.message;
          errorCount += 1;
        }
      }
    }
    decisions.push(record);
  }

  return {
    status: 'ok',
    dryRun,
    actedCount,
    closedCount: 0,
    skippedCount,
    keptCount,
    errorCount,
    decisions,
  };
}


if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.includes('--sweep') || argv.includes('--sweep-stale')) {
    try {
      const summary = sweepStalePrs({
        dryRun: argv.includes('--dry-run'),
      });
      if (argv.includes('--json')) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(
          `[PR Steward] dryRun=${summary.dryRun} acted=${summary.actedCount} skipped=${summary.skippedCount} kept=${summary.keptCount} errors=${summary.errorCount} closed=0`,
        );
      }
      process.exit(summary.errorCount > 0 ? 1 : 0);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  const prNum = argv[0];
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
  classifyStalePr,
  enrichSweepPr,
  getPrStatus,
  getPrChecks,
  isProtectedSweepBranch,
  isRequiredCheckFailing,
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
  sweepStalePrs,
  inspectRepositoryRulesets,
};
