#!/usr/bin/env node
'use strict';

/**
 * RSI, End-of-Subsidy Unit Economics, SemiAnalysis GDPX Routing & MIT 0.016%
 * Direct Weight-Editing Honesty Gate ("AI Lurches Towards RSI", NLW).
 *
 * Source:
 *   - https://www.youtube.com/watch?v=Es59icF3nZg ("AI Lurches Towards RSI")
 *
 * Operationalizes 3 pillars across ThumbGate:
 *   1. End-of-Subsidy Agent Unit Economics & SemiAnalysis GDPX Routing:
 *      - Audits workflows against true unsubsidized API cost (exposing $14,000 API
 *        compute on $200/mo consumer flat-rate plans = 70x subsidy fragility).
 *      - Routes tasks via SemiAnalysis GDPX cost-performance frontier ($16/task
 *        Gemini 4 Carbon vs $51/task Opus 5.5 -> 68.6% cost reduction at ~98.6% parity).
 *      - Enforces personal agents as Top-of-Funnel (ToF) lead-gen into SMB connectors
 *        (Stripe, QuickBooks, Canva, GitHub) and high-ticket B2B tiers ($19/$49/$499).
 *      - Provides deterministic failover across agent ecosystems (Nous Hermes, Dots,
 *        Duet, Meta Muse, Local Ollama) when GrokBot/provider usage caps hit.
 *   2. MIT Direct Sparse Weight-Editing (0.016%) & Anthropic S-1 HITL RSI Governance:
 *      - Models Rakia Takahi et al. (MIT) gradient-free surgical weight editing:
 *        frontier teacher inspects and edits 0.016% (0.00016) of student weights
 *        (e.g. Qwen 3.5 0.8B) to break reasoning loops without full RL training.
 *      - Enforces Anthropic S-1 Human-in-the-Loop (HITL) and interpretability diff
 *        guardrails on any autonomous recursive self-improvement (RSI) mutation.
 *   3. Enterprise Inertia Gateway & GEO (Generative Engine Optimization):
 *      - Scores system integration + PreToolUse governance over raw model scale.
 *      - Audits public documentation for zero-click AI citation (GEO readiness).
 */

const SOURCE_URLS = Object.freeze([
  'https://www.youtube.com/watch?v=Es59icF3nZg',
]);

const MIT_SURGICAL_WEIGHT_FRACTION = 0.00016; // 0.016% of parameters
const MAX_SAFE_SURGICAL_FRACTION = 0.0005; // 0.05% ceiling before full finetune required
const SUBSIDY_ALERT_MULTIPLIER = 3.0; // Flag workflows consuming >3x their flat subscription fee

/**
 * SemiAnalysis GDPX Cost-Performance Reference Catalog
 */
const GDPX_MODEL_CATALOG = Object.freeze({
  'opus-5.5': Object.freeze({
    modelId: 'opus-5.5',
    costPerTaskUsd: 51.0,
    gdpxScore: 95.5,
    tier: 'frontier_premium',
    supportsSurgicalTeacher: true,
  }),
  'gemini-4-carbon': Object.freeze({
    modelId: 'gemini-4-carbon',
    costPerTaskUsd: 16.0,
    gdpxScore: 94.2,
    tier: 'gdpx_efficiency_leader',
    supportsSurgicalTeacher: true,
  }),
  'gpt-6-astra': Object.freeze({
    modelId: 'gpt-6-astra',
    costPerTaskUsd: 44.0,
    gdpxScore: 96.1,
    tier: 'frontier_teacher',
    supportsSurgicalTeacher: true,
  }),
  'hermes-nous-agent': Object.freeze({
    modelId: 'hermes-nous-agent',
    costPerTaskUsd: 4.2,
    gdpxScore: 88.5,
    tier: 'open_weights_agent',
    supportsSurgicalTeacher: false,
  }),
  'qwen-3.5-0.8b-surgical': Object.freeze({
    modelId: 'qwen-3.5-0.8b-surgical',
    costPerTaskUsd: 0.08,
    gdpxScore: 81.4,
    tier: 'local_distilled_student',
    supportsSurgicalTeacher: false,
  }),
});

