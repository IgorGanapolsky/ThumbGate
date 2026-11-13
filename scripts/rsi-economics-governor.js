#!/usr/bin/env node
'use strict';

/**
 * RSI Unit Economics, SemiAnalysis GDPX Router, MIT 0.016% Sparse Weight Surgery
 * & Anthropic S-1 / GEO Governance Engine
 * (Stolen from NLW: "AI Lurches Towards RSI", https://music.youtube.com/watch?v=Es59icF3nZg)
 *
 * Implements the 3 operational pillars:
 *
 * 1. Model & Agent Economics (Preparing for the End of the Subsidy Era):
 *    - True API Unit Economics Auditor: Detects flat-rate consumer subsidy overhang
 *      (e.g., $14,000 API compute on a $200/mo plan = 70x subsidy ratio) and verifies
 *      whether unsubsidized API cost still beats human labor ROI.
 *    - SemiAnalysis GDPX Cost-Performance Router: Routes tasks from $51/task Opus 5.5
 *      to $16/task Gemini 4 Carbon (~99.4% GDPX parity at 1/3.19th the cost) or local
 *      zero-cost models, with automatic rate-limit failover to Nous Hermes, Dots, Duet,
 *      and Meta Muse.
 *    - Personal Agent Top-of-Funnel -> SMB Connector Monetizer (Stripe, QuickBooks, Canva, GitHub).
 *
 * 2. Model Optimization & Recursive Self-Improvement (RSI) Governance:
 *    - MIT Direct Sparse Parameter Surgery (Rakia Takahi et al.): Inspects reasoning-loop
 *      pathologies (repetition loops, sycophancy, premature stop) and directly edits <= 0.016%
 *      (0.00016) of target parameters without gradient backprop or full RL training.
 *    - Anthropic S-1 Human-in-the-Loop RSI Guardrail: Blocks autonomous self-iteration on
 *      reward functions, gate engines, or >0.016% parameter edits without human approval
 *      and an interpretability receipt.
 *
 * 3. Enterprise Integration & GEO (Generative Engine Optimization):
 *    - Audits enterprise gateway/governance readiness (solving corporate inertia over raw IQ)
 *      and scores public docs for zero-click AI citation (GEO).
 */

const MAX_SPARSE_PATCH_FRACTION = 0.00016; // 0.016% MIT direct weight-editing ceiling
const DEFAULT_HUMAN_HOURLY_USD = 75;

/**
 * SemiAnalysis GDPX benchmark catalog (score out of 100 vs true API cost per complex agent task).
 */
const GDPX_MODEL_CATALOG = Object.freeze([
  {
    id: 'opus-5.5',
    provider: 'anthropic',
    gdpxScore: 88.4,
    costPerTaskUsd: 51.0,
    tier: 'frontier_premium',
  },
  {
    id: 'gpt-6-astra',
    provider: 'openai',
    gdpxScore: 88.7,
    costPerTaskUsd: 44.0,
    tier: 'frontier_premium',
  },
  {
    id: 'gemini-4-carbon',
    provider: 'google',
    gdpxScore: 87.9,
    costPerTaskUsd: 16.0,
    tier: 'gdpx_sweet_spot',
  },
  {
    id: 'qwen-3.5-0.8b-patched',
    provider: 'local-mlx',
    gdpxScore: 71.5,
    costPerTaskUsd: 0.02,
    tier: 'local_distilled',
  },
]);

/**
 * Alternative agent ecosystems when a flat-rate consumer agent (e.g. GrokBot) hits sudden usage caps.
 */
const AGENT_ECOSYSTEM_FAILOVERS = Object.freeze([
  {
    id: 'nous-hermes',
    name: 'Nous Research Hermes',
    strength: 'Open-weights agentic tool calling & uncapped BYO-compute execution',
     connectors: ['github', 'cli', 'mcp'],
  },
  {
    id: 'dots',
    name: 'Dots Agent',
    strength: 'Lightweight autonomous task routing with deterministic workflow graphs',
    connectors: ['slack', 'linear', 'github'],
  },
  {
    id: 'duet',
    name: 'Duet Workspace Agent',
    strength: 'Multiplayer human-in-the-loop document & repo co-execution',
    connectors: ['google-workspace', 'github', 'notion'],
  },
  {
    id: 'meta-muse',
    name: 'Meta Muse SMB Suite',
    strength: 'Turnkey SMB back-office connectors for billing, accounting, and design',
    connectors: ['stripe', 'quickbooks', 'canva'],
  },
]);

