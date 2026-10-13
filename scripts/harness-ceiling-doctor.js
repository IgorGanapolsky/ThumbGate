#!/usr/bin/env node
'use strict';

/**
 * harness-ceiling-doctor.js — arXiv:2610.11655 Doctor & Inspector
 *
 * Implements the diagnose-then-intervene rail from:
 * "Harness Evolution Hits a Ceiling: When Weight Training Should Begin"
 * (arXiv:2610.11655, Oct 8, 2026: Yuan Tian, Bing Hu, Hao Wang, Binghang Lu, Fang Wu)
 *
 * Core principles:
 *   1. First-Signal-Fires Failure Classification:
 *      Separates process failures (blocked calls, loops, tool syntax, timeouts)
 *      from content failures (mechanically delivered output that is poor/wrong).
 *   2. Harness Evolution Ceiling Detection:
 *      Harness evolution repairs process failures but hits an asymptotic ceiling
 *      when content failures dominate (>= 80% content, <= 20% process).
 *   3. Diagnose-Then-Intervene Dual Protocol:
 *      - If process failures active: recommend harness_evolution (gates, tools, contracts).
 *      - If content ceiling reached: recommend weight_training_or_model_escalation
 *        (LoRA adapter / trajectory distillation or named model tier upgrade).
 *   4. Partitioning Accepted Edits:
 *      Decides which harness edits to train into weights (formatting, response style,
 *      plan structure) vs which to keep in the runtime harness (security gates,
 *      single-writer checkout leases, task-scope boundaries, signature checks).
 *   5. omp.sh Named-Model Escalation over Prompt Bloat:
 *      Prevents expanding prompt rules in AGENTS.md when content failure ceiling is hit.
 */

const fs = require('node:fs');
const path = require('node:path');
const { classifyFailureType, calculateTaskOutcomeMetrics } = require('./task-outcomes');
const { evaluateHarnessCeiling, partitionAcceptedEdits } = require('./rrsi-regularizer');
const { diagnoseFailureIntervention, RAIL_MAP: OMP_RAILS } = require('./omp-coordination-honesty');

const SOURCE_PAPER = 'arXiv:2610.11655 (Tian et al., Oct 2026)';
const SOURCE_TITLE = 'Harness Evolution Hits a Ceiling: When Weight Training Should Begin';

const PILLARS = Object.freeze([
  {
    pillar: 'First-Signal-Fires Failure Classification',
    paperFinding: 'Labelling failed trajectories by the first signal that fires separates process failures from content failures.',
    thumbgateRail: 'scripts/task-outcomes.js (classifyFailureType)',
    status: 'enforced',
  },
  {
    pillar: 'Harness Evolution Ceiling Detection',
    paperFinding: 'Harness evolution repairs process failures but hits an asymptotic ceiling when content failures dominate (>=80%).',
    thumbgateRail: 'scripts/rrsi-regularizer.js (evaluateHarnessCeiling)',
    status: 'enforced',
  },
  {
    pillar: 'Diagnose-Then-Intervene Dual Rule',
    paperFinding: 'Read failure composition to choose between harness evolution and weight training / model escalation.',
    thumbgateRail: 'scripts/task-outcomes.js & scripts/rrsi-regularizer.js',
    status: 'enforced',
  },
  {
    pillar: 'Partitioning Accepted Edits (Train-in vs Keep-in-Runtime)',
    paperFinding: 'Read what accepted edits changed to decide which gains to train into weights vs keep in runtime.',
    thumbgateRail: 'scripts/rrsi-regularizer.js (partitionAcceptedEdits)',
    status: 'enforced',
  },
  {
    pillar: 'omp.sh Named-Model Route Escalation over Prompt Bloat',
    paperFinding: 'When content ceiling is reached, switch model route or train weights instead of bloating harness prompts.',
    thumbgateRail: 'scripts/omp-coordination-honesty.js (diagnoseFailureIntervention)',
    status: 'enforced',
  },
]);

