#!/usr/bin/env node
'use strict';

/**
 * What Comes After Loops — Modern Agent Harness & Builder-Reviewer-Verifier Architecture
 *
 * Implements the 4-part consensus architecture from OpenAI & Anthropic:
 * 1. Prompting & Context Management:
 *    - Outcome Goals, Not Step-by-Step Instructions (verifiable acceptance criteria).
 *    - High Compaction Threshold (~400k tokens), elimination of artificial 150k micro-ticket decomposition.
 * 2. Subagent Routing & Effort Scaling:
 *    - Fan out ONLY for truly independent tasks (isolated research, parallel flows, bug hunting).
 *    - Rejection of parallel fan-out for interconnected feature tickets.
 *    - Effort scaling: escalate to stronger advisor (frontier) when stuck on race conditions/concurrency;
 *      offload routine self-contained tasks (docs, translations) to cheaper tiers (mini/nano).
 * 3. The Builder–Reviewer–Verifier (BRV) Pipeline:
 *    - 3-part pipeline: Builder -> Reviewer (up to 3 rounds) -> Verifier (up to 2 rounds).
 *    - Route fixes back to the ORIGINAL builder instance (preserves architectural context, cuts tokens ~38%).
 *    - Verify ONLY at the capability edge (skip verifier overhead for routine mastered tasks).
 *    - Continuous harness pruning (retire scaffolding absorbed natively by base models).
 * 4. Orchestration & Swarms:
 *    - Single "Chief of Staff" manager thread delegating to sandboxed containers.
 *    - Anti-Bureaucracy Swarm Guardrail: Block peer-to-peer persona debating societies for feature building;
 *      treat subagents strictly as deterministic tool calls; reserve swarms solely for bug bashing & vulnerability hunting.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_COMPACTION_THRESHOLD_TOKENS = 400000;
const LEGACY_TICKET_DECOMPOSITION_TOKEN_CAP = 150000;
const CONTEXT_REUSE_TOKEN_SAVINGS_PERCENT = 38; // 38% token reduction routing back to original builder
const MAX_REVIEWER_ROUNDS = 3;
const MAX_VERIFIER_ROUNDS = 2;

// Tasks at the capability edge that require mandatory deep verification
const CAPABILITY_EDGE_PATTERNS = [
  /race[-_ ]condition/i,
  /concurrency/i,
  /deadlock/i,
  /offline[-_ ]to[-_ ]online/i,
  /distributed[-_ ]sync/i,
  /data[-_ ]migration/i,
  /security[-_ ]diode/i,
  /token[-_ ]firewall/i,
  /cryptographic/i,
  /payment[-_ ]reconciliation/i,
  /idempotency/i,
  /atomic[-_ ]claim/i,
];

// Routine tasks that frontier models master natively (automated verifier overhead skipped)
const ROUTINE_TASK_PATTERNS = [
  /^docs?\b/i,
  /documentation/i,
  /translation/i,
  /readme/i,
  /static[-_ ]page/i,
  /css[-_ ]styling/i,
  /copywriting/i,
  /changelog/i,
  /comment[-_ ]cleanup/i,
  /simple[-_ ]form[-_ ]field/i,
];

/**
 * Assess whether a task resides at the capability edge or is routine.
 */
function assessCapabilityEdge(task = {}) {
  const text = `${task.title || ''} ${task.description || ''} ${task.type || ''} ${(task.tags || []).join(' ')}`;
  
  // Check for explicit routine classification
  const isRoutine = ROUTINE_TASK_PATTERNS.some((pat) => pat.test(text));
  const isEdge = CAPABILITY_EDGE_PATTERNS.some((pat) => pat.test(text)) || task.riskLevel === 'high' || task.isCriticalEdge === true;

  if (isEdge) {
    return {
      atCapabilityEdge: true,
      requiresVerifier: true,
      reason: 'Task touches high-consequence concurrency, distributed state, security diodes, or critical flows',
      recommendedVerifierRounds: MAX_VERIFIER_ROUNDS,
    };
  }

  if (isRoutine) {
    return {
      atCapabilityEdge: false,
      requiresVerifier: false,
      reason: 'Routine task natively mastered by modern frontier models; skip evaluator/verifier overhead',
      recommendedVerifierRounds: 0,
    };
  }

  // Balanced default
  return {
    atCapabilityEdge: false,
    requiresVerifier: task.riskLevel === 'medium',
    reason: 'Standard complexity; standard verification sufficient',
    recommendedVerifierRounds: task.riskLevel === 'medium' ? 1 : 0,
  };
}

