'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AAIF_EIGHT_LAYER_STACK,
  AAIF_ORGANIZATIONAL_SEGMENTS,
  harmonizeAaifAgentGateways,
  executeTransactionalAgentCommerce,
  auditEnterpriseAgentReadiness,
  evaluateAaifMazinGilbertSteal,
  OWASP_LLM_TOP_10_MAPPINGS,
  NIST_AI_RMF_PILLARS,
  recordFalconFlightRecorderTrace,
  runDreadnodeRedTeamSuite,
  triggerExternalRuntimeKillSwitch,
  evaluateCrowdStrikeFalconGuardianSteal,
} = require('../src/cloud-token-firewall');

const {
  generateCrowdStrikeVsThumbgateCisoPitch,
} = require('../scripts/fast-money-engine');

test('AAIF 8-Layer Stack & Readiness: audits enterprise agent maturity and flags unmitigated layers', () => {
  // 1. Panicking organization with no agent strategy
  const panicAudit = auditEnterpriseAgentReadiness({
    framework: null,
    hasPreActionGuardrail: false,
    hasStatelessMcp: false,
    hasFlightRecorder: false,
    hasHarmonizedGateway: false,
    organizationSegment: 'panicking_tier',
  });

  assert.equal(panicAudit.ok, true);
  assert.equal(panicAudit.readinessTier, 'PANIC_CRITICAL');
  assert.ok(panicAudit.earnedScore < 50);
  assert.ok(panicAudit.recommendations.some((r) => r.includes('ThumbGate')));
  assert.equal(panicAudit.certificationEligible, false);

  // 2. Production ready enterprise with ThumbGate guardrails, stateless MCP, and flight recorder
  const prodAudit = auditEnterpriseAgentReadiness({
    framework: 'LangGraph',
    hasPreActionGuardrail: true,
    hasStatelessMcp: true,
    hasFlightRecorder: true,
    hasHarmonizedGateway: true,
    organizationSegment: 'striving_enterprise',
  });

  assert.equal(prodAudit.ok, true);
  assert.equal(prodAudit.readinessTier, 'PRODUCTION_READY');
  assert.equal(prodAudit.earnedScore, 100);
  assert.equal(prodAudit.certificationEligible, true);
  assert.equal(prodAudit.suggestedCertification, 'Model Context Protocol Associate (MCPA)');
});

test('AAIF Gateway Harmonization: unifies Solo.io agentgateway and Envoy Agent Router into zero-debt manifest', () => {
  const soloConfig = {
    routes: [
      { path: '/v1/agent/tools', upstream: 'claude_tools_cluster', tokenLimit: 80000 },
      { path: '/v1/agent/chat', upstream: 'openai_chat_cluster', tokenLimit: 120000 },
    ],
  };

  const envoyConfig = {
    clusters: [
      { name: 'cluster_primary_east', endpoints: ['10.0.1.10:8080'] },
      { name: 'cluster_failover_west', endpoints: ['10.0.2.10:8080'] },
    ],
  };

  const harmonized = harmonizeAaifAgentGateways({
    soloAgentGatewayConfig: soloConfig,
    envoyAgentRouterConfig: envoyConfig,
    enforceStatelessMcp: true,
  });

  assert.equal(harmonized.ok, true);
  assert.equal(harmonized.harmonizationStandard, 'AAIF_GATEWAY_V1');
  assert.equal(harmonized.unifiedSpec.routesCount, 2);
  assert.equal(harmonized.unifiedSpec.statelessMode, true);
  assert.equal(harmonized.unifiedSpec.maintenanceDebtEliminated, true);
  assert.deepEqual(harmonized.unifiedSpec.routes[0].headersToPreserve, [
    'x-mcp-stateless-session-id',
    'x-agent-identity',
    'x-trace-forest-id',
  ]);
});

