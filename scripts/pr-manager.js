#!/usr/bin/env node
/**
 * PR Manager — High-Throughput Merge & Blocker Diagnosis
 * 
 * Inspired by the 2026 GitHub 'Quick Access' update. Centralizes merge status 
 * detection and triggers autonomous self-healing for common blockers.
 */

'use strict';

const { spawnSync } = require('child_process');

/**
 * Fetch granular PR status using GH CLI
 */
function getPrStatus(prNumber = '') {
  const args = ['pr', 'view'];
  if (prNumber) args.push(prNumber);
  args.push('--json', 'number,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision,isDraft,title');

  const result = spawnSync('gh', args, { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`Failed to fetch PR status: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

/**
 * Diagnose and resolve blockers autonomously
 */
async function resolveBlockers(pr) {
  console.log(`[PR Manager] Diagnosing PR #${pr.number}: "${pr.title}"`);
  console.log(`[PR Manager] Merge State: ${pr.mergeStateStatus} | Mergeable: ${pr.mergeable}`);

  if (pr.isDraft) {
    console.log('[PR Manager] PR is a draft. Skipping.');
    return { status: 'skipped', reason: 'draft' };
  }

  // 1. Handle Outdated Branch (BEHIND)
  if (pr.mergeStateStatus === 'BEHIND') {
    console.log('[PR Manager] PR is behind main. Triggering auto-update...');
    const update = spawnSync('gh', ['pr', 'update-branch', pr.number.toString()], { encoding: 'utf-8' });
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
  const failingChecks = (pr.statusCheckRollup || [])
    .filter(check => check.conclusion === 'FAILURE' || check.conclusion === 'ACTION_REQUIRED');
  
  if (failingChecks.length > 0) {
    console.log(`[PR Manager] BLOCKED: ${failingChecks.length} failing CI checks.`);
    return { status: 'blocked', reason: 'ci_failure', checks: failingChecks.map(c => c.name) };
  }

  // 4. Handle Review Blockers
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    console.log('[PR Manager] BLOCKED: Changes requested by reviewer.');
    return { status: 'blocked', reason: 'changes_requested' };
  }

  // 5. Ready to Merge
  if (pr.mergeStateStatus === 'CLEAN' || pr.mergeStateStatus === 'BLOCKED' /* admin bypass potential */) {
    if (pr.mergeable === 'MERGEABLE') {
      console.log('[PR Manager] SUCCESS: PR is ready for autonomous merge.');
      return { status: 'ready' };
    }
  }

  return { status: 'pending', reason: 'unknown_state' };
}

/**
 * Perform autonomous merge
 */
function performMerge(prNumber) {
  console.log(`[PR Manager] Initiating squash merge for PR #${prNumber}...`);
  const result = spawnSync('gh', ['pr', 'merge', prNumber.toString(), '--squash', '--delete-branch', '--admin'], { encoding: 'utf-8' });
  if (result.status === 0) {
    console.log(`[PR Manager] Merged PR #${prNumber} successfully.`);
    return true;
  } else {
    console.error(`[PR Manager] Merge failed: ${result.stderr}`);
    return false;
  }
}

if (require.main === module) {
  const prNum = process.argv[2];
  try {
    const pr = getPrStatus(prNum);
    resolveBlockers(pr).then(res => {
      if (res.status === 'ready') {
        performMerge(pr.number);
      }
      process.exit(0);
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { getPrStatus, resolveBlockers, performMerge };