const FAILOVER_ECOSYSTEMS = Object.freeze([
  { id: 'nous-hermes', name: 'Nous Research Hermes', openWeights: true, rateLimitResilience: 'high' },
  { id: 'meta-muse', name: 'Meta Muse SMB Connectors', openWeights: false, rateLimitResilience: 'high' },
  { id: 'dots-agent', name: 'Dots Autonomous Workspace', openWeights: false, rateLimitResilience: 'medium' },
  { id: 'duet-agent', name: 'Duet Collaborative Agent', openWeights: false, rateLimitResilience: 'medium' },
]);

/**
 * 1A. Audit unit economics at true unsubsidized API cost vs flat-rate consumer subsidy.
 */
function auditTrueApiUnitEconomics({
  flatSubscriptionFeeUsd = 200,
  trueApiComputeBurnUsd = 14000,
  monthlyTasksCompleted = 250,
  revenueGeneratedUsd = 2500,
  humanLaborEquivalentUsd = 8000,
} = {}) {
  const flatFee = Math.max(0, Number(flatSubscriptionFeeUsd) || 0);
  const trueApiBurn = Math.max(0, Number(trueApiComputeBurnUsd) || 0);
  const tasks = Math.max(1, Number(monthlyTasksCompleted) || 1);
  const revenue = Math.max(0, Number(revenueGeneratedUsd) || 0);
  const humanBaseline = Math.max(0, Number(humanLaborEquivalentUsd) || 0);

  const subsidyMultiplier = flatFee > 0 ? Number((trueApiBurn / flatFee).toFixed(2)) : 0;
  const trueCostPerTaskUsd = Number((trueApiBurn / tasks).toFixed(4));
  const apparentMarginOnSubsidyUsd = Number((revenue - flatFee).toFixed(2));
  const trueContributionProfitUsd = Number((revenue - trueApiBurn).toFixed(2));
  const beatsHumanLaborAtTrueCost = trueApiBurn < humanBaseline;
  const humanRoiMultiple = trueApiBurn > 0 ? Number((humanBaseline / trueApiBurn).toFixed(4)) : Infinity;

  const isSubsidyFragile = subsidyMultiplier > SUBSIDY_ALERT_MULTIPLIER && trueContributionProfitUsd < 0;

  let verdict = 'PASS_TRUE_UNIT_ECONOMICS';
  if (isSubsidyFragile) {
    verdict = 'FAIL_SUBSIDY_ILLUSION';
  } else if (!beatsHumanLaborAtTrueCost) {
    verdict = 'FAIL_WORSE_THAN_HUMAN_LABOR';
  }

  return {
    ok: verdict === 'PASS_TRUE_UNIT_ECONOMICS',
    verdict,
    flatSubscriptionFeeUsd: flatFee,
    trueApiComputeBurnUsd: trueApiBurn,
    subsidyMultiplier,
    trueCostPerTaskUsd,
    apparentMarginOnSubsidyUsd,
    trueContributionProfitUsd,
    humanLaborEquivalentUsd: humanBaseline,
    beatsHumanLaborAtTrueCost,
    humanRoiMultiple,
  };
}

/**
 * 1B. Route tasks using SemiAnalysis GDPX cost-efficiency frontier.
 */