function auditHarnessCeiling() {
  const checks = [];

  // Check 1: First-Signal-Fires classification distinguishes process vs content
  try {
    const processFailure = {
      status: 'failed',
      toolCalls: [{ name: 'bash', contractValid: false, allowed: true, succeeded: false, attempts: 1 }],
      workingReasons: ['tool_contract_invalid', 'status_failed'],
    };
    const contentFailure = {
      status: 'completed',
      toolCalls: [{ name: 'bash', contractValid: true, allowed: true, succeeded: true, attempts: 1 }],
      verification: { performed: true, passed: false, evidence: [] },
      workingReasons: ['verification_failed', 'evidence_missing'],
    };

    const pClass = classifyFailureType(processFailure);
    const cClass = classifyFailureType(contentFailure);

    const ok = pClass.type === 'process' && cClass.type === 'content' &&
      pClass.firstSignal.startsWith('tool_contract_invalid') &&
      cClass.firstSignal === 'verification_failed';

    checks.push({
      id: 'first-signal-failure-classifier',
      pillar: 'First-Signal-Fires Failure Classification',
      ok,
      message: ok
        ? 'First-signal-fires failure classifier correctly distinguishes process vs content failures'
        : `Classifier failed: process=${JSON.stringify(pClass)}, content=${JSON.stringify(cClass)}`,
    });
  } catch (err) {
    checks.push({
      id: 'first-signal-failure-classifier',
      pillar: 'First-Signal-Fires Failure Classification',
      ok: false,
      message: `Classifier threw error: ${err.message}`,
    });
  }

  // Check 2: Harness ceiling evaluator flags weight training when content failures dominate
  try {
    const ceilingEval = evaluateHarnessCeiling({
      failureComposition: {
        totalFailures: 10,
        processFailures: 1,
        contentFailures: 9,
        processFailureRate: 0.1,
        contentFailureRate: 0.9,
      },
    });

    const activeProcessEval = evaluateHarnessCeiling({
      failureComposition: {
        totalFailures: 10,
        processFailures: 6,
        contentFailures: 4,
        processFailureRate: 0.6,
        contentFailureRate: 0.4,
      },
    });

    const ok = ceilingEval.ceilingDetected === true &&
      ceilingEval.recommendation === 'weight_training_or_model_escalation' &&
      activeProcessEval.ceilingDetected === false &&
      activeProcessEval.recommendation === 'harness_evolution';

    checks.push({
      id: 'harness-ceiling-evaluator',
      pillar: 'Harness Evolution Ceiling Detection',
      ok,
      message: ok
        ? 'Ceiling evaluator correctly triggers weight_training_or_model_escalation on content domination'
        : 'Ceiling evaluator misclassified failure distributions',
    });
  } catch (err) {
    checks.push({
      id: 'harness-ceiling-evaluator',
      pillar: 'Harness Evolution Ceiling Detection',
      ok: false,
      message: `Ceiling evaluator threw error: ${err.message}`,
    });
  }

  // Check 3: Partitioning accepted edits into weights vs runtime harness
  try {
    const sampleEdits = [
      { name: 'response-format-template', rule: 'format output as structured json' },
      { name: 'checkout-lease-guard', rule: 'security check single-writer checkout lease before checkout switch' },
      { name: 'cot-planning-style', rule: 'reasoning_step planning convention' },
      { name: 'task-scope-boundary', rule: 'firewall fence tool mutations to task scope' },
    ];

    const { trainableIntoWeights, keepInRuntimeHarness } = partitionAcceptedEdits(sampleEdits);
    const ok = trainableIntoWeights.length === 2 &&
      keepInRuntimeHarness.length === 2 &&
      keepInRuntimeHarness.some((e) => e.name === 'checkout-lease-guard') &&
      trainableIntoWeights.some((e) => e.name === 'response-format-template');

    checks.push({
      id: 'edit-partitioner',
      pillar: 'Partitioning Accepted Edits (Train-in vs Keep-in-Runtime)',
      ok,
      message: ok
        ? 'Accepted edit partitioner preserves security gates in runtime and isolates templates for weights'
        : `Partitioner mismatch: trainable=${trainableIntoWeights.length}, runtime=${keepInRuntimeHarness.length}`,
    });
  } catch (err) {
    checks.push({
      id: 'edit-partitioner',
      pillar: 'Partitioning Accepted Edits (Train-in vs Keep-in-Runtime)',
      ok: false,
      message: `Edit partitioner threw error: ${err.message}`,
    });
  }

  // Check 4: omp.sh coordination integration rejects prompt bloat at ceiling
  try {
    const bloatDiag = diagnoseFailureIntervention({
      totalFailures: 5,
      processFailures: 0,
      contentFailures: 5,
    });
    const processDiag = diagnoseFailureIntervention({
      totalFailures: 5,
      processFailures: 4,
      contentFailures: 1,
    });

    const ok = bloatDiag.ceilingHit === true &&
      bloatDiag.intervention === 'model_tier_escalation_or_weight_training' &&
      processDiag.ceilingHit === false &&
      processDiag.intervention === 'harness_evolution';

    checks.push({
      id: 'omp-coordination-prompt-bloat-guard',
      pillar: 'omp.sh Named-Model Route Escalation over Prompt Bloat',
      ok,
      message: ok
        ? 'omp.sh coordination guard prevents prompt bloat and enforces model tier escalation at ceiling'
        : 'omp.sh failure diagnosis mismatch',
    });
  } catch (err) {
    checks.push({
      id: 'omp-coordination-prompt-bloat-guard',
      pillar: 'omp.sh Named-Model Route Escalation over Prompt Bloat',
      ok: false,
      message: `omp diagnosis threw error: ${err.message}`,
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
    evaluate: false,
    processFailures: 0,
    contentFailures: 0,
  };

  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--map-only') args.mapOnly = true;
    else if (arg === '--evaluate') args.evaluate = true;
    else if (arg.startsWith('--process=')) args.processFailures = Number(arg.slice(10)) || 0;
    else if (arg.startsWith('--content=')) args.contentFailures = Number(arg.slice(10)) || 0;
  }

  return args;
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);

  if (args.mapOnly) {
    const map = {
      name: 'thumbgate-harness-ceiling-doctor',
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
      console.log(`\n=== Harness Evolution Ceiling Rail Map (${SOURCE_PAPER}) ===\n`);
      for (const p of PILLARS) {
        console.log(`Pillar: ${p.pillar}`);
        console.log(`  Paper Finding: ${p.paperFinding}`);
        console.log(`  ThumbGate Rail: ${p.thumbgateRail}`);
        console.log(`  Status: ${p.status}\n`);
      }
    }
    return 0;
  }

  if (args.evaluate) {
    const diag = diagnoseFailureIntervention({
      processFailures: args.processFailures,
      contentFailures: args.contentFailures,
    });
    if (args.json) {
      console.log(JSON.stringify(diag, null, 2));
    } else {
      console.log(`\n=== Failure Composition Evaluation (arXiv:2610.11655) ===`);
      console.log(`Process Failures: ${args.processFailures}`);
      console.log(`Content Failures: ${args.contentFailures}`);
      console.log(`Ceiling Hit: ${diag.ceilingHit}`);
      console.log(`Intervention: ${diag.intervention}`);
      console.log(`Rationale: ${diag.rationale}\n`);
    }
    return 0;
  }

  const report = auditHarnessCeiling();
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n=== Harness Evolution Ceiling Doctor (${report.status}) ===`);
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
  auditHarnessCeiling,
  runCli,
};
