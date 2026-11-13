/**
 * Builder–Reviewer–Verifier Engine & Post-Loop Agent Harness Policy
 *
 * Implements the architecture from "OpenAI and Anthropic Agree on What Comes After Loops":
 * 1. Prompting & Context Management:
 *    - Outcome Goals Not Steps: verifiable metrics/outcomes over micro-step micromanagement.
 *    - Delete Spec/Ticket Decomposition: frontier context support (>=400k tokens compaction threshold),
 *      single builder executes complete spec without artificial 150k ticket splitting.
 * 2. Subagent Routing & Effort Scaling:
 *    - Fan Out Only for Truly Independent Tasks (never fan out interconnected feature tickets).
 *    - Scale Effort Across Model Tiers: escalate complex blockers (race conditions, consensus)
 *      to capable advisors, route routine self-contained tasks to fast/cheap workers.
 * 3. Builder–Reviewer–Verifier Loop:
 *    - 3-Part Pipeline: Builder -> Reviewer (up to 3 rounds) -> Verifier (up to 2 rounds).
 *    - Builder Continuity: Review/verifier findings MUST route back to the original Builder
 *      instance to preserve architectural context and avoid +38% token waste & brittle fixes.
 *    - Verify Only at Capability Edge: skip verifier on routine mastered tasks, enforce on
 *      capability-edge features (offline sync, concurrency, security boundaries).
 *    - Continuous Harness Pruning: prune obsolete scaffolding as base models absorb skills.
 * 4. Orchestration & Swarms:
 *    - Single "Chief of Staff" Manager Thread: 1 local coordinator thread with subagents
 *      treated strictly as tool calls with typed inputs/outputs.
 *    - Avoid Peer-to-Peer Persona Swarms for Feature Building: block non-hierarchical
 *      persona circles that generate bureaucratic stagnation; reserve swarms solely for
 *      parallel bug bashing and fuzzing.
 */

const crypto = require('node:crypto');

const DEFAULT_COMPACTION_THRESHOLD_TOKENS = 400000;
const MAX_REVIEWER_ROUNDS = 3;
const MAX_VERIFIER_ROUNDS = 2;
const TOKEN_WASTE_RESTART_PERCENT = 38;

const INDEPENDENT_TASK_CATEGORIES = new Set([
  'library_research',
  'playwright_flows',
  'bug_hunting',
  'directory_scan',
  'fuzzing',
  'vulnerability_scanning',
  'isolated_benchmarks',
]);

const CAPABILITY_EDGE_CATEGORIES = new Set([
  'offline_sync',
  'distributed_concurrency',
  'race_conditions',
  'consensus_protocol',
  'security_boundary',
  'financial_calculation',
  'crypto_primitives',
  'kernel_drivers',
]);

const ROUTINE_CATEGORIES = new Set([
  'simple_form',
  'docs_update',
  'translation',
  'static_copy',
  'asset_formatting',
  'boilerplate_scaffold',
]);

/**
 * Evaluates full Post-Loop Harness Contract and Builder-Reviewer-Verifier lifecycle.
 */