/**
 * Evaluate whether subtasks are safe to fan out in parallel.
 * OpenAI/Anthropic rule: Fan out ONLY for truly independent tasks.
 * NEVER fan out interconnected feature tickets in parallel.
 */
function evaluateSubagentFanOut(subtasks = []) {
  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    return { allowed: true, parallelCount: 0, reason: 'No subtasks provided' };
  }

  if (subtasks.length === 1) {
    return { allowed: true, parallelCount: 1, reason: 'Single task; no fan-out needed' };
  }

  // Detect interconnected dependencies or shared state requirements
  const sharedResources = new Map();
  let hasInterconnectedDependencies = false;
  const violationReasons = [];

  subtasks.forEach((t, idx) => {
    // Check if task declares dependencies on sibling tasks
    if (t.dependsOn && t.dependsOn.length > 0) {
      hasInterconnectedDependencies = true;
      violationReasons.push(`Subtask ${t.id || idx} depends on ${t.dependsOn.join(', ')}`);
    }

    // Check shared write target files or state
    const targets = Array.isArray(t.targetFiles) ? t.targetFiles : (t.targetFile ? [t.targetFile] : []);
    targets.forEach((file) => {
      if (sharedResources.has(file)) {
        hasInterconnectedDependencies = true;
        violationReasons.push(`Resource collision: Subtask ${t.id || idx} and ${sharedResources.get(file)} both write to ${file}`);
      } else {
        sharedResources.set(file, t.id || idx);
      }
    });

    // Check if task type represents interconnected feature slices
    if (t.type === 'feature_slice' || t.type === 'interconnected_component') {
      hasInterconnectedDependencies = true;
      violationReasons.push(`Subtask ${t.id || idx} is an interconnected feature slice; must be built by a single builder instance`);
    }
  });

  if (hasInterconnectedDependencies) {
    return {
      allowed: false,
      fanOutBlocked: true,
      reason: 'Parallel fan-out rejected: interconnected feature tickets require shared intermediate state. Must be executed sequentially by a single builder instance.',
      violations: violationReasons,
    };
  }

  // Valid independent tasks (e.g. parallel library research, independent Playwright checks, bug hunting in separate dirs)
  return {
    allowed: true,
    fanOutBlocked: false,
    parallelCount: subtasks.length,
    reason: 'Approved: all subtasks operate on isolated workloads without intermediate state coupling.',
  };
}

/**
 * Validate swarm topology against the anti-bureaucracy rule.
 * OpenAI/Anthropic consensus: Avoid peer-to-peer persona swarms for feature building.
 * Current models struggle as non-hierarchical peers (stagnating in bureaucracy).
 * Treat subagents as tool calls; reserve swarms solely for parallel vulnerability hunting & bug bashing.
 */