/**
 * Pillar 1A: Audit unit economics at true unsubsidized API cost vs flat-rate consumer subsidy.
 */
function auditTrueApiUnitEconomics(input = {}) {
  const flatRatePlanMonthlyUsd = Math.max(0, Number(input.flatRatePlanMonthlyUsd ?? 200));
  const trueApiComputeMonthlyUsd = Math.max(0, Number(input.trueApiComputeMonthlyUsd ?? 0));
  const tasksCompletedMonthly = Math.max(1, Number(input.tasksCompletedMonthly ?? 100));
  const humanMinutesSavedPerTask = Math.max(0, Number(input.humanMinutesSavedPerTask ?? 30));
  const humanHourlyUsd = Math.max(1, Number(input.humanHourlyUsd ?? DEFAULT_HUMAN_HOURLY_USD));
  const downstreamSmbRevenueMonthlyUsd = Math.max(0, Number(input.downstreamSmbRevenueMonthlyUsd ?? 0));

  const subsidyMultiplier = flatRatePlanMonthlyUsd > 0
    ? Number((trueApiComputeMonthlyUsd / flatRatePlanMonthlyUsd).toFixed(2))
    : 0;
  const trueCostPerTaskUsd = Number((trueApiComputeMonthlyUsd / tasksCompletedMonthly).toFixed(4));
  const humanLaborValuePerTaskUsd = Number(((humanMinutesSavedPerTask / 60) * humanHourlyUsd).toFixed(4));
  const totalMonthlyValueUsd = Number(
    (tasksCompletedMonthly * humanLaborValuePerTaskUsd + downstreamSmbRevenueMonthlyUsd).toFixed(2),
  );
  const unsubsidizedRoiMultiple = trueApiComputeMonthlyUsd > 0
    ? Number((totalMonthlyValueUsd / trueApiComputeMonthlyUsd).toFixed(4))
    : Infinity;

  const subsidyDependent = subsidyMultiplier > 3.0 && unsubsidizedRoiMultiple < 1.0;

  return {
    flatRatePlanMonthlyUsd,
    trueApiComputeMonthlyUsd,
    subsidyMultiplier,
    trueCostPerTaskUsd,
    humanLaborValuePerTaskUsd,
    totalMonthlyValueUsd,
    unsubsidizedRoiMultiple,
    beatsHumanLaborAtTrueCost: humanLaborValuePerTaskUsd >= trueCostPerTaskUsd,
    subsidyDependent,
    verdict: subsidyDependent
      ? 'SUBSIDY_TRAP_UNPROFITABLE_AT_TRUE_COST'
      : (unsubsidizedRoiMultiple >= 1.5 ? 'HEALTHY_UNSUBSIDIZED_UNIT_ECONOMICS' : 'MARGINAL_NEEDS_GDPX_ROUTING'),
  };
}

/**
 * Pillar 1B: Route tasks using SemiAnalysis GDPX efficiency (performance per dollar)
 * and provide failover ecosystems when flat-rate plans hit rate limits.
 */
