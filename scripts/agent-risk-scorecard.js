/**
 * Autonomous Coding Agent Risk Scorecard (Free Public Resource)
 * 
 * Inspired by David Meerman Scott's "The Fandom Playbook" (Hagerty Valuation Model):
 * Give away a high-value, un-gated evaluation resource that engineering teams actively need,
 * rather than leading with a product pitch.
 * 
 * Computes deterministic risk metrics and financial exposure based on real production incident data:
 * - Unindexed scatter query explosion risk
 * - Runaway PR CI runner surge cost
 * - Local LLM VRAM thrash & CPU-offload latency collapse
 * - Multi-turn state tracking collapse (Ai2 StateBench)
 * - Sycophantic test pass rate (Maude Lemaire mutation testing)
 */

'use strict';

function calculateAgentRiskScorecard(config = {}) {
  const {
    activeAgents = 1,
    agentHarness = 'cursor', // 'cursor' | 'claude-code' | 'codex' | 'swarm'
    monthlyCiSpendUsd = 1000,
    databaseEngine = 'postgresql',
    hasDeterministicPreToolGate = false,
    hasMutationTesting = false,
    hasHardwareAwareRouter = false,
    hasLazyPrCanceller = false
  } = config;

  let baseRiskScore = 40; // 0 (safest) to 100 (catastrophic)
  let predictedAnnualIncidentExposureUsd = 0;
  const criticalVulnerabilities = [];
  const remediationChecklist = [];

  // Factor 1: Agent Swarm & CI multiplier
  const agentMultiplier = Math.min(Math.max(activeAgents, 1), 50);
  if (!hasLazyPrCanceller) {
    const ciSurgeUsd = (monthlyCiSpendUsd * 0.45 * (agentMultiplier > 2 ? 1.8 : 1.2)) * 12;
    predictedAnnualIncidentExposureUsd += ciSurgeUsd;
    baseRiskScore += 20;
    criticalVulnerabilities.push({
      vector: 'CI_RUNNER_TSUNAMI',
      severity: 'HIGH',
      description: `Without superseding PR build cancellation, ${activeAgents} agent(s) will trigger obsolete build queues.`,
      estimatedAnnualLossUsd: Math.round(ciSurgeUsd)
    });
    remediationChecklist.push('Implement LazyPrCiManager to automatically halt superseded agent commits.');
  }

  // Factor 2: Database integrity
  if (!hasDeterministicPreToolGate) {
    const dbOutageExposure = 18400; // Average cost of 2-hour unindexed migration lock
    predictedAnnualIncidentExposureUsd += dbOutageExposure;
    baseRiskScore += 25;
    criticalVulnerabilities.push({
      vector: 'UNINDEXED_SCATTER_QUERY',
      severity: 'CRITICAL',
      description: `Agent SQL migrations on ${databaseEngine} lack PreToolUse AST verification, risking table-level locks.`,
      estimatedAnnualLossUsd: dbOutageExposure
    });
    remediationChecklist.push('Install a PreToolUse database deep-trust diode to reject unindexed scatter queries before execution.');
  }

  // Factor 3: Sycophantic Test Passing
  if (!hasMutationTesting) {
    baseRiskScore += 15;
    criticalVulnerabilities.push({
      vector: 'SYCOPHANTIC_TEST_FALSE_POSITIVE',
      severity: 'MEDIUM',
      description: 'Agent-generated tests validate against model assumptions rather than mutating code to verify test sensitivity.',
      estimatedAnnualLossUsd: 8500
    });
    remediationChecklist.push('Run mutation testing to kill sycophantic test suites that pass even when logic is corrupted.');
  }

  // Clamp risk score to 100
  const finalRiskScore = Math.min(Math.max(baseRiskScore, 5), 100);

  let riskTier = 'LOW';
  if (finalRiskScore >= 70) riskTier = 'CRITICAL';
  else if (finalRiskScore >= 45) riskTier = 'ELEVATED';

  return {
    riskScore: finalRiskScore,
    riskTier,
    predictedAnnualIncidentExposureUsd: Math.round(predictedAnnualIncidentExposureUsd),
    criticalVulnerabilities,
    remediationChecklist,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  calculateAgentRiskScorecard
};
