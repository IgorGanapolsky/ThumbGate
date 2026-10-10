#!/usr/bin/env node
'use strict';

/**
 * ActiveSaddler Curriculum Doctor — Compare, Do Not Clone
 *
 * Stolen from ActiveSaddler (arXiv:2610.00906):
 * "Automated Curriculum Learning for Agent Harness Optimization"
 *
 * Implements the non-stationary Multi-Armed Bandit (MAB) curriculum for agent harness optimization:
 * 1. Dynamic Failure-Pattern Arms: abstracts agent mistakes into adaptive bandit arms.
 * 2. Discounted UCB Scoring: balances exploitation (frequent/severe failures) with exploration (detecting regression drift).
 * 3. Fail-Fast Rule Prioritization: orders pre-tool validation so high-risk rules execute first (<0.5ms).
 * 4. Grounded Arm Decay & Promotion: elevates recurring failure patterns and retires zero-violation rules with confidence bounds.
 *
 * Strictly fail-closed: Refuses external heavy RL/PyTorch dependencies. Pure CPU-local JS (<1ms budget).
 */

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const COMPARISON_MAP = {
  paradigm: 'ActiveSaddler (arXiv:2610.00906) vs. ThumbGate Dynamic Curriculum',
  verdict: 'COMPARE_NOT_CLONE',
  stolenPractices: [
    {
      practice: 'Dynamic Failure-Pattern Arms',
      activesaddler: 'Automated clustering of execution traces into non-stationary task arms',
      thumbgate: 'Abstracts MistakePatterns into FailurePatternArms with severity and violation rates'
    },
    {
      practice: 'Discounted UCB Policy',
      activesaddler: 'Adaptive non-stationary bandit balancing known harness weaknesses and exploration',
      thumbgate: 'Discounted UCB score weighting recent failure recency, severity, and exploration bonus'
    },
    {
      practice: 'Fail-Fast Rule Prioritization',
      activesaddler: 'Curriculum schedules high-difficulty evaluation environments first',
      thumbgate: 'PreToolUse pipeline evaluates high-bandit-score prevention rules first (<0.5ms budget)'
    },
    {
      practice: 'Automated Drift Detection',
      activesaddler: 'Triggers curriculum re-weighting when agent policy shifts or regresses',
      thumbgate: 'Detects distribution shift across failure categories and updates gate thresholds'
    }
  ],
  antiCloneRules: [
    'NEVER install PyTorch, Ray, Stable-Baselines, or external RL frameworks',
    'NEVER spin up GPU training loops or heavy reinforcement learners in CI',
    'ALWAYS maintain deterministic CPU-local bandit math (<1ms evaluation latency)',
    'ALWAYS keep failure pattern state in local-first structured JSON receipts'
  ]
};

const SEVERITY_MULTIPLIERS = {
  CRITICAL: 3.0,
  HIGH: 2.0,
  MEDIUM: 1.2,
  LOW: 1.0
};

const CANONICAL_FAILURE_ARMS = [
  {
    id: 'arm:force-push-main',
    name: 'Destructive Force-Push on Main',
    severity: 'CRITICAL',
    baselineFrequency: 0.05,
    description: 'Agent attempts git push --force origin main'
  },
  {
    id: 'arm:bypass-branch-protection',
    name: 'Branch Protection Bypass',
    severity: 'CRITICAL',
    baselineFrequency: 0.04,
    description: 'Agent attempts PR self-approval or admin merge override'
  },
  {
    id: 'arm:token-shunt-overflow',
    name: 'Unbounded Token Shunt Dump',
    severity: 'MEDIUM',
    baselineFrequency: 0.15,
    description: 'Agent dumps massive unindexed log or data files (>350 lines)'
  },
  {
    id: 'arm:untracked-peer-clean',
    name: 'Destructive Untracked File Clean',
    severity: 'HIGH',
    baselineFrequency: 0.08,
    description: 'Agent runs git clean -fd wiping peer agent worktree files'
  },
  {
    id: 'arm:runaway-halo-loop',
    name: 'Runaway Agent Re-query Loop',
    severity: 'HIGH',
    baselineFrequency: 0.10,
    description: 'Agent loops over failing subagent queries burning token budgets'
  }
];

class ActiveSaddlerCurriculum {
  constructor(options = {}) {
    this.discountFactor = options.discountFactor || 0.92;
    this.explorationWeight = options.explorationWeight || 0.35;
    this.arms = new Map();
    this.history = [];
    this.totalSteps = 0;

    // Initialize canonical arms
    for (const arm of CANONICAL_FAILURE_ARMS) {
      this.registerArm(arm);
    }
  }