function routeByGdpxEfficiency({
  requestedModel = 'opus-5.5',
  minGdpxScore = 92.0,
  hardFrontierEscalation = false,
  catalog = GDPX_MODEL_CATALOG,
} = {}) {
  const baseline = catalog[requestedModel] || catalog['opus-5.5'];
  if (hardFrontierEscalation) {
    return {
      selectedModel: baseline.modelId,
      baselineModel: baseline.modelId,
      costPerTaskUsd: baseline.costPerTaskUsd,
      baselineCostUsd: baseline.costPerTaskUsd,
      savingsPerTaskUsd: 0,
      savingsPct: 0,
      gdpxScore: baseline.gdpxScore,
      gdpxPointsPerDollar: Number((baseline.gdpxScore / Math.max(0.01, baseline.costPerTaskUsd)).toFixed(4)),
      reason: 'Explicit hardFrontierEscalation approved.',
    };
  }

  const eligible = Object.values(catalog).filter((m) => m.gdpxScore >= minGdpxScore);
  const candidates = eligible.length > 0 ? eligible : Object.values(catalog);

  // Rank by GDPX points per dollar, preferring high capability at 1/4th the cost (Gemini 4 Carbon pattern)
  const ranked = candidates.slice().sort((a, b) => {
    const effA = a.gdpxScore / Math.max(0.01, a.costPerTaskUsd);
    const effB = b.gdpxScore / Math.max(0.01, b.costPerTaskUsd);
    return effB - effA;
  });

  const best = ranked[0];
  const savingsPerTaskUsd = Number(Math.max(0, baseline.costPerTaskUsd - best.costPerTaskUsd).toFixed(2));
  const savingsPct = baseline.costPerTaskUsd > 0
    ? Number(((savingsPerTaskUsd / baseline.costPerTaskUsd) * 100).toFixed(2))
    : 0;

  return {
    selectedModel: best.modelId,
    baselineModel: baseline.modelId,
    costPerTaskUsd: best.costPerTaskUsd,
    baselineCostUsd: baseline.costPerTaskUsd,
    savingsPerTaskUsd,
    savingsPct,
    gdpxScore: best.gdpxScore,
    capabilityRetentionPct: Number(((best.gdpxScore / baseline.gdpxScore) * 100).toFixed(2)),
    gdpxPointsPerDollar: Number((best.gdpxScore / Math.max(0.01, best.costPerTaskUsd)).toFixed(4)),
    reason: `Routed from ${baseline.modelId} ($${baseline.costPerTaskUsd}/task) to ${best.modelId} ($${best.costPerTaskUsd}/task) via GDPX frontier.`,
  };
}

/**
 * 1C & 1D. Personal Agent Top-of-Funnel + Rate-Limit Ecosystem Failover.
 */
function evaluatePersonalAgentFunnel({
  hasDownstreamB2bSku = true,
  smbConnectors = ['stripe', 'github', 'quickbooks', 'canva'],
  primaryPlatformRateLimited = false,
  primaryPlatform = 'grokbot',
} = {}) {
  const validConnectors = Array.isArray(smbConnectors) ? smbConnectors.filter(Boolean) : [];
  const funnelMonetizable = Boolean(hasDownstreamB2bSku) && validConnectors.length >= 2;
  const recommendedFailover = primaryPlatformRateLimited ? FAILOVER_ECOSYSTEMS[0] : null;

  return {
    ok: funnelMonetizable,
    verdict: funnelMonetizable ? 'PASS_TOF_SMB_FUNNEL' : 'FAIL_UNMONETIZED_CONSUMER_BURN',
    primaryPlatform,
    primaryPlatformRateLimited,
    smbConnectorCount: validConnectors.length,
    smbConnectors: validConnectors,
    recommendedFailover,
    availableFailovers: FAILOVER_ECOSYSTEMS,
  };
}

/**
 * 2A. MIT Direct Sparse Weight-Editing Analyzer (Rakia Takahi et al. — 0.016% surgical edit).
 * Computes exact surgical parameter budget and loop-suppression effectiveness without RL/gradients.
 */
