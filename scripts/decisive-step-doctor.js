#!/usr/bin/env node
'use strict';

/**
 * decisive-step-doctor.js — NVIDIA arXiv:2610.10478 Doctor & Inspector
 *
 * Implements architectural verification for:
 * "Before They Can Solve: Predicting Post-Training Coding-Agent Performance from Base Models"
 * (arXiv:2610.10478, NVIDIA Research, Oct 2026: Yu, Bukharin, Bhardwaj, et al.)
 *
 * Core pillars:
 *   1. Decisive Step Identification (first edit flipping test suite from fail -> pass)
 *   2. Decisive-Action Screening over All-Step Averaging (rho = 0.964 vs 0.915)
 *   3. Patch MCQ Contrastive Selection (discriminating passing patch from failed alternatives)
 *   4. Prefix-Conditioned Execution (support for functionally correct generations given prefix)
 */

const {
  SOURCE_PAPER,
  SOURCE_TITLE,
  findDecisiveStep,
  evaluatePatchMcq,
  compareStepScoringMethods,
} = require('./decisive-step-evaluator');

const PILLARS = Object.freeze([
  {
    pillar: 'Decisive Step Identification',
    paperFinding: 'Replaying trajectory and rerunning tests after every edit identifies the 1st edit that flips the repo from failing to passing.',
    thumbgateRail: 'scripts/decisive-step-evaluator.js (findDecisiveStep)',
    status: 'enforced',
  },
  {
    pillar: 'Decisive Screening vs All-Step Noise',
    paperFinding: 'Scoring only the decisive step predicts post-trained SWE-bench Verified at rho=0.964; all-step averaging drops to 0.915.',
    thumbgateRail: 'scripts/decisive-step-evaluator.js (compareStepScoringMethods)',
    status: 'enforced',
  },
  {
    pillar: 'Patch MCQ Contrastive Discrimination',
    paperFinding: 'Tests whether the model candidate favors the decisive patch over alternatives rejected by the same verifier.',
    thumbgateRail: 'scripts/decisive-step-evaluator.js (evaluatePatchMcq)',
    status: 'enforced',
  },
  {
    pillar: 'Prefix-Conditioned Execution Isolation',
    paperFinding: 'Evaluates generation conditioned on the prior trajectory prefix without requiring cold-start end-to-end multi-step tool calls.',
    thumbgateRail: 'scripts/decisive-step-evaluator.js (findDecisiveStep prefixSteps)',
    status: 'enforced',
  },
]);