test('AAIF 5-Stage Agent Commerce Protocol: completes catalog discovery, negotiation, pre-auth payment, settlement, and disputes', () => {
  // Successful transaction within authorized spend cap
  const txSuccess = executeTransactionalAgentCommerce({
    buyerAgentId: 'cfo_agent_09',
    merchantAgentId: 'compute_vendor_bot',
    catalogItemId: 'h100_spot_1hr',
    catalogItemPriceUsd: 2.75,
    authorizedSpendCapUsd: 5.00,
  });

  assert.equal(txSuccess.ok, true);
  assert.equal(txSuccess.transactionStatus, 'COMPLETED_SUCCESSFULLY');
  assert.equal(txSuccess.stages.length, 5);
  assert.equal(txSuccess.stages[0].stage, '1_catalog_discovery');
  assert.equal(txSuccess.stages[1].status, 'agreed');
  assert.equal(txSuccess.stages[2].status, 'authorized');
  assert.equal(txSuccess.stages[3].status, 'settled');
  assert.equal(txSuccess.stages[4].status, 'no_dispute_recorded');

  // Rejected transaction when price exceeds buyer spend cap
  const txBlocked = executeTransactionalAgentCommerce({
    buyerAgentId: 'cfo_agent_09',
    merchantAgentId: 'expensive_vendor_bot',
    catalogItemId: 'enterprise_h100_cluster',
    catalogItemPriceUsd: 120.00,
    authorizedSpendCapUsd: 50.00,
  });

  assert.equal(txBlocked.ok, false);
  assert.equal(txBlocked.transactionStatus, 'FAILED_BUDGET_EXCEEDED');
  assert.ok(txBlocked.error.includes('exceeds buyer authorized spend cap'));
});

test('AAIF Mazin Gilbert Master Evaluator: synthesizes 8 layers, gateways, and commerce with monetization rails', () => {
  const result = evaluateAaifMazinGilbertSteal();

  assert.equal(result.ok, true);
  assert.ok(result.quoteThesis.includes('protocols are the air you breathe'));
  assert.equal(Object.keys(result.eightLayerStack).length, 8);
  assert.ok(result.strategicMonetizationPath.proTier.includes('pro-direct'));
  assert.ok(result.strategicMonetizationPath.rulePack.includes('gumroad.com'));
  assert.ok(result.strategicMonetizationPath.diagnostic.includes('diagnostic'));
});

test('CrowdStrike Fiddler Flight Recorder: records tamper-proof audit trace and flags unverified hallucinations', () => {
  // Verified execution trace
  const verifiedTrace = recordFalconFlightRecorderTrace({
    agentId: 'prod_agent_alpha',
    framework: 'LangGraph',
    actionType: 'tool_invocation',
    toolName: 'git_commit',
    toolInput: { message: 'feat: add security gate' },
    modelReasoningExcerpt: 'Committed changes as verified by tests',
    claimedOutcome: 'Changes committed with hash e8123e42',
    verifiedReceipt: { success: true, exitCode: 0, commitHash: 'e8123e42' },
  });

  assert.equal(verifiedTrace.ok, true);
  assert.equal(verifiedTrace.flightRecord.verifiedByExecutionReceipt, true);
  assert.equal(verifiedTrace.flightRecord.hallucinationWarning, false);
  assert.ok(verifiedTrace.tamperProofCertificate.startsWith('CERT_AUDIT_'));

  // Hallucinated outcome without verified execution receipt ("the model did it" trap)
  const hallucinatedTrace = recordFalconFlightRecorderTrace({
    agentId: 'rogue_agent_beta',
    framework: 'Google ADK',
    actionType: 'tool_invocation',
    toolName: 'deploy_to_production',
    claimedOutcome: 'Successfully deployed service to AWS ECS',
    verifiedReceipt: null,
  });

  assert.equal(hallucinatedTrace.ok, true);
  assert.equal(hallucinatedTrace.flightRecord.verifiedByExecutionReceipt, false);
  assert.equal(hallucinatedTrace.flightRecord.hallucinationWarning, true);
});

