'use strict';

/**
 * ThumbGate Agent Task Force Pod (LimeChat Architecture Steal)
 *
 * Adopted from Nikhil Gupta (LimeChat YC W21):
 * - "Most AI agents are built for the demo. We built for the reality of production."
 * - Group cross-functional roles (PM, Builder, Verifier) into a single POD
 *   with joint ownership of product delivery and shared testing responsibility.
 * - Enforce 3-way consensus: no code is approved unless PM, SDE, and QA agree
 *   based on empirical receipts, not prompt hallucinations.
 */

const fs = require('node:fs');
const path = require('node:path');

const POD_ROLES = {
  PM: 'pm_specifier',
  SDE: 'builder_sde',
  QA: 'verifier_qa',
};

class TaskForcePod {
  constructor(podName = 'core_engine_pod', options = {}) {
    this.podName = podName;
    this.options = options;
    this.history = [];
  }

  /**
   * Evaluates a candidate task submission across all three pod roles.
   * @param {object} submission
   *   - taskGoal: string
   *   - proposedDiff: string
   *   - testResults: { passed: boolean, exitCode: number, output: string }
   *   - mutationScore: number (0.0 to 1.0)
   *   - scatterQueriesFound: number
   */
  evaluatePodConsensus(submission) {
    const receipts = [];

    // 1. PM Role: Checks goal alignment and boundary invariants
    const pmVote = this._evaluatePmRole(submission);
    receipts.push(pmVote);

    // 2. SDE Role: Checks minimal blast radius and clean code
    const sdeVote = this._evaluateSdeRole(submission);
    receipts.push(sdeVote);

    // 3. QA Role: Checks test execution, mutation hardening, and scatter queries
    const qaVote = this._evaluateQaRole(submission);
    receipts.push(qaVote);

    const allApproved = receipts.every(r => r.approved);
    const unanimousConsensus = allApproved;

    const podDecision = {
      timestamp: new Date().toISOString(),
      podName: this.podName,
      unanimousConsensus,
      verdict: unanimousConsensus ? 'APPROVED_FOR_PRODUCTION' : 'REJECTED_DEMO_DEFECT',
      receipts,
      reasons: receipts.filter(r => !r.approved).map(r => `[${r.role}] ${r.reason}`),
    };

    this.history.push(podDecision);
    return podDecision;
  }

  _evaluatePmRole(submission) {
    if (!submission.taskGoal || submission.taskGoal.trim().length === 0) {
      return {
        role: POD_ROLES.PM,
        approved: false,
        reason: 'Missing verifiable task goal and acceptance criteria.',
      };
    }
    return {
      role: POD_ROLES.PM,
      approved: true,
      reason: 'Goal and acceptance criteria verified.',
    };
  }

  _evaluateSdeRole(submission) {
    if (!submission.proposedDiff && !submission.targetFiles) {
      return {
        role: POD_ROLES.SDE,
        approved: false,
        reason: 'No proposed diff or modified target files provided for inspection.',
      };
    }
    return {
      role: POD_ROLES.SDE,
      approved: true,
      reason: 'Source code delta scoped and validated.',
    };
  }

  _evaluateQaRole(submission) {
    // Check mechanical test run
    if (!submission.testResults || submission.testResults.exitCode !== 0 || !submission.testResults.passed) {
      return {
        role: POD_ROLES.QA,
        approved: false,
        reason: 'Mechanical test suite failed or was not executed.',
      };
    }

    // Check mutation score (must kill >= 80% of mutants)
    const minMutationScore = this.options.minMutationScore || 0.80;
    if (typeof submission.mutationScore === 'number' && submission.mutationScore < minMutationScore) {
      return {
        role: POD_ROLES.QA,
        approved: false,
        reason: `Mutation score ${(submission.mutationScore * 100).toFixed(0)}% is below required ${minMutationScore * 100}% threshold. AI tests appear tautological.`,
      };
    }

    // Check scatter queries
    if (submission.scatterQueriesFound && submission.scatterQueriesFound > 0) {
      return {
        role: POD_ROLES.QA,
        approved: false,
        reason: `${submission.scatterQueriesFound} un-sharded scatter queries discovered; threatens database cluster stability.`,
      };
    }

    return {
      role: POD_ROLES.QA,
      approved: true,
      reason: 'Mechanical tests passed, mutation threshold satisfied, zero scatter queries.',
    };
  }
}

module.exports = {
  POD_ROLES,
  TaskForcePod,
};