function routeByGdpxEfficiency(task = {}) {
  const minGdpxScore = typeof task.minGdpxScore === 'number' ? task.minGdpxScore : 86.0;
  const maxCostPerTaskUsd = typeof task.maxCostPerTaskUsd === 'number' ? task.maxCostPerTaskUsd : 25.0;
  const baselineModelId = task.baselineModelId || 'opus-5.5';
  const rateLimitedProvider = task.rateLimitedProvider ? String(task.rateLimitedProvider).toLowerCase() : null;
  const requiredConnector = task.requiredConnector ? String(task.requiredConnector).toLowerCase() : null;

  const baseline = GDPX_MODEL_CATALOG.find((m) => m.id === baselineModelId) || GDPX_MODEL_CATALOG[0];

  const eligible = GDPX_MODEL_CATALOG.filter(
    (m) => m.gdpxScore >= minGdpxScore && m.costPerTaskUsd <= maxCostPerTaskUsd,
  );

  // Rank by GDPX points per dollar (with $0.01 floor to keep local finite)
  const ranked = (eligible.length > 0 ? eligible : GDPX_MODEL_CATALOG.slice()).sort((a, b) => {
    const effA = a.gdpxScore / Math.max(0.5, a.costPerTaskUsd);
    const effB = b.gdpxScore / Math.max(0.5, b.costPerTaskUsd);
    return effB - effA;
  });

  const selected = ranked[0];
  const savingsPerTaskUsd = Number(Math.max(0, baseline.costPerTaskUsd - selected.costPerTaskUsd).toFixed(2));
  const costReductionRatio = selected.costPerTaskUsd > 0
    ? Number((baseline.costPerTaskUsd / selected.costPerTaskUsd).toFixed(2))
    : Infinity;
  const scoreRetentionPct = Number(((selected.gdpxScore / baseline.gdpxScore) * 100).toFixed(2));

  let recommendedFailover = null;
  if (rateLimitedProvider || requiredConnector) {
    recommendedFailover = AGENT_ECOSYSTEM_FAILOVERS.find(
      (eco) => !requiredConnector || eco.connectors.includes(requiredConnector),
    ) || AGENT_ECOSYSTEM_FAILOVERS[0];
  }

  return {
    selectedModel: selected.id,
    selectedProvider: selected.provider,
    selectedCostPerTaskUsd: selected.costPerTaskUsd,
    selectedGdpxScore: selected.gdpxScore,
    baselineModel: baseline.id,
    baselineCostPerTaskUsd: baseline.costPerTaskUsd,
    savingsPerTaskUsd,
    costReductionRatio,
    scoreRetentionPct,
    recommendedFailover,
  };
}

/**
 * Pillar 2A: MIT Direct Sparse Parameter / Weight Surgery (Rakia Takahi et al.)
 * Frontier model inspects a smaller model's reasoning loop and directly edits <= 0.016%
 * (0.00016) of weights/parameters without gradients or RL training.
 */
function applySparseSurgicalParameterPatch(modelState = {}, patchSpec = {}) {
  const totalParameters = Math.max(1, Number(modelState.totalParameters ?? 800_000_000)); // e.g. Qwen 3.5 0.8B
  const edits = Array.isArray(patchSpec.edits) ? patchSpec.edits : [];
  const editedCount = edits.reduce((acc, item) => acc + Math.max(1, Number(item.parameterCount ?? 1)), 0);
  const editedFraction = editedCount / totalParameters;
  const maxAllowedParameters = Math.floor(totalParameters * MAX_SPARSE_PATCH_FRACTION);

  if (editedFraction > MAX_SPARSE_PATCH_FRACTION) {
    return {
      applied: false,
      reason: `Sparse patch touched ${editedCount} parameters (${(editedFraction * 100).toFixed(5)}%), exceeding MIT 0.016% ceiling (${maxAllowedParameters} max). Use targeted surgical edits instead of dense weight updates.`,
      editedCount,
      editedFraction: Number(editedFraction.toFixed(8)),
      maxAllowedFraction: MAX_SPARSE_PATCH_FRACTION,
    };
  }

  const patchedWeights = { ...(modelState.weights || {}) };
  for (const edit of edits) {
    if (edit && typeof edit.layerKey === 'string' && typeof edit.delta === 'number') {
      const current = Number(patchedWeights[edit.layerKey] ?? 0);
      patchedWeights[edit.layerKey] = Number((current + edit.delta).toFixed(6));
    }
  }

  return {
    applied: true,
    gradientFree: true,
    diagnosticianModel: patchSpec.diagnosticianModel || 'gpt-6-astra',
    targetModel: modelState.modelId || 'qwen-3.5-0.8b',
    pathologyFixed: patchSpec.pathology || 'reasoning_repetition_loop',
    editedCount,
    editedFraction: Number(editedFraction.toFixed(8)),
    maxAllowedFraction: MAX_SPARSE_PATCH_FRACTION,
    patchedWeights,
  };
}

/**
 * Pillar 2B: Anthropic S-1 Human-in-the-Loop RSI Governance Gate.
 * Blocks autonomous self-modification of core safety gates, reward functions, or >0.016%
 * parameter updates without human approval and interpretability receipts.
 */