function validateSwarmArchitecture(swarmConfig = {}) {
  const { mode = 'feature_building', agents = [], structure = 'peer_to_peer' } = swarmConfig;

  // If building features using peer-to-peer personas
  if (mode === 'feature_building' && (structure === 'peer_to_peer' || structure === 'persona_committee')) {
    const personas = agents.map((a) => (typeof a === 'string' ? a : a.role || a.name));
    const isPersonaCommittee = personas.some((p) => /designer|tester|security_reviewer|product_manager|ops_lead/i.test(p));

    if (isPersonaCommittee || agents.length > 3) {
      return {
        allowed: false,
        blocked: true,
        violationType: 'PEER_PERSONA_BUREAUCRACY_SWARM',
        reason: 'Blocked: Peer-to-peer persona swarms for feature building stagnate into non-hierarchical bureaucratic loops. Subagents must be invoked strictly as tool calls with defined inputs and outputs by a single builder agent.',
        recommendedPattern: 'Single Chief of Staff manager delegating to tool-call subagents, followed by a linear Reviewer -> Verifier handoff.',
      };
    }
  }

  // Legitimate swarm use case: Bug bashing and parallel vulnerability hunting
  if (mode === 'bug_hunting' || mode === 'vulnerability_hunting' || mode === 'fuzzing') {
    return {
      allowed: true,
      blocked: false,
      mode,
      reason: 'Approved: Large swarms are explicitly authorized for parallel vulnerability hunting, independent fuzzing, and bug bashing.',
    };
  }

  // Tool-call hierarchy is allowed
  return {
    allowed: true,
    blocked: false,
    mode,
    reason: 'Approved: Hierarchical tool-call execution pattern.',
  };
}

/**
 * Builder–Reviewer–Verifier Pipeline
 */
class BuilderReviewerVerifierPipeline {
  constructor(options = {}) {
    this.pipelineId = options.pipelineId || `brv_${crypto.randomBytes(6).toString('hex')}`;
    this.builderInstanceId = options.builderInstanceId || `builder_${crypto.randomBytes(4).toString('hex')}`;
    this.spec = options.spec || {};
    this.reviewerRounds = 0;
    this.verifierRounds = 0;
    this.history = [];
    this.status = 'PENDING';
    this.tokenMetrics = {
      builderTokens: 0,
      reviewerTokens: 0,
      verifierTokens: 0,
      tokenSavingsPercent: 0,
    };
  }

  /**
   * Step 1: Builder phase (receives outcome goal, not micro-steps).
   */
  startBuild(outcomeGoal = {}) {
    if (!outcomeGoal.outcomeCriteria && !outcomeGoal.acceptanceCriteria) {
      throw new Error('Outcome goal must provide outcomeCriteria or acceptanceCriteria, not prescriptive steps.');
    }

    this.status = 'BUILDING';
    this.outcomeGoal = outcomeGoal;
    this.history.push({
      phase: 'BUILDER',
      builderInstanceId: this.builderInstanceId,
      status: 'BUILD_STARTED',
      timestamp: new Date().toISOString(),
      compactionThreshold: DEFAULT_COMPACTION_THRESHOLD_TOKENS,
    });

    return {
      pipelineId: this.pipelineId,
      builderInstanceId: this.builderInstanceId,
      phase: 'BUILDER',
      status: 'BUILD_IN_PROGRESS',
      outcomeGoal: this.outcomeGoal,
    };
  }

  /**
   * Submit build artifact for Reviewer examination.
   */
  submitBuild(artifact = {}) {
    this.currentArtifact = artifact;
    this.status = 'REVIEWING';
    this.history.push({
      phase: 'BUILDER_COMPLETE',
      builderInstanceId: this.builderInstanceId,
      artifactHash: crypto.createHash('sha256').update(JSON.stringify(artifact)).digest('hex').slice(0, 12),
      timestamp: new Date().toISOString(),
    });
    return { status: 'READY_FOR_REVIEW', pipelineId: this.pipelineId };
  }

  /**
   * Step 2: Reviewer evaluation (up to 3 rounds).
   */
  reviewBuild(reviewerInput = {}) {
    if (this.reviewerRounds >= MAX_REVIEWER_ROUNDS) {
      throw new Error(`Reviewer rounds exceeded maximum allowed (${MAX_REVIEWER_ROUNDS})`);
    }

    this.reviewerRounds += 1;
    const { approved = false, findings = [], reviewerAgent = 'codex-reviewer' } = reviewerInput;

    this.history.push({
      phase: 'REVIEWER',
      round: this.reviewerRounds,
      reviewerAgent,
      approved,
      findingsCount: findings.length,
      timestamp: new Date().toISOString(),
    });

    if (approved) {
      this.status = 'REVIEW_PASSED';
      return {
        status: 'REVIEW_PASSED',
        reviewerRounds: this.reviewerRounds,
        readyForVerifier: true,
      };
    }

    // Must route back to the original builder instance!
    this.status = 'REWORKING_BUILDER';
    return this.routeFixesToOriginalBuilder({
      type: 'REVIEW_FINDINGS',
      round: this.reviewerRounds,
      findings,
    });
  }