test('CrowdStrike Dreadnode Red Teaming: executes 105 automated attacks across OWASP Top 10 for LLMs and NIST AI RMF', () => {
  const redTeam = runDreadnodeRedTeamSuite({
    targetAgentOrModel: 'langgraph_fleet',
    attackVectorsToTest: 105,
  });

  assert.equal(redTeam.ok, true);
  assert.equal(redTeam.totalVectorsTested, 105);
  assert.equal(redTeam.bypassedVectorsCount, 0);
  assert.equal(redTeam.defenseEffectivenessPct, 100);
  assert.equal(redTeam.verdict, 'PASSED_DREADNODE_REDTEAM_GATE');
  assert.equal(redTeam.owaspTop10Coverage.length, 10);
  assert.deepEqual(redTeam.nistAiRmfCoverage, ['GOVERN', 'MAP', 'MEASURE', 'MANAGE']);
});

test('CrowdStrike Falcon Guardian Kill Switch: enforces out-of-model runtime freeze that agents cannot override', () => {
  // Initial state: reset to clear any prior test runs
  triggerExternalRuntimeKillSwitch({ action: 'reset' });

  const status1 = triggerExternalRuntimeKillSwitch({ action: 'status' });
  assert.equal(status1.killSwitchState, 'ARMED_MONITORING');
  assert.equal(status1.details.active, false);

  // Trigger emergency kill switch outside LLM boundary
  const freeze = triggerExternalRuntimeKillSwitch({
    action: 'trigger',
    reason: 'Security team detected unauthorized outbound SSH egress attempt',
    operatorIdentifier: 'ciso_on_call',
    fencingTokenToRevoke: 'fence_token_9831',
  });

  assert.equal(freeze.ok, true);
  assert.equal(freeze.killSwitchState, 'ACTIVATED_FROZEN');
  assert.ok(freeze.quoteKurtz.includes('lives outside the model'));
  assert.equal(freeze.details.revokedTokensCount, 1);

  // Verify status reflects active freeze
  const status2 = triggerExternalRuntimeKillSwitch({ action: 'status' });
  assert.equal(status2.killSwitchState, 'ACTIVATED_FROZEN');
  assert.equal(status2.details.active, true);

  // Reset back to armed monitoring
  const reset = triggerExternalRuntimeKillSwitch({ action: 'reset' });
  assert.equal(reset.killSwitchState, 'DEACTIVATED_ARMED');
  assert.equal(reset.details.active, false);
});

test('CrowdStrike Falcon Guardian Master Evaluator: produces CISO pitch and validates $495M market gap', () => {
  const result = evaluateCrowdStrikeFalconGuardianSteal();

  assert.equal(result.ok, true);
  assert.equal(result.marketThesis.crowdStrikeDealValueUsd, 495000000);
  assert.ok(result.marketThesis.crowdStrikeAvailabilityDate.includes('Q4 FY2027'));
  assert.ok(result.marketThesis.thumbGateAvailabilityDate.includes('Available TODAY'));
  assert.equal(result.cisoExecutivePitch.conversionLinks.pro, 'https://thumbgate.ai/go/pro-direct ($19/mo or $149/yr)');
  assert.equal(result.cisoExecutivePitch.conversionLinks.rulePack, 'https://iganapolsky.gumroad.com/l/vcrho ($49 one-time)');
  assert.equal(result.cisoExecutivePitch.conversionLinks.diagnostic, 'https://thumbgate.ai/diagnostic ($499 enterprise diagnostic)');
});

test('Fast Money Engine CISO Pitch Generator: formats targeted pitch with $0 outbound spend and exact conversion links', () => {
  const pitch = generateCrowdStrikeVsThumbgateCisoPitch({
    cisoName: 'Sarah Jenkins',
    companyName: 'Acme Financial',
    currentFramework: 'LangGraph',
    outboundCashSpendUsd: 0,
  });

  assert.equal(pitch.ok, true);
  assert.ok(pitch.subject.includes('$495M Fal.Con M&A'));
  assert.ok(pitch.body.includes('Sarah Jenkins'));
  assert.ok(pitch.body.includes('Acme Financial'));
  assert.ok(pitch.body.includes('George Kurtz'));
  assert.ok(pitch.body.includes('https://thumbgate.ai/diagnostic'));
  assert.equal(pitch.outboundCashSpendUsd, 0);

  // Enforces zero outbound spend guardrail
  assert.throws(() => {
    generateCrowdStrikeVsThumbgateCisoPitch({ outboundCashSpendUsd: 50 });
  }, /Zero Outbound Spend Mandate violation/);
});