function auditDecisiveStep() {
  const checks = [];

  // Check 1: Decisive step flip detection
  try {
    const trajectory = [
      { stepNumber: 1, tool: 'bash', action: 'explore directory', patch: null, testsPassed: false },
      { stepNumber: 2, tool: 'edit', action: 'attempt fix A', patch: 'function foo() { return null; }', testsPassed: false },
      { stepNumber: 3, tool: 'edit', action: 'attempt fix B', patch: 'function foo() { return true; }', testsPassed: true },
      { stepNumber: 4, tool: 'edit', action: 'add comment', patch: '// done', testsPassed: true },
    ];

    const result = findDecisiveStep(trajectory);
    const ok = result.hasDecisiveStep === true &&
      result.decisiveStepIndex === 2 &&
      result.prefixSteps.length === 2 &&
      result.rejectedSteps.length === 1 &&
      result.rejectedSteps[0].index === 1;

    checks.push({
      id: 'decisive-step-flip-detection',
      pillar: 'Decisive Step Identification',
      ok,
      message: ok
        ? 'Successfully isolated decisive step at index 2 (first edit that flipped tests from fail to pass)'
        : `Decisive flip detection failed: index=${result.decisiveStepIndex}`,
    });
  } catch (err) {
    checks.push({
      id: 'decisive-step-flip-detection',
      pillar: 'Decisive Step Identification',
      ok: false,
      message: `Decisive step flip threw error: ${err.message}`,
    });
  }

  // Check 2: Patch MCQ Contrastive Selection
  try {
    const decisiveStep = {
      patch: 'export function calculateNet() { return Math.max(0, gross - tax); }',
    };
    const rejectedSteps = [
      { index: 1, patch: 'export function calculateNet() { return null; }' },
      { index: 2, patch: 'export function calculateNet() { return gross; }' },
    ];
    const candidate = { name: 'frontier-candidate', codingTierScore: 1.2 };

    const mcq = evaluatePatchMcq({ candidate, decisiveStep, rejectedSteps });
    const ok = mcq.valid === true && mcq.discriminationRate >= 0.5 && mcq.preferredDecisiveCount > 0;

    checks.push({
      id: 'patch-mcq-contrastive-selection',
      pillar: 'Patch MCQ Contrastive Discrimination',
      ok,
      message: ok
        ? `Patch MCQ correctly preferred decisive patch over failing alternatives (${(mcq.discriminationRate * 100).toFixed(1)}%)`
        : 'Patch MCQ failed contrastive discrimination',
    });
  } catch (err) {
    checks.push({
      id: 'patch-mcq-contrastive-selection',
      pillar: 'Patch MCQ Contrastive Discrimination',
      ok: false,
      message: `Patch MCQ threw error: ${err.message}`,
    });
  }

  // Check 3: All-step average vs decisive step contrast
  try {
    const trajectory = [
      { stepNumber: 1, tool: 'bash', action: 'ls', testsPassed: false },
      { stepNumber: 2, tool: 'edit', action: 'bad edit', patch: 'syntax error {', testsPassed: false },
      { stepNumber: 3, tool: 'edit', action: 'good edit', patch: 'export function clean() { return 1; }', testsPassed: true },
    ];
    const candidate = { name: 'qwen-coder', codingTierScore: 1.0 };
    const comparison = compareStepScoringMethods(trajectory, candidate);

    const ok = comparison.valid === true &&
      Number.isFinite(comparison.allStepAverage) &&
      Number.isFinite(comparison.decisiveScore) &&
      comparison.decisiveScore > 0;

    checks.push({
      id: 'decisive-vs-all-step-contrast',
      pillar: 'Decisive Screening vs All-Step Noise',
      ok,
      message: ok
        ? `Isolated decisive score (${comparison.decisiveScore}) from diluted all-step average (${comparison.allStepAverage})`
        : 'Comparison between scoring methods failed',
    });
  } catch (err) {
    checks.push({
      id: 'decisive-vs-all-step-contrast',
      pillar: 'Decisive Screening vs All-Step Noise',
      ok: false,
      message: `Scoring comparison threw error: ${err.message}`,
    });
  }

  // Check 4: Rejection of trajectories without a decisive test flip
  try {
    const allFailingTrajectory = [
      { stepNumber: 1, tool: 'edit', patch: 'a = 1', testsPassed: false },
      { stepNumber: 2, tool: 'edit', patch: 'a = 2', testsPassed: false },
    ];
    const noFlip = findDecisiveStep(allFailingTrajectory);
    const ok = noFlip.hasDecisiveStep === false && noFlip.decisiveStepIndex === -1;

    checks.push({
      id: 'no-flip-rejection',
      pillar: 'Prefix-Conditioned Execution Isolation',
      ok,
      message: ok
        ? 'Fail-closed: correctly rejected trajectory with no successful test flip'
        : 'Failed to reject all-failing trajectory',
    });
  } catch (err) {
    checks.push({
      id: 'no-flip-rejection',
      pillar: 'Prefix-Conditioned Execution Isolation',
      ok: false,
      message: `No-flip rejection threw error: ${err.message}`,
    });
  }

  const allPassed = checks.every((c) => c.ok);
  return {
    status: allPassed ? 'PASS' : 'FAIL',
    paper: SOURCE_PAPER,
    title: SOURCE_TITLE,
    checkedAt: new Date().toISOString(),
    checks,
    pillars: PILLARS,
  };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const args = {
    json: false,
    mapOnly: false,
  };

  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--map-only') args.mapOnly = true;
  }

  return args;
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);

  if (args.mapOnly) {
    const map = {
      name: 'thumbgate-decisive-step-doctor',
      paper: SOURCE_PAPER,
      title: SOURCE_TITLE,
      status: 'ready',
      ok: true,
      mapOnly: true,
      pillars: PILLARS,
    };
    if (args.json) {
      console.log(JSON.stringify(map, null, 2));
    } else {
      console.log(`\n=== Decisive-Step Evaluation Rail Map (${SOURCE_PAPER}) ===\n`);
      for (const p of PILLARS) {
        console.log(`Pillar: ${p.pillar}`);
        console.log(`  Paper Finding: ${p.paperFinding}`);
        console.log(`  ThumbGate Rail: ${p.thumbgateRail}`);
        console.log(`  Status: ${p.status}\n`);
      }
    }
    return 0;
  }

  const report = auditDecisiveStep();
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n=== Decisive Step Doctor (${report.status}) ===`);
    console.log(`Paper: ${report.paper} - ${report.title}\n`);
    for (const check of report.checks) {
      const sym = check.ok ? '✓' : '✗';
      console.log(`${sym} [${check.pillar}] ${check.message}`);
    }
    console.log(`\nOverall Status: ${report.status}\n`);
  }

  return report.status === 'PASS' ? 0 : 1;
}

if (require.main === module) {
  process.exit(runCli());
}

module.exports = {
  SOURCE_PAPER,
  SOURCE_TITLE,
  PILLARS,
  auditDecisiveStep,
  runCli,
};