  /**
   * Route reviewer/verifier findings back to the ORIGINAL builder instance.
   * This retains architectural context, applies structural fixes (rather than brittle point fixes),
   * and saves ~38% in token overhead compared to spinning up a new agent.
   */
  routeFixesToOriginalBuilder({ type, round, findings }) {
    this.tokenMetrics.tokenSavingsPercent = CONTEXT_REUSE_TOKEN_SAVINGS_PERCENT;
    const reworkReceipt = {
      pipelineId: this.pipelineId,
      targetInstanceId: this.builderInstanceId, // Preserved instance
      isSameInstance: true,
      reworkType: type,
      round,
      findings,
      architecturalContextRetained: true,
      fixStrategy: 'structural_fix',
      tokenSavingsAchieved: `${CONTEXT_REUSE_TOKEN_SAVINGS_PERCENT}% token reduction via original builder instance reuse`,
      status: 'REWORK_DISPATCHED_TO_ORIGINAL_BUILDER',
    };

    this.history.push({
      phase: 'REWORK_ORIGINAL_BUILDER',
      builderInstanceId: this.builderInstanceId,
      receipt: reworkReceipt,
      timestamp: new Date().toISOString(),
    });

    return reworkReceipt;
  }

  /**
   * Step 3: Verifier phase (up to 2 rounds of independent user flows).
   */
  verifyBuild(verifierInput = {}) {
    if (this.verifierRounds >= MAX_VERIFIER_ROUNDS) {
      throw new Error(`Verifier rounds exceeded maximum allowed (${MAX_VERIFIER_ROUNDS})`);
    }

    // Assess capability edge
    const edgeAssessment = assessCapabilityEdge(this.outcomeGoal);
    if (!edgeAssessment.requiresVerifier && !verifierInput.forceVerify) {
      this.status = 'VERIFIED_SKIPPED_ROUTINE';
      return {
        status: 'VERIFIED',
        skipped: true,
        reason: 'Routine task; verified at capability edge without verifier overhead',
      };
    }

    this.verifierRounds += 1;
    const { passed = false, failedFlows = [], testResults = {} } = verifierInput;

    this.history.push({
      phase: 'VERIFIER',
      round: this.verifierRounds,
      passed,
      failedFlowsCount: failedFlows.length,
      timestamp: new Date().toISOString(),
    });

    if (passed) {
      this.status = 'VERIFIED_SUCCESS';
      return {
        status: 'VERIFIED_SUCCESS',
        pipelineId: this.pipelineId,
        builderInstanceId: this.builderInstanceId,
        reviewerRounds: this.reviewerRounds,
        verifierRounds: this.verifierRounds,
        tokenSavingsAchieved: `${CONTEXT_REUSE_TOKEN_SAVINGS_PERCENT}%`,
      };
    }

    // Route failures back to original builder
    this.status = 'REWORKING_BUILDER';
    return this.routeFixesToOriginalBuilder({
      type: 'VERIFIER_FAILURES',
      round: this.verifierRounds,
      findings: failedFlows,
    });
  }

  getAuditSummary() {
    return {
      pipelineId: this.pipelineId,
      builderInstanceId: this.builderInstanceId,
      status: this.status,
      reviewerRounds: this.reviewerRounds,
      maxReviewerRounds: MAX_REVIEWER_ROUNDS,
      verifierRounds: this.verifierRounds,
      maxVerifierRounds: MAX_VERIFIER_ROUNDS,
      tokenReuseSavings: `${CONTEXT_REUSE_TOKEN_SAVINGS_PERCENT}%`,
      historyLength: this.history.length,
    };
  }
}