function analyzeMitSparseWeightEdit({
  studentModel = 'qwen-3.5-0.8b',
  totalParameters = 800_000_000,
  editedParameters = 128_000, // 0.016% of 800M
  preEditLoopRate = 0.34,
  postEditLoopRate = 0.03,
  usedGradientsOrRl = false,
} = {}) {
  const total = Math.max(1, Number(totalParameters) || 800_000_000);
  const edited = Math.max(0, Number(editedParameters) || 0);
  const editedFraction = edited / total;
  const editedPct = Number((editedFraction * 100).toFixed(4));
  const referenceMitParams = Math.round(total * MIT_SURGICAL_WEIGHT_FRACTION);
  const loopReductionPct = preEditLoopRate > 0
    ? Number((((preEditLoopRate - postEditLoopRate) / preEditLoopRate) * 100).toFixed(2))
    : 0;

  const isSurgical = !usedGradientsOrRl && editedFraction > 0 && editedFraction <= MAX_SAFE_SURGICAL_FRACTION;

  return {
    ok: isSurgical && postEditLoopRate < preEditLoopRate,
    studentModel,
    totalParameters: total,
    editedParameters: edited,
    referenceMitParametersAt0_016Pct: referenceMitParams,
    editedFraction: Number(editedFraction.toFixed(6)),
    editedPct,
    usedGradientsOrRl: Boolean(usedGradientsOrRl),
    preEditLoopRate,
    postEditLoopRate,
    loopReductionPct,
    classification: isSurgical ? 'MIT_DIRECT_SPARSE_WEIGHT_EDIT' : 'FULL_GRADIENT_OR_OVERSIZED_EDIT',
  };
}

/**
 * 2B. Anthropic S-1 Human-in-the-Loop (HITL) Governance Diode for Recursive Self-Improvement (RSI).
 * Blocks autonomous weight or core-gate self-modification unless human supervision,
 * interpretability diff hash, and isolated verifier checks are all present.
 */
function enforceRsiHitlGovernance({
  mutationType = 'surgical_weight_edit',
  humanSupervisorApproved = false,
  interpretabilityDiffHash = '',
  isolatedVerifierPassed = false,
  editedFraction = MIT_SURGICAL_WEIGHT_FRACTION,
} = {}) {
  const missingControls = [];
  if (!humanSupervisorApproved) missingControls.push('human_supervisor_approval');
  if (!String(interpretabilityDiffHash || '').trim()) missingControls.push('interpretability_diff_hash');
  if (!isolatedVerifierPassed) missingControls.push('isolated_verifier_pass');
  if (Number(editedFraction) > MAX_SAFE_SURGICAL_FRACTION) missingControls.push('exceeds_surgical_weight_bound');

  const allowed = missingControls.length === 0;
  return {
    ok: allowed,
    verdict: allowed ? 'ALLOW_GOVERNED_RSI_STEP' : 'BLOCK_UNGUARDED_RSI_MUTATION',
    mutationType,
    missingControls,
    s1Compliance: allowed,
  };
}

/**
 * 3. Enterprise Gateway & GEO (Generative Engine Optimization) Citation Auditor.
 */
function auditGeoCitationReadiness(markdownText = '') {
  const text = String(markdownText || '');
  const hasCanonicalUrl = /https?:\/\/[^\s)]+/i.test(text);
  const hasQuantifiedReceipts = /(?:\b\d+(?:\.\d+)?%|\$\d+(?:\.\d+)?|<1ms|\b\d+\/\d+\b)/.test(text);
  const hasStructuredHeadings = /^#{1,3}\s+.+/m.test(text);
  const hasDirectAnswerBlock = /\b(TL;DR|Key Takeaway|Verdict|Summary|Blueprint)\b/i.test(text);

  const signals = [
    hasCanonicalUrl,
    hasQuantifiedReceipts,
    hasStructuredHeadings,
    hasDirectAnswerBlock,
  ];
  const score = Math.round((signals.filter(Boolean).length / signals.length) * 100);

  return {
    ok: score >= 75,
    geoScore: score,
    hasCanonicalUrl,
    hasQuantifiedReceipts,
    hasStructuredHeadings,
    hasDirectAnswerBlock,
  };
}