  registerArm(armConfig) {
    if (!armConfig || !armConfig.id) {
      throw new Error('Arm configuration must have an id');
    }
    const severity = armConfig.severity || 'MEDIUM';
    const multiplier = SEVERITY_MULTIPLIERS[severity] || 1.0;
    this.arms.set(armConfig.id, {
      id: armConfig.id,
      name: armConfig.name || armConfig.id,
      severity,
      multiplier,
      pulls: 0,
      violations: 0,
      discountedPulls: 0,
      discountedViolations: 0,
      lastObservedAt: null,
      description: armConfig.description || ''
    });
  }

  recordObservation(armId, observation = {}) {
    const arm = this.arms.get(armId);
    if (!arm) {
      throw new Error(`Unknown failure pattern arm: ${armId}`);
    }

    const isViolation = Boolean(observation.violation);
    const now = observation.timestamp || new Date().toISOString();

    // Apply discounting to all arms
    for (const [id, a] of this.arms.entries()) {
      a.discountedPulls *= this.discountFactor;
      a.discountedViolations *= this.discountFactor;
    }

    // Update target arm
    arm.pulls += 1;
    arm.discountedPulls += 1.0;
    if (isViolation) {
      arm.violations += 1;
      arm.discountedViolations += 1.0;
    }
    arm.lastObservedAt = now;
    this.totalSteps += 1;

    const receipt = {
      step: this.totalSteps,
      armId,
      violation: isViolation,
      timestamp: now,
      latencyMs: observation.latencyMs || 0
    };
    this.history.push(receipt);
    return receipt;
  }

  computeArmScore(armId) {
    const arm = this.arms.get(armId);
    if (!arm) return 0;

    if (arm.discountedPulls < 1e-4) {
      // High priority for unvisited arms (optimism in face of uncertainty)
      return 10.0 * arm.multiplier;
    }

    const empiricalFailureRate = arm.discountedViolations / arm.discountedPulls;
    const totalDiscountedSteps = Array.from(this.arms.values())
      .reduce((sum, a) => sum + a.discountedPulls, 0);

    const explorationBonus = Math.sqrt(
      (2 * Math.log(Math.max(1, totalDiscountedSteps))) / arm.discountedPulls
    );

    const rawScore = empiricalFailureRate + (this.explorationWeight * explorationBonus);
    return rawScore * arm.multiplier;
  }

  prioritizeRules(rules = []) {
    const start = performance.now();

    // Map each rule to its corresponding arm (or default to general arm)
    const scoredRules = rules.map((rule) => {
      const armId = rule.armId || this.matchArmForRule(rule);
      const score = this.computeArmScore(armId);
      return {
        ...rule,
        armId,
        curriculumScore: Number(score.toFixed(4))
      };
    });

    // Sort descending by curriculum score (highest risk first)
    scoredRules.sort((a, b) => b.curriculumScore - a.curriculumScore);

    const elapsedMs = performance.now() - start;
    return {
      prioritizedRules: scoredRules,
      evaluationLatencyMs: Number(elapsedMs.toFixed(3)),
      withinBudget: elapsedMs < 1.0
    };
  }

  matchArmForRule(rule = {}) {
    const text = `${rule.id || ''} ${rule.name || ''} ${rule.description || ''}`.toLowerCase();
    if (text.includes('force-push') || text.includes('push')) return 'arm:force-push-main';
    if (text.includes('branch-protection') || text.includes('review') || text.includes('admin')) return 'arm:bypass-branch-protection';
    if (text.includes('token') || text.includes('shunt') || text.includes('dump')) return 'arm:token-shunt-overflow';
    if (text.includes('clean') || text.includes('untracked')) return 'arm:untracked-peer-clean';
    if (text.includes('loop') || text.includes('halo') || text.includes('runaway')) return 'arm:runaway-halo-loop';
    return 'arm:token-shunt-overflow';
  }