function evaluatePostLoopHarnessPolicy(contract = {}) {
  const issues = [];
  const blockers = [];
  const recommendations = [];

  // 1. Prompting & Context Management
  const prompting = contract.prompting || {};
  let outcomeValid = true;

  if (prompting.proceduralInstructionsOnly && !prompting.verifiableOutcome && !prompting.acceptanceCriteria) {
    outcomeValid = false;
    blockers.push('outcome_goals_not_steps_violated');
    issues.push('Task specifies step-by-step micro-instructions without verifiable outcome goals or acceptance criteria');
    recommendations.push('Specify verifiable outcome (e.g. P95 latency < 200ms, test suite passing) and let the agent determine implementation');
  }

  const compactionThreshold = Number(prompting.compactionThresholdTokens || DEFAULT_COMPACTION_THRESHOLD_TOKENS);
  let decompositionBlocked = false;
  if (prompting.decomposeForContextLimit && compactionThreshold < 200000) {
    decompositionBlocked = true;
    blockers.push('artificial_spec_decomposition_blocked');
    issues.push(`Spec was artificially split into sprint tickets for a low token threshold (${compactionThreshold} < 200k)`);
    recommendations.push('Raise compaction threshold to >=400k tokens and let a single builder execute the entire spec across 1-2 compactions');
  }

  // 2. Subagent Routing & Fan-out Boundaries
  const routing = contract.routing || {};
  let fanoutValid = true;
  if (routing.parallelSubagents && Array.isArray(routing.tasks) && routing.tasks.length > 1) {
    const hasInterconnected = routing.tasks.some(
      (t) => t.interconnected || (t.dependencies && t.dependencies.length > 0) || t.sharesIntermediateState
    );
    if (hasInterconnected || routing.interconnectedFeatures) {
      fanoutValid = false;
      blockers.push('interconnected_feature_fanout_blocked');
      issues.push('Interconnected feature tickets must never be fanned out in parallel to subagents');
      recommendations.push('Fan out only for truly independent tasks (e.g. library research, parallel playwright tests, bug hunting across directories)');
    } else {
      // Verify tasks belong to allowed independent categories or explicitly isolated
      const unisolated = routing.tasks.filter((t) => !t.independent && !INDEPENDENT_TASK_CATEGORIES.has(t.category));
      if (unisolated.length > 0) {
        fanoutValid = false;
        blockers.push('unisolated_parallel_fanout_blocked');
        issues.push(`Parallel fanout includes tasks that are not verified as independent: ${unisolated.map((t) => t.id || t.name).join(', ')}`);
      }
    }
  }

  // 3. Builder–Reviewer–Verifier Loop
  const pipeline = contract.pipeline || {};
  let builderContinuityValid = true;
  let reviewerRoundsValid = true;
  let verifierRoundsValid = true;
  let capabilityEdgeVerified = true;

  if (pipeline.enabled) {
    const originalBuilderId = pipeline.originalBuilderInstanceId || pipeline.builderInstanceId;
    const currentFixBuilderId = pipeline.fixBuilderInstanceId || pipeline.builderInstanceId;

    if (pipeline.isReviewFix || pipeline.isVerifierFix) {
      if (originalBuilderId && currentFixBuilderId && originalBuilderId !== currentFixBuilderId) {
        builderContinuityValid = false;
        blockers.push('fresh_builder_restart_rejected');
        issues.push(
          `Review/verifier findings routed to a fresh builder instance (${currentFixBuilderId}) instead of original builder (${originalBuilderId}). This incurs ~${TOKEN_WASTE_RESTART_PERCENT}% token waste and creates brittle point fixes.`
        );
        recommendations.push('Always route reviewer and verifier findings back to the original builder instance that retains architectural context');
      }
    }

    if (pipeline.reviewerRounds && pipeline.reviewerRounds > MAX_REVIEWER_ROUNDS) {
      reviewerRoundsValid = false;
      blockers.push('reviewer_rounds_exceeded');
      issues.push(`Reviewer rounds (${pipeline.reviewerRounds}) exceeded maximum allowed (${MAX_REVIEWER_ROUNDS})`);
    }

    if (pipeline.verifierRounds && pipeline.verifierRounds > MAX_VERIFIER_ROUNDS) {
      verifierRoundsValid = false;
      blockers.push('verifier_rounds_exceeded');
      issues.push(`Verifier rounds (${pipeline.verifierRounds}) exceeded maximum allowed (${MAX_VERIFIER_ROUNDS})`);
    }

    const taskCategory = pipeline.taskCategory || contract.taskCategory;
    const isCapabilityEdge = CAPABILITY_EDGE_CATEGORIES.has(taskCategory) || pipeline.isCapabilityEdge;
    const isRoutine = ROUTINE_CATEGORIES.has(taskCategory) || pipeline.isRoutine;

    if (isCapabilityEdge && !pipeline.verifierExecuted && pipeline.claimDone) {
      capabilityEdgeVerified = false;
      blockers.push('capability_edge_verification_required');
      issues.push(`Capability-edge task (${taskCategory}) requires verifier execution before claiming completion`);
    }

    if (isRoutine && pipeline.verifierExecuted) {
      recommendations.push(`Routine task (${taskCategory}) can skip heavy automated verifier loops to optimize latency and token spend`);
    }
  }

  // 4. Orchestration & Swarm Topology
  const orchestration = contract.orchestration || {};
  let swarmTopologyValid = true;

  if (orchestration.topology === 'peer_to_peer_persona_swarm') {
    const purpose = orchestration.purpose || contract.purpose;
    const isBugBashing = purpose === 'bug_hunting' || purpose === 'fuzzing' || purpose === 'vulnerability_scanning';
    if (!isBugBashing) {
      swarmTopologyValid = false;
      blockers.push('peer_persona_swarm_bureaucracy_blocked');
      issues.push('Peer-to-peer persona swarms for feature building stagnate in excessive bureaucracy and halt code output');
      recommendations.push('Use a single Chief-of-Staff manager thread that delegates to subagents strictly as tool calls; reserve swarms for bug bashing/fuzzing');
    }
  }

  // 5. Dynamic Effort Scaling
  const effortScaling = contract.effortScaling || {};
  let effortRouting = 'balanced';
  if (effortScaling.taskComplexity === 'hard_architectural' || effortScaling.hasBlockerRaceCondition) {
    effortRouting = 'escalate_to_capable_advisor';
  } else if (effortScaling.taskComplexity === 'routine_self_contained') {
    effortRouting = 'offload_to_fast_worker';
  }

  const ok = blockers.length === 0;

  return {
    ok,
    blockers,
    issues,
    recommendations,
    diagnostics: {
      outcomeValid,
      decompositionBlocked,
      fanoutValid,
      builderContinuityValid,
      reviewerRoundsValid,
      verifierRoundsValid,
      capabilityEdgeVerified,
      swarmTopologyValid,
      effortRouting,
      tokenWasteAvoidedPercent: builderContinuityValid ? TOKEN_WASTE_RESTART_PERCENT : 0,
      compactionThresholdTokens: compactionThreshold,
    },
    reference: {
      video: 'OpenAI and Anthropic Agree on What Comes After Loops',
      url: 'https://www.youtube.com/watch?v=yrRpnx_iugY',
    },
  };
}

module.exports = {
  DEFAULT_COMPACTION_THRESHOLD_TOKENS,
  MAX_REVIEWER_ROUNDS,
  MAX_VERIFIER_ROUNDS,
  TOKEN_WASTE_RESTART_PERCENT,
  INDEPENDENT_TASK_CATEGORIES,
  CAPABILITY_EDGE_CATEGORIES,
  ROUTINE_CATEGORIES,
  evaluatePostLoopHarnessPolicy,
};