function runDoctor() {
  const subsidyAudit = auditTrueApiUnitEconomics({
    flatSubscriptionFeeUsd: 200,
    trueApiComputeBurnUsd: 14000,
    monthlyTasksCompleted: 250,
    revenueGeneratedUsd: 2500,
    humanLaborEquivalentUsd: 8000,
  });

  const gdpxRoute = routeByGdpxEfficiency({
    requestedModel: 'opus-5.5',
    minGdpxScore: 93.0,
  });

  const mitEdit = analyzeMitSparseWeightEdit({
    studentModel: 'qwen-3.5-0.8b',
    totalParameters: 800_000_000,
    editedParameters: 128_000,
    preEditLoopRate: 0.34,
    postEditLoopRate: 0.03,
    usedGradientsOrRl: false,
  });

  const blockedUnguardedRsi = enforceRsiHitlGovernance({
    mutationType: 'autonomous_weight_rewrite',
    humanSupervisorApproved: false,
    interpretabilityDiffHash: '',
    isolatedVerifierPassed: true,
  });

  const geoCheck = auditGeoCitationReadiness(
    '# ThumbGate <1ms PreToolUse Diode\n**Verdict:** Blocks 100% of destructive tool calls in <1ms ($16/task GDPX route vs $51/task). Canonical: https://thumbgate.co'
  );

  const checks = [
    {
      id: 'subsidy_illusion_detector',
      ok: subsidyAudit.ok === false && subsidyAudit.verdict === 'FAIL_SUBSIDY_ILLUSION' && subsidyAudit.subsidyMultiplier === 70,
      detail: `burn=$${subsidyAudit.trueApiComputeBurnUsd} vs plan=$${subsidyAudit.flatSubscriptionFeeUsd} (${subsidyAudit.subsidyMultiplier}x subsidy)`,
    },
    {
      id: 'gdpx_cost_efficiency_router',
      ok: gdpxRoute.selectedModel === 'gemini-4-carbon' && gdpxRoute.savingsPerTaskUsd === 35,
      detail: `${gdpxRoute.baselineModel} ($${gdpxRoute.baselineCostUsd}) -> ${gdpxRoute.selectedModel} ($${gdpxRoute.costPerTaskUsd}), saved $${gdpxRoute.savingsPerTaskUsd}/task (${gdpxRoute.savingsPct}%)`,
    },
    {
      id: 'mit_0_016_pct_sparse_weight_edit',
      ok: mitEdit.ok === true && mitEdit.editedPct === 0.016 && mitEdit.classification === 'MIT_DIRECT_SPARSE_WEIGHT_EDIT',
      detail: `edited=${mitEdit.editedParameters}/${mitEdit.totalParameters} (${mitEdit.editedPct}%), loopReduction=${mitEdit.loopReductionPct}%`,
    },
    {
      id: 'anthropic_s1_hitl_rsi_guardrail',
      ok: blockedUnguardedRsi.ok === false && blockedUnguardedRsi.verdict === 'BLOCK_UNGUARDED_RSI_MUTATION',
      detail: `missing=${blockedUnguardedRsi.missingControls.join(',')}`,
    },
    {
      id: 'geo_zero_click_citation_readiness',
      ok: geoCheck.ok === true && geoCheck.geoScore === 100,
      detail: `geoScore=${geoCheck.geoScore}/100`,
    },
  ];

  const allOk = checks.every((c) => c.ok);
  return {
    ok: allOk,
    verdict: allOk ? 'PASS' : 'FAIL',
    sourceUrls: SOURCE_URLS,
    checks,
  };
}

if (require.main === module) {
  const report = runDoctor();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`RSI & Post-Subsidy GDPX Honesty Doctor: ${report.verdict}\n`);
    for (const check of report.checks) {
      process.stdout.write(`  [${check.ok ? 'PASS' : 'FAIL'}] ${check.id}: ${check.detail}\n`);
    }
  }
  process.exit(report.ok ? 0 : 1);
}

module.exports = {
  SOURCE_URLS,
  MIT_SURGICAL_WEIGHT_FRACTION,
  MAX_SAFE_SURGICAL_FRACTION,
  GDPX_MODEL_CATALOG,
  FAILOVER_ECOSYSTEMS,
  auditTrueApiUnitEconomics,
  routeByGdpxEfficiency,
  evaluatePersonalAgentFunnel,
  analyzeMitSparseWeightEdit,
  enforceRsiHitlGovernance,
  auditGeoCitationReadiness,
  runDoctor,
};
