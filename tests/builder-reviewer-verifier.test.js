'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluatePostLoopHarnessPolicy,
  DEFAULT_COMPACTION_THRESHOLD_TOKENS,
  TOKEN_WASTE_RESTART_PERCENT,
} = require('../src/builder-reviewer-verifier-engine');
const {
  evaluatePostLoopHarnessPolicy: firewallExport,
} = require('../src/cloud-token-firewall');

test('Post-Loop Policy: Exports from cloud-token-firewall cleanly', () => {
  assert.equal(typeof firewallExport, 'function');
  assert.equal(firewallExport, evaluatePostLoopHarnessPolicy);
});

test('Pillar 1: Prompting — Outcome goals over procedural micro-steps', () => {
  // Test 1: Step-by-step only without verifiable outcome is blocked
  const microStepOnly = evaluatePostLoopHarnessPolicy({
    prompting: {
      proceduralInstructionsOnly: true,
      steps: ['Step 1: add cache', 'Step 2: edit line 42'],
    },
  });
  assert.equal(microStepOnly.ok, false);
  assert.ok(microStepOnly.blockers.includes('outcome_goals_not_steps_violated'));
  assert.equal(microStepOnly.diagnostics.outcomeValid, false);

  // Test 2: Verifiable outcome goal and acceptance criteria pass
  const outcomeGoal = evaluatePostLoopHarnessPolicy({
    prompting: {
      verifiableOutcome: 'Reduce P95 latency below 200ms with zero test regressions',
      acceptanceCriteria: ['p95_latency < 200ms', 'exit_code === 0'],
    },
  });
  assert.equal(outcomeGoal.ok, true);
  assert.equal(outcomeGoal.diagnostics.outcomeValid, true);
});

test('Pillar 1: Context Management — Prune artificial spec decomposition & enforce 400k compaction', () => {
  // Test 1: Splitting specs into sprint tickets for artificial 150k limit is blocked
  const artificialSplit = evaluatePostLoopHarnessPolicy({
    prompting: {
      decomposeForContextLimit: true,
      compactionThresholdTokens: 150000,
    },
  });
  assert.equal(artificialSplit.ok, false);
  assert.ok(artificialSplit.blockers.includes('artificial_spec_decomposition_blocked'));
  assert.equal(artificialSplit.diagnostics.decompositionBlocked, true);

  // Test 2: Frontier compaction threshold >=400k tokens without arbitrary ticket splitting passes
  const singleBuilderFullSpec = evaluatePostLoopHarnessPolicy({
    prompting: {
      compactionThresholdTokens: 400000,
      decomposeForContextLimit: false,
      verifiableOutcome: 'Full spec implementation across 1-2 compactions',
    },
  });
  assert.equal(singleBuilderFullSpec.ok, true);
  assert.equal(singleBuilderFullSpec.diagnostics.compactionThresholdTokens, 400000);
});

test('Pillar 2: Subagent Routing — Fan out only for truly independent tasks', () => {
  // Test 1: Interconnected feature tickets fanned out in parallel are blocked
  const interconnectedFanout = evaluatePostLoopHarnessPolicy({
    routing: {
      parallelSubagents: true,
      tasks: [
        { id: 'auth-api', interconnected: true },
        { id: 'auth-ui', dependencies: ['auth-api'] },
      ],
    },
  });
  assert.equal(interconnectedFanout.ok, false);
  assert.ok(interconnectedFanout.blockers.includes('interconnected_feature_fanout_blocked'));
  assert.equal(interconnectedFanout.diagnostics.fanoutValid, false);

  // Test 2: Truly independent workloads (library research, parallel Playwright, bug hunting) pass
  const independentFanout = evaluatePostLoopHarnessPolicy({
    routing: {
      parallelSubagents: true,
      tasks: [
        { id: 'lib-1', category: 'library_research', independent: true },
        { id: 'e2e-checkout', category: 'playwright_flows', independent: true },
        { id: 'bug-auth', category: 'bug_hunting', independent: true },
      ],
    },
  });
  assert.equal(independentFanout.ok, true);
  assert.equal(independentFanout.diagnostics.fanoutValid, true);
});