  detectDrift(windowSize = 20) {
    if (this.history.length < 5) {
      return { driftDetected: false, reason: 'INSUFFICIENT_OBSERVATIONS', count: this.history.length };
    }

    const recent = this.history.slice(-windowSize);
    const violationsByArm = {};
    for (const item of recent) {
      if (item.violation) {
        violationsByArm[item.armId] = (violationsByArm[item.armId] || 0) + 1;
      }
    }

    const totalViolations = Object.values(violationsByArm).reduce((a, b) => a + b, 0);
    if (totalViolations === 0) {
      return { driftDetected: false, totalViolations: 0, reason: 'CLEAN_EXECUTION' };
    }

    // Check if any single arm accounts for > 60% of recent violations
    for (const [armId, count] of Object.entries(violationsByArm)) {
      const share = count / totalViolations;
      if (share >= 0.6 && count >= 3) {
        return {
          driftDetected: true,
          dominantArmId: armId,
          violationShare: Number(share.toFixed(3)),
          recentViolations: count,
          totalViolations,
          recommendation: `Elevate pre-action interdiction priority for ${armId}`
        };
      }
    }

    return { driftDetected: false, totalViolations, distributions: violationsByArm };
  }

  diagnose() {
    const start = performance.now();
    const armSummaries = [];

    for (const [id, arm] of this.arms.entries()) {
      const score = this.computeArmScore(id);
      armSummaries.push({
        id,
        name: arm.name,
        severity: arm.severity,
        pulls: arm.pulls,
        violations: arm.violations,
        discountedViolations: Number(arm.discountedViolations.toFixed(3)),
        curriculumScore: Number(score.toFixed(4)),
        lastObservedAt: arm.lastObservedAt
      });
    }

    armSummaries.sort((a, b) => b.curriculumScore - a.curriculumScore);
    const drift = this.detectDrift();
    const elapsed = performance.now() - start;

    return {
      status: 'HEALTHY',
      paradigm: 'ActiveSaddler Dynamic Non-Stationary Curriculum',
      totalSteps: this.totalSteps,
      armCount: this.arms.size,
      topPriorityArm: armSummaries[0] ? armSummaries[0].id : null,
      arms: armSummaries,
      driftAnalysis: drift,
      performanceBudgetMs: Number(elapsed.toFixed(3)),
      passedBudget: elapsed < 5.0
    };
  }
}

function runDoctor(options = {}) {
  const curriculum = new ActiveSaddlerCurriculum();

  if (Array.isArray(options.observations) && options.observations.length > 0) {
    for (const obs of options.observations) {
      if (obs && obs.armId) {
        curriculum.recordObservation(obs.armId, obs);
      }
    }
  } else {
    // Feed baseline observations for initial curriculum diagnosis
    curriculum.recordObservation('arm:force-push-main', { violation: false, latencyMs: 0.1 });
    curriculum.recordObservation('arm:bypass-branch-protection', { violation: false, latencyMs: 0.1 });
    curriculum.recordObservation('arm:token-shunt-overflow', { violation: true, latencyMs: 0.2 });
    curriculum.recordObservation('arm:token-shunt-overflow', { violation: true, latencyMs: 0.2 });
    curriculum.recordObservation('arm:runaway-halo-loop', { violation: false, latencyMs: 0.1 });
  }

  const diagnosis = curriculum.diagnose();

  if (options.json) {
    console.log(JSON.stringify(diagnosis, null, 2));
    return diagnosis;
  }

  console.log('=== ActiveSaddler Curriculum Doctor (arXiv:2610.00906) ===');
  console.log(`Status: ${diagnosis.status} | Arms: ${diagnosis.armCount} | Total Steps: ${diagnosis.totalSteps}`);
  console.log(`Top Priority Arm: ${diagnosis.topPriorityArm}`);
  console.log(`Doctor Diagnostic Latency: ${diagnosis.performanceBudgetMs}ms (Budget: <5.0ms)`);
  console.log('\nFailure Pattern Arm Priority Ranking:');
  for (const arm of diagnosis.arms) {
    console.log(`  - [${arm.severity}] ${arm.id} (Score: ${arm.curriculumScore}) - ${arm.violations} violations`);
  }
  if (diagnosis.driftAnalysis.driftDetected) {
    console.log(`\n⚠️  DRIFT DETECTED: Dominant arm ${diagnosis.driftAnalysis.dominantArmId} (${(diagnosis.driftAnalysis.violationShare * 100).toFixed(1)}% of violations)`);
  } else {
    console.log('\n✓ Drift Status: Stable curriculum distribution');
  }

  return diagnosis;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--map-only')) {
    console.log(JSON.stringify(COMPARISON_MAP, null, 2));
    process.exit(0);
  }

  const jsonMode = args.includes('--json');
  runDoctor({ json: jsonMode });
}

module.exports = {
  ActiveSaddlerCurriculum,
  COMPARISON_MAP,
  CANONICAL_FAILURE_ARMS,
  runDoctor
};