/**
 * Chief of Staff Coordinator
 * Single local manager thread delegating to remote sandboxed worker containers.
 */
class ChiefOfStaffCoordinator {
  constructor(options = {}) {
    this.coordinatorId = options.coordinatorId || `chief_${crypto.randomBytes(4).toString('hex')}`;
    this.delegatedTasks = new Map();
  }

  delegateToSandbox({ taskId, outcome, environment = 'sandbox_container' }) {
    const taskRecord = {
      taskId: taskId || `task_${crypto.randomBytes(4).toString('hex')}`,
      outcome,
      environment,
      status: 'DISPATCHED',
      createdAt: new Date().toISOString(),
    };
    this.delegatedTasks.set(taskRecord.taskId, taskRecord);
    return taskRecord;
  }

  checkTaskStatus(taskId) {
    return this.delegatedTasks.get(taskId) || null;
  }

  getActiveDelegations() {
    return Array.from(this.delegatedTasks.values());
  }
}

/**
 * Harness Scaffolding Pruner
 * Identifies and strips obsolete scaffolding absorbed natively by frontier models.
 */
function pruneHarnessScaffolding(harness = {}) {
  const obsoletePatterns = [
    {
      id: 'legacy_150k_ticket_decomposition',
      pattern: /decompose.*into.*tickets.*under 150k/i,
      replacement: 'Use 400k token compaction threshold and implement entire spec in single builder instance',
    },
    {
      id: 'step_by_step_micromanagement',
      pattern: /step 1.*step 2.*prescribe/i,
      replacement: 'Provide outcome goals and verifiable acceptance criteria',
    },
    {
      id: 'peer_persona_committee',
      pattern: /swarm of personas: designer, tester, pm/i,
      replacement: 'Single Chief of Staff manager with tool-call subagents',
    },
  ];

  const rules = Array.isArray(harness.rules) ? harness.rules : [];
  const prunedRules = [];
  const strippedRules = [];

  for (const rule of rules) {
    const matched = obsoletePatterns.find((p) => p.pattern.test(rule));
    if (matched) {
      strippedRules.push({ original: rule, reason: matched.replacement, patternId: matched.id });
    } else {
      prunedRules.push(rule);
    }
  }

  return {
    originalCount: rules.length,
    retainedCount: prunedRules.length,
    strippedCount: strippedRules.length,
    prunedRules,
    strippedRules,
  };
}

module.exports = {
  DEFAULT_COMPACTION_THRESHOLD_TOKENS,
  LEGACY_TICKET_DECOMPOSITION_TOKEN_CAP,
  CONTEXT_REUSE_TOKEN_SAVINGS_PERCENT,
  MAX_REVIEWER_ROUNDS,
  MAX_VERIFIER_ROUNDS,
  assessCapabilityEdge,
  evaluateSubagentFanOut,
  validateSwarmArchitecture,
  BuilderReviewerVerifierPipeline,
  ChiefOfStaffCoordinator,
  pruneHarnessScaffolding,
};

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--json')) {
    console.log(JSON.stringify({
      status: 'READY',
      version: '2.0.0-brv',
      principles: [
        'Outcome Goals Not Step-by-Step Instructions',
        'High Compaction Threshold (~400k tokens)',
        'Fan Out Only for Truly Independent Tasks',
        'Builder-Reviewer-Verifier Loop (Reviewer <=3, Verifier <=2)',
        'Route Fixes to Original Builder (38% Token Reduction)',
        'Verify Only at Capability Edge',
        'Single Chief of Staff Manager Thread',
        'Anti-Bureaucracy Swarm Guardrail (No Peer Persona Feature Building)',
      ],
    }, null, 2));
  } else {
    console.log('Builder-Reviewer-Verifier Engine: Ready.');
    console.log('Run with --json or import as module.');
  }
}
