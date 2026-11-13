/**
 * Lazy CI Pipeline & Intelligent Cancellation for Agent Swarms.
 * 
 * Inspired by Mitch Ashley & Brad Shimmin (Agents of Dev Ep 44):
 * "Implement 'Lazy Pull Requests' and intelligent CI cancellation:
 * As agent swarms turn commits and PRs into continuous background saves,
 * traditional full-pipeline runs become unsustainable. Re-architect CI/CD
 * pipelines to evaluate only critical diffs immediately while deferring heavier
 * checks, and implement contextual pipeline logic that automatically halts
 * running PR builds when a newly submitted PR supersedes or negates the in-flight work."
 */

'use strict';

class LazyCiPipeline {
  constructor(options = {}) {
    // In-flight builds: map of buildId -> { prNumber, branch, commitSha, startedAt, status, tier }
    this.activeBuilds = new Map();
  }

  enqueueBuild(buildRequest) {
    const { prNumber, branch, commitSha, changedFiles = [] } = buildRequest;

    // Check for running builds on the same branch or PR that are now superseded!
    const supersededBuilds = [];
    for (const [activeId, build] of this.activeBuilds.entries()) {
      if (build.status === 'RUNNING' && (build.prNumber === prNumber || build.branch === branch)) {
        build.status = 'CANCELLED_SUPERSEDED';
        build.cancelledByCommit = commitSha;
        supersededBuilds.push(activeId);
      }
    }

    // Determine Lazy CI Execution Tier based on critical diff analysis
    // Tier 1: 'FAST_DIFF' (Docs, markdown, comments only -> skip integration/e2e)
    // Tier 2: 'UNIT_ONLY' (Single module changed with existing tests)
    // Tier 3: 'FULL_SUITE' (Core runtime, database migrations, security, or cross-repo touched)
    let executionTier = 'FAST_DIFF';
    const isCoreTouched = changedFiles.some((f) =>
      /(core|engine|db|migration|security|package\.json|lock)/i.test(f)
    );
    const isCodeTouched = changedFiles.some((f) => /\.(js|ts|py|swift|go|rs)$/i.test(f));

    if (isCoreTouched) {
      executionTier = 'FULL_SUITE';
    } else if (isCodeTouched) {
      executionTier = 'UNIT_ONLY';
    }

    const buildId = `build_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newBuild = {
      buildId,
      prNumber,
      branch,
      commitSha,
      status: 'RUNNING',
      tier: executionTier,
      changedFilesCount: changedFiles.length,
      startedAt: new Date().toISOString(),
      cancelledSupercededCount: supersededBuilds.length,
    };

    this.activeBuilds.set(buildId, newBuild);

    return {
      build: newBuild,
      supersededBuildsCancelled: supersededBuilds,
      savedComputeHours: supersededBuilds.length * 0.25, // Assuming average build is 15min
    };
  }

  completeBuild(buildId, success = true) {
    const build = this.activeBuilds.get(buildId);
    if (!build) return null;

    if (build.status === 'RUNNING') {
      build.status = success ? 'COMPLETED_SUCCESS' : 'COMPLETED_FAILURE';
      build.finishedAt = new Date().toISOString();
    }
    return build;
  }

  getActiveBuilds() {
    return Array.from(this.activeBuilds.values());
  }
}

module.exports = {
  LazyCiPipeline,
};