function evaluateRsiHumanGovernanceGate(proposal = {}) {
  const targetSurface = String(proposal.targetSurface || '');
  const touchesSafetyOrReward = Boolean(
    proposal.touchesSafetyGate ||
    proposal.touchesRewardFunction ||
    /(?:gates-engine|prompt-guard|reward|policy-weights|entitlement)/i.test(targetSurface),
  );
  const editedFraction = Number(proposal.editedFraction ?? 0);
  const exceedsSparseBound = editedFraction > MAX_SPARSE_PATCH_FRACTION;
  const hasHumanApproval = proposal.humanApproved === true && Boolean(proposal.approvedBy);
  const hasInterpretabilityReceipt = Boolean(
    proposal.interpretabilityReceipt &&
    typeof proposal.interpretabilityReceipt.rationale === 'string' &&
    proposal.interpretabilityReceipt.rationale.trim().length >= 10,
  );

  if ((touchesSafetyOrReward || exceedsSparseBound) && (!hasHumanApproval || !hasInterpretabilityReceipt)) {
    return {
      decision: 'block',
      gate: 'anthropic-s1-rsi-human-in-the-loop',
      touchesSafetyOrReward,
      exceedsSparseBound,
      hasHumanApproval,
      hasInterpretabilityReceipt,
      reason: 'Blocked autonomous RSI mutation: Anthropic S-1 governance requires explicit human-in-the-loop approval and an interpretability receipt before modifying safety gates, reward functions, or >0.016% of model parameters.',
    };
  }

  return {
    decision: 'allow',
    gate: 'anthropic-s1-rsi-human-in-the-loop',
    touchesSafetyOrReward,
    exceedsSparseBound,
    hasHumanApproval,
    hasInterpretabilityReceipt,
  };
}

/**
 * Pillar 3: Enterprise Integration & GEO (Generative Engine Optimization) Scorer.
 * Measures readiness for enterprise system integration (data gateways, governance, SMB connectors)
 * and zero-click AI answer citation (structured facts, commands, JSON-LD / llms.txt signals).
 */
function scoreEnterpriseAndGeoReadiness(payload = {}) {
  const text = String(payload.content || '');
  const connectors = Array.isArray(payload.connectors) ? payload.connectors : [];
  const hasDataGateway = Boolean(payload.hasDataGateway || /gateway|pretooluse|firewall|airlock/i.test(text));
  const hasGovernanceLayer = Boolean(payload.hasGovernanceLayer || /governance|audit|receipt|policy/i.test(text));
  const hasSmbConnectors = connectors.length > 0 || /stripe|quickbooks|canva|github|slack|jira/i.test(text);

  // GEO signals for zero-click AI engine citation
  const hasCanonicalFacts = /\b(?:\$\d+|\d+(?:\.\d+)?%|npx\s+thumbgate|[A-Za-z0-9_-]+\.js)\b/.test(text);
  const hasFaqOrStructuredHeadings = /^#{1,3}\s+.+/m.test(text);
  const hasMachineReadableSchema = Boolean(payload.hasLlmsTxt || payload.hasJsonLd || /application\/ld\+json|llms\.txt/i.test(text));

  const enterpriseChecks = [hasDataGateway, hasGovernanceLayer, hasSmbConnectors];
  const geoChecks = [hasCanonicalFacts, hasFaqOrStructuredHeadings, hasMachineReadableSchema];

  const enterpriseScore = Number(((enterpriseChecks.filter(Boolean).length / enterpriseChecks.length) * 100).toFixed(1));
  const geoScore = Number(((geoChecks.filter(Boolean).length / geoChecks.length) * 100).toFixed(1));

  return {
    enterpriseScore,
    geoScore,
    combinedScore: Number(((enterpriseScore + geoScore) / 2).toFixed(1)),
    signals: {
      hasDataGateway,
      hasGovernanceLayer,
      hasSmbConnectors,
      hasCanonicalFacts,
      hasFaqOrStructuredHeadings,
      hasMachineReadableSchema,
    },
  };
}


/**
 * Pillar 4 (Mazin Gilbert AAIF Interview — https://thenewstack.io/mazin-gilbert-aaif-interview/):
 *   4A. Stateless MCP (2026-07-28 spec) + AAIF 10-Project Gateway Harmonizer
 *       (Solo.io agentgateway + Envoy Agent Router + Anthropic Agent Skills +
 *        OpenAI Open Responses + Hugging Face OpenEnv + Alibaba OpenSandbox).
 *   4B. 5-Step Transactional Agent Commerce State Machine:
 *       discover_catalog -> negotiate_terms -> authorize_payment -> verify_fulfillment -> resolve_dispute_or_return
 *   4C. Physical AI Appliance Actuation Safety Gate.
 */
const AAIF_HOSTED_PROJECTS = Object.freeze([
  'mcp-stateless-2026-07-28',
  'anthropic-agent-skills',
  'openai-open-responses',
  'huggingface-openenv',
  'alibaba-opensandbox',
  'solo-agentgateway',
  'envoy-agent-router',
]);

