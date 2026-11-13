/**
 * Workload-Aware Parallelization Guard for AI-Proposed Optimizations.
 * 
 * Inspired by Maude Lemaire (Scaling Slack, GitHub, and Cursor):
 * "Verify LLM performance optimizations against real usage distributions:
 * Do not blindly accept an LLM's suggestion to parallelize independent tasks.
 * If the longest task remains the bottleneck and the other parallelized tasks
 * are only triggered by 1% of users, parallelization merely wastes compute
 * and increases system load."
 */

'use strict';

class WorkloadParallelizationGuard {
  constructor(options = {}) {
    // If the bottleneck dominates more than this fraction of runtime,
    // parallelizing the rest yields negligible gain (Amdahl's Law).
    this.bottleneckDominanceThreshold = options.bottleneckDominanceThreshold || 0.70;
    // Tasks run by fewer than this fraction of users shouldn't incur concurrency overhead.
    this.minTrafficDistributionThreshold = options.minTrafficDistributionThreshold || 0.05; // 5%
  }

  evaluateParallelizationProposal(proposal) {
    const {
      name,
      tasks = [], // Array of { name, durationMs, trafficFraction, concurrencyCost }
      estimatedOverheadMs = 15, // Thread/event-loop dispatch & synchronization overhead
    } = proposal;

    if (!tasks || tasks.length <= 1) {
      return {
        approved: false,
        reason: 'At least 2 tasks are required for parallelization evaluation.',
      };
    }

    const totalSequentialMs = tasks.reduce((sum, t) => sum + (t.durationMs || 0), 0);
    const sortedTasks = [...tasks].sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0));
    const longestTask = sortedTasks[0];
    const longestDurationMs = longestTask.durationMs || 0;

    // Amdahl's Law critical path limit: in perfect parallel execution, runtime >= longestTask
    const theoreticalParallelMs = longestDurationMs + estimatedOverheadMs;
    const bottleneckRatio = totalSequentialMs > 0 ? (longestDurationMs / totalSequentialMs) : 1.0;
    const theoreticalSpeedupPct = totalSequentialMs > 0
      ? Math.round(((totalSequentialMs - theoreticalParallelMs) / totalSequentialMs) * 100)
      : 0;

    // Traffic distribution check: do all proposed parallel tasks represent real traffic?
    const lowTrafficTasks = tasks.filter(
      (t) => t.trafficFraction !== undefined && t.trafficFraction < this.minTrafficDistributionThreshold
    );

    // Decision Logic
    const isBottleneckDominated = bottleneckRatio >= this.bottleneckDominanceThreshold;
    const hasLowTrafficWaste = lowTrafficTasks.length > 0;
    const isNegligibleSpeedup = theoreticalSpeedupPct <= 10; // Less than 10% improvement

    let approved = true;
    const warnings = [];

    if (isBottleneckDominated) {
      approved = false;
      warnings.push(
        `Bottleneck Dominance: '${longestTask.name}' accounts for ${Math.round(bottleneckRatio * 100)}% of total execution time. Parallelizing remaining tasks yields negligible improvement while wasting concurrency resources.`
      );
    }

    if (hasLowTrafficWaste) {
      approved = false;
      warnings.push(
        `Low Traffic Distribution: Tasks [${lowTrafficTasks.map((t) => t.name).join(', ')}] are triggered by <${Math.round(this.minTrafficDistributionThreshold * 100)}% of requests. Eager parallelization increases system load for rare paths.`
      );
    }

    if (isNegligibleSpeedup) {
      approved = false;
      warnings.push(
        `Negligible Theoretical Speedup: Estimated speedup is only ${theoreticalSpeedupPct}%, which does not justify the concurrency/race-condition risk and event-loop overhead.`
      );
    }

    return {
      approved,
      proposalName: name || 'unnamed-optimization',
      totalSequentialMs,
      theoreticalParallelMs,
      theoreticalSpeedupPct,
      bottleneckRatio: Math.round(bottleneckRatio * 100) / 100,
      longestTask: longestTask.name,
      warnings,
      verdict: approved ? 'APPROVE_PARALLELIZATION' : 'REJECT_PARALLELIZATION',
      recommendation: approved
        ? 'Optimization verified against workload distribution. Proceed with bounded concurrency.'
        : 'Reject parallelization. Keep sequential execution or optimize the bottleneck task directly.',
    };
  }
}

module.exports = {
  WorkloadParallelizationGuard,
};