test('Pillar 2: Dynamic Effort Scaling across model tiers', () => {
  // Complex race condition blocker escalates to capable advisor
  const hardBlocker = evaluatePostLoopHarnessPolicy({
    effortScaling: {
      taskComplexity: 'hard_architectural',
      hasBlockerRaceCondition: true,
    },
  });
  assert.equal(hardBlocker.diagnostics.effortRouting, 'escalate_to_capable_advisor');

  // Routine documentation update offloads to fast/cheap worker
  const routineDocs = evaluatePostLoopHarnessPolicy({
    effortScaling: {
      taskComplexity: 'routine_self_contained',
    },
  });
  assert.equal(routineDocs.diagnostics.effortRouting, 'offload_to_fast_worker');
});

test('Pillar 3: Builder Continuity — Routing fixes to a fresh builder instance is rejected', () => {
  // Spinning up a fresh builder instance creates brittle point fixes and wastes 38% tokens
  const freshBuilderRestart = evaluatePostLoopHarnessPolicy({
    pipeline: {
      enabled: true,
      isReviewFix: true,
      originalBuilderInstanceId: 'builder-claude-agent-101',
      fixBuilderInstanceId: 'builder-fresh-agent-202',
    },
  });
  assert.equal(freshBuilderRestart.ok, false);
  assert.ok(freshBuilderRestart.blockers.includes('fresh_builder_restart_rejected'));
  assert.equal(freshBuilderRestart.diagnostics.builderContinuityValid, false);
  assert.equal(freshBuilderRestart.diagnostics.tokenWasteAvoidedPercent, 0);

  // Routing back to original builder instance retains architectural context and passes
  const builderContinuityPreserved = evaluatePostLoopHarnessPolicy({
    pipeline: {
      enabled: true,
      isReviewFix: true,
      originalBuilderInstanceId: 'builder-claude-agent-101',
      fixBuilderInstanceId: 'builder-claude-agent-101',
    },
  });
  assert.equal(builderContinuityPreserved.ok, true);
  assert.equal(builderContinuityPreserved.diagnostics.builderContinuityValid, true);
  assert.equal(builderContinuityPreserved.diagnostics.tokenWasteAvoidedPercent, TOKEN_WASTE_RESTART_PERCENT);
});

test('Pillar 3: Reviewer and Verifier round limits (max 3 reviewer, max 2 verifier)', () => {
  const excessiveRounds = evaluatePostLoopHarnessPolicy({
    pipeline: {
      enabled: true,
      reviewerRounds: 4,
      verifierRounds: 3,
    },
  });
  assert.equal(excessiveRounds.ok, false);
  assert.ok(excessiveRounds.blockers.includes('reviewer_rounds_exceeded'));
  assert.ok(excessiveRounds.blockers.includes('verifier_rounds_exceeded'));
});

test('Pillar 3: Capability Edge Verification vs Routine Task Skip', () => {
  // Capability-edge task (offline sync merge) requires verifier before claiming done
  const unverifiedEdge = evaluatePostLoopHarnessPolicy({
    pipeline: {
      enabled: true,
      taskCategory: 'offline_sync',
      claimDone: true,
      verifierExecuted: false,
    },
  });
  assert.equal(unverifiedEdge.ok, false);
  assert.ok(unverifiedEdge.blockers.includes('capability_edge_verification_required'));

  // Routine task skips verifier overhead with a recommendation
  const routineTask = evaluatePostLoopHarnessPolicy({
    pipeline: {
      enabled: true,
      taskCategory: 'docs_update',
      verifierExecuted: true,
    },
  });
  assert.equal(routineTask.ok, true);
  assert.ok(routineTask.recommendations.some((r) => r.includes('skip heavy automated verifier loops')));
});

test('Pillar 4: Orchestration — Peer persona swarms blocked for building, allowed for bug bashing', () => {
  // Peer persona swarm for building an app is blocked due to bureaucratic stagnation
  const featureSwarm = evaluatePostLoopHarnessPolicy({
    orchestration: {
      topology: 'peer_to_peer_persona_swarm',
      purpose: 'feature_building',
    },
  });
  assert.equal(featureSwarm.ok, false);
  assert.ok(featureSwarm.blockers.includes('peer_persona_swarm_bureaucracy_blocked'));

  // Large swarm for bug hunting and fuzzing is allowed
  const bugHuntingSwarm = evaluatePostLoopHarnessPolicy({
    orchestration: {
      topology: 'peer_to_peer_persona_swarm',
      purpose: 'bug_hunting',
    },
  });
  assert.equal(bugHuntingSwarm.ok, true);
  assert.equal(bugHuntingSwarm.diagnostics.swarmTopologyValid, true);
});
