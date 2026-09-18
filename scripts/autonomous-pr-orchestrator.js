#!/usr/bin/env node
'use strict';

/**
 * Autonomous PR & System Hygiene Orchestrator.
 *
 * Enforces:
 * 1. Zero Manual Labor & Anti-Babysitting: Autonomously heals 'BEHIND' PRs, resolves bot review threads,
 *    and enqueues green PRs into Trunk merge queue.
 * 2. Datadog LLM Observability Steals: End-to-end span-level tracing, latency attribution,
 *    sensitive data scrubbing (DLP), and cost/execution metrics.
 * 3. Never Bypass Branch Protection: Pure deterministic automation honoring classic branch protection and rulesets.
 */

const { spawnSync } = require('node:child_process');
const { DatadogAgentObservability } = require('../src/observability/datadog-agent-observability');

const REQUIRED_CHECKS = new Set([
  'test',
]);

const BOT_REVIEW_AUTHORS = new Set([
  'coderabbitai',
  'socket-security',
  'github-actions',
  'vercel',
  'dependabot',
]);

function runGh(args, options = {}) {
  const binary = process.env.THUMBGATE_GH_BIN || 'gh';
  const env = { ...process.env };
  if (!env.GH_TOKEN && !env.GITHUB_TOKEN && env.GH_PAT) {
    env.GH_TOKEN = env.GH_PAT;
  }
  return spawnSync(binary, args, {
    encoding: 'utf-8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function listOpenPrs(runner = runGh) {
  const args = [
    'pr',
    'list',
    '--state',
    'open',
    '--limit',
    '300',
    '--json',
    'number,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,author,comments',
  ];
  const res = runner(args);
  if (res.status !== 0) {
    throw new Error(`Failed to list PRs: ${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout || '[]');
}

function getPrReviewThreads(prNumber, runner = runGh) {
  const query = `
    query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          reviewThreads(first: 50) {
            nodes {
              id
              isResolved
              isOutdated
              comments(first: 5) {
                nodes {
                  id
                  author { login }
                  body
                }
              }
            }
          }
        }
      }
    }
  `;
  const res = runner([
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-F',
    'owner=IgorGanapolsky',
    '-F',
    'repo=ThumbGate',
    '-F',
    `pr=${prNumber}`,
  ]);

  if (res.status !== 0) {
    return [];
  }
  try {
    const data = JSON.parse(res.stdout);
    return data?.data?.repository?.pullRequest?.reviewThreads?.nodes || [];
  } catch {
    return [];
  }
}

function resolveReviewThread(threadId, runner = runGh) {
  const mutation = `
    mutation($threadId: ID!) {
      resolveReviewThread(input: { threadId: $threadId }) {
        thread {
          id
          isResolved
        }
      }
    }
  `;
  const res = runner([
    'api',
    'graphql',
    '-f',
    `query=${mutation}`,
    '-F',
    `threadId=${threadId}`,
  ]);
  return res.status === 0;
}

function updatePrBranch(prNumber, runner = runGh) {
  const res = runner(['pr', 'update-branch', String(prNumber)]);
  return {
    ok: res.status === 0,
    output: (res.stdout || res.stderr || '').trim(),
  };
}

function submitTrunkMerge(prNumber, runner = runGh) {
  const res = runner(['pr', 'comment', String(prNumber), '--body', '/trunk merge']);
  return {
    ok: res.status === 0,
    output: (res.stdout || res.stderr || '').trim(),
  };
}

function evaluateChecks(statusCheckRollup = [], requiredChecks = REQUIRED_CHECKS) {
  const passing = [];
  const failing = [];
  const pending = [];

  for (const check of statusCheckRollup) {
    const name = check.name || check.context || 'unknown';
    const conclusion = (check.conclusion || check.state || '').toUpperCase();
    const status = (check.status || '').toUpperCase();

    if (status === 'IN_PROGRESS' || status === 'QUEUED' || !status) {
      pending.push(name);
      continue;
    }

    if (conclusion === 'SUCCESS' || conclusion === 'NEUTRAL' || conclusion === 'SKIPPED') {
      passing.push(name);
    } else if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(conclusion)) {
      failing.push(name);
    } else {
      pending.push(name);
    }
  }

  const passingSet = new Set(passing);
  const missingRequired = [];
  if (requiredChecks && requiredChecks.size > 0) {
    for (const req of requiredChecks) {
      if (!passingSet.has(req)) {
        missingRequired.push(req);
      }
    }
  }

  const hasEvidence = statusCheckRollup.length > 0;
  const isGreen = hasEvidence && failing.length === 0 && pending.length === 0 && missingRequired.length === 0;
  return { isGreen, passing, failing, pending, missingRequired };
}

async function orchestrateCycle(options = {}, runner = runGh) {
  const { dryRun = false } = options;
  const obs = new DatadogAgentObservability({ serviceName: 'thumbgate-pr-orchestrator' });
  const rootSpan = obs.startTrace('pr_orchestration_cycle');

  console.log('🤖 [Autonomous Orchestrator] Starting PR triage and healing sweep...');

  const discoverySpan = obs.startChildSpan(rootSpan, 'pr_discovery');
  let openPrs = [];
  try {
    openPrs = listOpenPrs(runner);
    discoverySpan.setTag('open_pr_count', openPrs.length);
    discoverySpan.finish('SUCCESS');
  } catch (err) {
    const safeError = new Error(
      obs.scrubSensitiveData(err?.message || String(err))
    );
    discoverySpan.finish('ERROR', safeError);
    rootSpan.finish('ERROR', safeError);
    throw safeError;
  }

  console.log(`🔍 Discovered ${openPrs.length} open pull requests.`);

  const summary = {
    total: openPrs.length,
    updatedBehind: [],
    threadsResolved: [],
    unresolvedThreads: [],
    trunkQueued: [],
    blockedChecks: [],
    conflicts: [],
  };

  for (const pr of openPrs) {
    const prSpan = obs.startChildSpan(rootSpan, `pr_${pr.number}_evaluation`);
    prSpan.setTag('pr_number', pr.number);
    prSpan.setTag('title', obs.scrubSensitiveData(pr.title));
    prSpan.setTag('merge_state', pr.mergeStateStatus);

    // 1. Conflict Check
    if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') {
      summary.conflicts.push(pr.number);
      prSpan.setTag('status', 'CONFLICTING');
      prSpan.finish('SUCCESS');
      continue;
    }

    // 2. Unresolved review threads under required_conversation_resolution
    // Never auto-resolve active threads without verified fixes. Outdated bot threads may be resolved.
    const threads = getPrReviewThreads(pr.number, runner);
    const unresolvedThreads = threads.filter((t) => !t.isResolved);
    const activeBlockers = [];

    for (const thread of unresolvedThreads) {
      const firstComment = thread.comments?.nodes?.[0];
      const author = (firstComment?.author?.login || '').toLowerCase();
      const isBot = BOT_REVIEW_AUTHORS.has(author);

      if (thread.isOutdated && isBot) {
        if (!dryRun) {
          const resolved = resolveReviewThread(thread.id, runner);
          if (resolved) {
            summary.threadsResolved.push({ pr: pr.number, threadId: thread.id });
            console.log(`  ✅ Resolved outdated bot review thread ${thread.id} on PR #${pr.number}`);
          }
        }
      } else {
        activeBlockers.push(thread);
      }
    }

    if (activeBlockers.length > 0) {
      summary.unresolvedThreads.push({ pr: pr.number, count: activeBlockers.length });
      console.log(`  ⚠️ PR #${pr.number} has ${activeBlockers.length} active unresolved review threads. Leaving as blocker.`);
      prSpan.setTag('status', 'ACTIVE_REVIEW_THREADS');
      prSpan.finish('SUCCESS');
      continue;
    }

    // 3. Handle 'BEHIND' PRs: Auto-update branch on top of latest main
    if (pr.mergeStateStatus === 'BEHIND') {
      console.log(`  🔄 PR #${pr.number} is BEHIND main. Triggering automated update-branch...`);
      if (!dryRun) {
        const updateRes = updatePrBranch(pr.number, runner);
        if (updateRes.ok) {
          summary.updatedBehind.push(pr.number);
          console.log(`    ✓ PR #${pr.number} branch updated to main.`);
        } else {
          console.warn(`    ⚠️ Failed to update PR #${pr.number}: ${updateRes.output}`);
        }
      }
      prSpan.finish('SUCCESS');
      continue;
    }

    // 4. Check status rollup
    const checkEval = evaluateChecks(pr.statusCheckRollup || []);
    if (!checkEval.isGreen) {
      summary.blockedChecks.push({
        number: pr.number,
        failing: checkEval.failing,
        pending: checkEval.pending,
        missingRequired: checkEval.missingRequired,
      });
      prSpan.setTag('status', 'BLOCKED_CHECKS');
      prSpan.finish('SUCCESS');
      continue;
    }

    // 5. Review Check: reject outstanding review states
    if (pr.reviewDecision === 'REVIEW_REQUIRED' || pr.reviewDecision === 'CHANGES_REQUESTED') {
      console.log(`  ⏸️ PR #${pr.number} blocked by review state (${pr.reviewDecision}).`);
      prSpan.setTag('status', 'REVIEW_REQUIRED');
      prSpan.finish('SUCCESS');
      continue;
    }

    // 6. Green PR: Enqueue to Trunk if not already queued
    const isAlreadyQueued = (pr.comments || []).some(
      (c) => c.body && c.body.includes('/trunk merge')
    );

    if (
      !isAlreadyQueued &&
      (pr.mergeStateStatus === 'CLEAN' || pr.mergeStateStatus === 'BLOCKED') &&
      pr.mergeable === 'MERGEABLE'
    ) {
      console.log(`  🚀 PR #${pr.number} is green and ready. Submitting to Trunk merge queue...`);
      if (!dryRun) {
        const mergeRes = submitTrunkMerge(pr.number, runner);
        if (mergeRes.ok) {
          summary.trunkQueued.push(pr.number);
          console.log(`    ✓ Enqueued PR #${pr.number} (/trunk merge).`);
        }
      }
    }

    prSpan.finish('SUCCESS');
  }

  rootSpan.finish('SUCCESS');
  const traceSummary = obs.exportTraceSummary(rootSpan.traceId);

  return {
    summary,
    trace: traceSummary,
  };
}

if (require.main === module) {
  const isDrainMode = process.argv.includes('--drain');
  const isDryRun = process.argv.includes('--dry-run');

  orchestrateCycle({ dryRun: isDryRun })
    .then((result) => {
      console.log('\n📊 [Cycle Complete]');
      console.log(`- Updated behind PRs: ${result.summary.updatedBehind.length}`);
      console.log(`- Bot threads resolved: ${result.summary.threadsResolved.length}`);
      console.log(`- Enqueued to Trunk: ${result.summary.trunkQueued.length}`);
      console.log(`- Blocked on checks: ${result.summary.blockedChecks.length}`);
      console.log(`- Conflicting: ${result.summary.conflicts.length}`);
      console.log(`- Trace ID: ${result.trace.traceId} (Duration: ${result.trace.durationMs}ms)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal orchestrator failure:', err);
      process.exit(1);
    });
}

module.exports = {
  orchestrateCycle,
  evaluateChecks,
  listOpenPrs,
  getPrReviewThreads,
  resolveReviewThread,
  updatePrBranch,
  submitTrunkMerge,
  runGh,
  REQUIRED_CHECKS,
  BOT_REVIEW_AUTHORS,
};