const AGENT_COMMERCE_STEPS = Object.freeze([
  'discover_catalog',
  'negotiate_terms',
  'authorize_payment',
  'verify_fulfillment',
  'resolve_dispute_or_return',
]);

function harmonizeAaifGatewayEnvelope(envelope = {}) {
  const protocolVersion = envelope.protocolVersion || '2026-07-28';
  const stateless = envelope.stateless !== false;
  const gatewayAdapter = envelope.gatewayAdapter || 'solo-agentgateway';
  const routerAdapter = envelope.routerAdapter || 'envoy-agent-router';
  const sandboxAdapter = envelope.sandboxAdapter || 'alibaba-opensandbox';
  const responseFormat = envelope.responseFormat || 'openai-open-responses';
  const skillFormat = envelope.skillFormat || 'anthropic-agent-skills';

  const missingStatelessFields = [];
  if (!envelope.idempotencyKey) missingStatelessFields.push('idempotencyKey');
  if (!envelope.capabilityScope) missingStatelessFields.push('capabilityScope');

  return {
    harmonized: stateless && missingStatelessFields.length === 0,
    protocolVersion,
    stateless,
    gatewayAdapter,
    routerAdapter,
    sandboxAdapter,
    responseFormat,
    skillFormat,
    missingStatelessFields,
    supportedProjects: AAIF_HOSTED_PROJECTS,
  };
}

function evaluateTransactionalAgentCommerce(tx = {}) {
  const step = String(tx.step || 'discover_catalog');
  const validStep = AGENT_COMMERCE_STEPS.includes(step);
  const amountUsd = Math.max(0, Number(tx.amountUsd ?? 0));
  const maxAuthorizedUsd = Math.max(0, Number(tx.maxAuthorizedUsd ?? 0));
  const isPhysicalAi = Boolean(tx.physicalAiAppliance);

  if (!validStep) {
    return {
      allowed: false,
      step,
      reason: `Invalid agent commerce step "${step}". Must follow AAIF transactional lifecycle: ${AGENT_COMMERCE_STEPS.join(' -> ')}`,
    };
  }

  if (step === 'authorize_payment' && (amountUsd > maxAuthorizedUsd || !tx.merchantId || !tx.idempotencyKey)) {
    return {
      allowed: false,
      step,
      amountUsd,
      maxAuthorizedUsd,
      reason: 'Transactional agent payment blocked: requires merchantId, idempotencyKey, and amountUsd <= maxAuthorizedUsd.',
    };
  }

  if (isPhysicalAi && (!tx.failSafeState || tx.humanOverrideEnabled !== true)) {
    return {
      allowed: false,
      step,
      physicalAiAppliance: true,
      reason: 'Physical AI appliance actuation blocked: requires explicit failSafeState and humanOverrideEnabled=true.',
    };
  }

  return {
    allowed: true,
    step,
    nextStep: AGENT_COMMERCE_STEPS[AGENT_COMMERCE_STEPS.indexOf(step) + 1] || null,
    amountUsd,
    maxAuthorizedUsd,
    physicalAiAppliance: isPhysicalAi,
  };
}
module.exports = {
  AAIF_HOSTED_PROJECTS,
  AGENT_COMMERCE_STEPS,
  AGENT_ECOSYSTEM_FAILOVERS,
  GDPX_MODEL_CATALOG,
  MAX_SPARSE_PATCH_FRACTION,
  applySparseSurgicalParameterPatch,
  auditTrueApiUnitEconomics,
  evaluateRsiHumanGovernanceGate,
  evaluateTransactionalAgentCommerce,
  harmonizeAaifGatewayEnvelope,
  routeByGdpxEfficiency,
  scoreEnterpriseAndGeoReadiness,
};

if (require.main === module) {
  const econ = auditTrueApiUnitEconomics({
    flatRatePlanMonthlyUsd: 200,
    trueApiComputeMonthlyUsd: 14000,
    tasksCompletedMonthly: 250,
    humanMinutesSavedPerTask: 20,
  });
  const route = routeByGdpxEfficiency({ baselineModelId: 'opus-5.5', rateLimitedProvider: 'grokbot', requiredConnector: 'stripe' });
  process.stdout.write(`${JSON.stringify({ econ, route }, null, 2)}\n`);
}
