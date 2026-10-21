#!/usr/bin/env node
'use strict';

/**
 * NeMo Switchyard–inspired multi-model step router for ThumbGate.
 *
 * Steal high-ROI ideas from NVIDIA Nemotron 3.5 Lightning + NeMo Switchyard
 * (2026-08-11): always-on agents need more than one model; route each step
 * across a model pool for accuracy, efficiency, customization, and control.
 *
 * This is application-level routing + evidence, not a neural MoE. ThumbGate
 * still owns PreToolUse gates and proof. Nemotron Lightning (30B MoE / 3B
 * active) is the default cheap specialist for intent/gate/classify steps.
 */

const DEFAULT_POOL = Object.freeze([
  {
    id: 'nvidia/nemotron-3.5-lightning',
    model: 'nemotron-3.5-lightning',
    provider: 'nvidia',
    costClass: 'low',
    activeParamsB: 3,
    totalParamsB: 30,
    roles: ['intent', 'classify', 'gate', 'route-decision', 'always-on', 'specialized'],
    strengths: ['fast-inference', 'cost-efficiency', 'tool-use', 'reliability'],
  },
  {
    id: 'alibaba/qwen3.6-flash',
    model: 'qwen3.6-flash',
    provider: 'model-studio',
    costClass: 'low',
    roles: ['triage', 'gate', 'cheap-fast'],
    strengths: ['fast-inference', 'cost-efficiency', 'tool-use'],
  },
  {
    id: 'alibaba/qwen3.8-max',
    model: 'qwen3.8-max',
    provider: 'model-studio',
    costClass: 'medium',
    roles: ['coding', 'agentic', 'long-horizon', 'high-output'],
    strengths: ['agentic-coding', 'tool-use', 'long-horizon-coding', 'cost-efficiency'],
  },
  {
    id: 'anthropic/claude-sonnet',
    model: 'claude-sonnet-5-standard',
    provider: 'anthropic',
    costClass: 'high',
    roles: ['reasoning', 'architecture', 'quality', 'review'],
    strengths: ['reliability', 'long-horizon-coding', 'multi-agent'],
  },
  {
    id: 'google/gemini-2.5-flash',
    model: 'gemini-2.5-flash',
    provider: 'gemini',
    costClass: 'low',
    roles: ['concise', 'summarize', 'extract'],
    strengths: ['fast-inference', 'cost-efficiency', 'long-context'],
  },
  {
    id: 'local/frontier',
    model: 'local',
    provider: 'local',
    costClass: 'low',
    roles: ['private', 'sensitive', 'offline'],
    strengths: ['privacy', 'cost-efficiency', 'reliability'],
  },
]);

const STEP_ROLE_HINTS = Object.freeze({
  intent: ['intent', 'classify', 'detect', 'route-decision'],
  classify: ['classify', 'intent', 'label'],
  gate: ['gate', 'pretool', 'allow', 'deny', 'check'],
  code: ['code', 'coding', 'implement', 'patch', 'refactor'],
  reason: ['reason', 'architecture', 'design', 'plan', 'review'],
  summarize: ['summarize', 'extract', 'concise', 'compress'],
  private: ['private', 'sensitive', 'pii', 'secret', 'local'],
  bulk: ['bulk', 'high-volume', 'automation', 'always-on'],
});

const COST_RANK = Object.freeze({ low: 0, medium: 1, high: 2, variable: 1 });

function normalizeStep(step, index = 0) {
  if (typeof step === 'string') {
    return {
      id: `step-${index + 1}`,
      type: step,
      tags: [],
      riskLevel: 'medium',
    };
  }
  const s = step && typeof step === 'object' ? step : {};
  return {
    id: s.id || `step-${index + 1}`,
    type: String(s.type || s.role || s.name || 'unknown').toLowerCase(),
    tags: Array.isArray(s.tags) ? s.tags.map((t) => String(t).toLowerCase()) : [],
    riskLevel: String(s.riskLevel || 'medium').toLowerCase(),
    sensitive: Boolean(s.sensitive || s.privacyRoute === 'local'),
    highOutput: Boolean(s.highOutput || s.highVolume),
    contextTokens: Number(s.contextTokens) || 0,
  };
}

function inferStepRole(step) {
  if (step.sensitive) return 'private';
  const hay = `${step.type} ${(step.tags || []).join(' ')}`.toLowerCase();
  for (const [role, hints] of Object.entries(STEP_ROLE_HINTS)) {
    if (hints.some((h) => hay.includes(h))) return role;
  }
  if (step.highOutput || step.contextTokens >= 128000) return 'code';
  if (step.riskLevel === 'high') return 'reason';
  return 'intent';
}

function scorePoolMember(member, role, step) {
  const roles = Array.isArray(member.roles) ? member.roles : [];
  let score = 0;
  const matchedRoles = [];

  const roleMap = {
    intent: ['intent', 'classify', 'gate', 'route-decision', 'always-on', 'specialized', 'triage'],
    classify: ['classify', 'intent', 'label', 'specialized'],
    gate: ['gate', 'pretool', 'always-on', 'specialized', 'cheap-fast'],
    code: ['coding', 'agentic', 'long-horizon', 'high-output'],
    reason: ['reasoning', 'architecture', 'quality', 'review'],
    summarize: ['concise', 'summarize', 'extract'],
    private: ['private', 'sensitive', 'offline'],
    bulk: ['always-on', 'specialized', 'cheap-fast', 'triage', 'high-output'],
  };

  const wanted = roleMap[role] || ['specialized'];
  for (const w of wanted) {
    if (roles.includes(w)) {
      score += 20;
      matchedRoles.push(w);
    }
  }

  // Prefer low cost for non-quality roles
  const cost = COST_RANK[member.costClass] ?? 1;
  if (role === 'reason') score += cost * 4; // higher cost OK for quality
  else score += (2 - Math.min(cost, 2)) * 10;

  // MoE Lightning bonus for always-on / gate / intent
  if (member.activeParamsB && member.activeParamsB <= 4
    && ['intent', 'classify', 'gate', 'bulk'].includes(role)) {
    score += 12;
  }

  if (step.sensitive && member.provider !== 'local') {
    score -= 100;
  }
  if (step.sensitive && member.provider === 'local') {
    score += 40;
  }

  return { score, matchedRoles };
}

function pickModelForStep(stepInput, options = {}) {
  const pool = Array.isArray(options.pool) && options.pool.length
    ? options.pool
    : DEFAULT_POOL;
  const step = normalizeStep(stepInput, options.index || 0);
  const role = options.forceRole || inferStepRole(step);

  const ranked = pool.map((member) => {
    const scored = scorePoolMember(member, role, step);
    return {
      ...member,
      score: scored.score,
      matchedRoles: scored.matchedRoles,
    };
  }).sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));

  const winner = ranked[0];
  return {
    stepId: step.id,
    stepType: step.type,
    role,
    modelId: winner.id,
    model: winner.model,
    provider: winner.provider,
    costClass: winner.costClass,
    score: winner.score,
    reason: winner.provider === 'local' && step.sensitive
      ? 'Sensitive step forced to local pool member.'
      : `Switchyard step role=${role} → ${winner.id} (score ${winner.score}).`,
    alternatives: ranked.slice(1, 4).map((m) => ({
      modelId: m.id,
      score: m.score,
      provider: m.provider,
    })),
    evidence: {
      role,
      matchedRoles: winner.matchedRoles,
      poolSize: pool.length,
      activeParamsB: winner.activeParamsB || null,
      totalParamsB: winner.totalParamsB || null,
    },
  };
}

/**
 * Route a multi-step agent plan across the model pool (Switchyard core).
 * @param {Array|object} plan - array of steps or { steps: [] }
 */
function routeAgentSteps(plan, options = {}) {
  const steps = Array.isArray(plan)
    ? plan
    : (plan && Array.isArray(plan.steps) ? plan.steps : []);
  if (steps.length === 0) {
    return {
      architecture: 'switchyard-multi-model',
      mixtureOfExperts: false,
      steps: [],
      distinctModels: [],
      multiModel: false,
      reason: 'No steps to route.',
    };
  }

  const routed = steps.map((step, index) => pickModelForStep(step, { ...options, index }));
  const distinctModels = [...new Set(routed.map((r) => r.modelId))];
  const multiModel = distinctModels.length > 1;
  const complex = steps.length >= 2
    || routed.some((r) => r.role === 'code' || r.role === 'reason');

  return {
    architecture: 'switchyard-multi-model',
    mixtureOfExperts: false,
    inspiredBy: 'NVIDIA NeMo Switchyard + Nemotron 3.5 Lightning',
    steps: routed,
    distinctModels,
    multiModel,
    complex,
    singleModelAntiPattern: complex && !multiModel,
    reason: multiModel
      ? `Routed ${routed.length} steps across ${distinctModels.length} models (accuracy/efficiency/control).`
      : complex
        ? 'Complex plan still on one model — evaluate pool coverage or step labels.'
        : `Single-model OK for simple ${routed.length}-step plan.`,
  };
}

/**
 * Evaluate a routing algorithm vs a single-model baseline (Switchyard "evaluate").
 * Pure metrics helper — no network.
 */
function evaluateRoutingAlgorithm(options = {}) {
  const baseline = options.baseline || {};
  const candidate = options.candidate || {};
  const baselineCost = Number(baseline.costUsd);
  const candidateCost = Number(candidate.costUsd);
  const baselineQuality = Number(baseline.qualityScore);
  const candidateQuality = Number(candidate.qualityScore);
  const baselineLatency = Number(baseline.latencyMs);
  const candidateLatency = Number(candidate.latencyMs);

  const hasCost = Number.isFinite(baselineCost) && Number.isFinite(candidateCost);
  const hasQuality = Number.isFinite(baselineQuality) && Number.isFinite(candidateQuality);
  const hasLatency = Number.isFinite(baselineLatency) && Number.isFinite(candidateLatency);

  if (!hasCost || !hasQuality) {
    return {
      pass: false,
      action: 'block',
      reason: 'Routing evaluation requires baseline and candidate costUsd + qualityScore evidence.',
      deltas: null,
    };
  }

  const costDeltaUsd = baselineCost - candidateCost;
  const costSavingsPercent = baselineCost > 0
    ? Number(((costDeltaUsd / baselineCost) * 100).toFixed(1))
    : 0;
  const qualityDelta = candidateQuality - baselineQuality;
  const latencyDeltaMs = hasLatency ? candidateLatency - baselineLatency : null;

  // Fail closed if quality drops more than allowed while claiming savings.
  const maxQualityDrop = Number.isFinite(Number(options.maxQualityDrop))
    ? Number(options.maxQualityDrop)
    : 0.05;
  const minSavingsPercent = Number.isFinite(Number(options.minSavingsPercent))
    ? Number(options.minSavingsPercent)
    : 10;

  let pass = true;
  const failures = [];
  if (qualityDelta < -maxQualityDrop) {
    pass = false;
    failures.push(`quality drop ${qualityDelta.toFixed(3)} exceeds max ${maxQualityDrop}`);
  }
  if (costSavingsPercent < minSavingsPercent && options.requireSavings !== false) {
    pass = false;
    failures.push(`cost savings ${costSavingsPercent}% below min ${minSavingsPercent}%`);
  }

  return {
    pass,
    action: pass ? 'allow' : 'block',
    reason: pass
      ? `Routing beats baseline: ${costSavingsPercent}% cheaper, quality Δ ${qualityDelta.toFixed(3)}.`
      : `Routing evidence failed: ${failures.join('; ')}.`,
    deltas: {
      costDeltaUsd: Number(costDeltaUsd.toFixed(4)),
      costSavingsPercent,
      qualityDelta: Number(qualityDelta.toFixed(4)),
      latencyDeltaMs,
    },
    failures,
  };
}

/**
 * Build default always-on agent step skeleton (intent → gate → act → review).
 */
function buildAlwaysOnAgentPlan(options = {}) {
  const sensitive = Boolean(options.sensitive);
  return [
    { id: 'intent', type: 'intent-classify', tags: ['always-on', 'intent'] },
    { id: 'gate', type: 'pretool-gate', tags: ['gate', 'pretool'] },
    {
      id: 'act',
      type: options.actType || 'coding-implement',
      tags: options.highVolume ? ['coding', 'high-volume'] : ['coding'],
      riskLevel: options.riskLevel || 'medium',
      highOutput: Boolean(options.highVolume),
    },
    {
      id: 'review',
      type: 'quality-review',
      tags: ['review', 'reasoning'],
      riskLevel: options.riskLevel || 'medium',
      sensitive,
    },
  ];
}

function describeNemotronLightning() {
  return {
    id: 'nvidia/nemotron-3.5-lightning',
    name: 'NVIDIA Nemotron 3.5 Lightning',
    totalParamsB: 30,
    activeParamsB: 3,
    architecture: 'MoE',
    open: true,
    useCases: [
      'always-on agent specialized steps',
      'intent / classify / gate decisions',
      'cheap routing algorithm evaluator companion',
    ],
    companion: 'NeMo Switchyard (multi-model step routing + evaluation)',
  };
}
const DEVIN_FUSION_SOURCE_URL = 'https://cognition.com/blog/devin-fusion';
const DEVIN_FUSION_GATE_ID = 'devin-fusion-sidekick-compaction-switch';

const DEVIN_FUSION_RAIL_MAP = Object.freeze([
  {
    devinFusionConcept: 'Parallel Frontier Main + Sidekick agents with independent persistent cached contexts (avoids Smart Friend / Advisor tool cache misses; 60% lower cost at 63.1 FrontierCode)',
    thumbgateRail: 'evaluateDualCacheAndCompactionSwitch (parallel_dual_cache with 300s cache-TTL guard; rejects uncached advisor-tool cross-calls)',
  },
  {
    devinFusionConcept: 'Main agent takes minimal actions (plan, ambiguity, final review) and delegates slow Playwright/e2e test runs (-62% cost), mechanical deprecations (-32%), and upstream reuse (-25%)',
    thumbgateRail: 'evaluateDevinFusionSidekickSplit (delegates mechanical/test-suite work to Sidekick; blocks delegation when judgmentIsDeliverable=true)',
  },
  {
    devinFusionConcept: 'Dynamic mid-session model switching coupled to context compaction boundaries ("model switching for free" with zero extra cache-miss penalty)',
    thumbgateRail: 'evaluateDualCacheAndCompactionSwitch (switchTriggeredAtCompaction=true -> extraCacheMissPenalty=0)',
  },
]);

/**
 * Decide whether a sub-task belongs on the Frontier Main Agent or the Sidekick Agent.
 * Delegating when judgment IS the deliverable backfires (e.g. 54 -> 27 on FrontierCode);
 * delegating slow test suites (-62%), mechanical deprecations (-32%), or upstream reuse (-25%)
 * saves cost at equal or higher quality.
 */
function evaluateDevinFusionSidekickSplit({
  taskType = 'implementation',
  judgmentIsDeliverable = false,
  ambiguityScore = 0.2,
  slowVerificationSuite = false,
  mechanicalMultiFile = false,
  reuseUpstreamPattern = false,
} = {}) {
  const highAmbiguity = Number(ambiguityScore) >= 0.6;
  if (judgmentIsDeliverable || highAmbiguity) {
    return {
      assignedTo: 'frontier_main',
      delegationAllowed: false,
      reason: 'judgment_or_ambiguity_is_the_deliverable_keep_on_main',
      expectedCostSavingsPercent: 0,
    };
  }

  if (slowVerificationSuite) {
    return {
      assignedTo: 'sidekick',
      delegationAllowed: true,
      reason: 'slow_test_or_e2e_verification_suite',
      expectedCostSavingsPercent: 62,
    };
  }
  if (mechanicalMultiFile) {
    return {
      assignedTo: 'sidekick',
      delegationAllowed: true,
      reason: 'mechanical_multi_file_deprecation_or_refactor',
      expectedCostSavingsPercent: 32,
    };
  }
  if (reuseUpstreamPattern) {
    return {
      assignedTo: 'sidekick',
      delegationAllowed: true,
      reason: 'mechanical_upstream_pattern_reuse',
      expectedCostSavingsPercent: 25,
    };
  }

  return {
    assignedTo: String(taskType).toLowerCase() === 'review' || String(taskType).toLowerCase() === 'plan'
      ? 'frontier_main'
      : 'sidekick',
    delegationAllowed: String(taskType).toLowerCase() !== 'review' && String(taskType).toLowerCase() !== 'plan',
    reason: 'standard_main_plans_sidekick_executes',
    expectedCostSavingsPercent: 38,
  };
}

/**
 * Audit dual-cache persistence (5-minute TTL) and compaction-boundary model switching.
 */
function evaluateDualCacheAndCompactionSwitch({
  pattern = 'parallel_dual_cache',
  idleSeconds = 120,
  cacheTtlSeconds = 300,
  midSessionModelSwitch = false,
  switchTriggeredAtCompaction = true,
} = {}) {
  const isAdvisorAntiPattern = /smart_friend|advisor_tool/i.test(String(pattern || ''));
  const cacheWarm = !isAdvisorAntiPattern && Number(idleSeconds) <= Number(cacheTtlSeconds);
  const extraCacheMissPenalty = !midSessionModelSwitch
    ? 0
    : (switchTriggeredAtCompaction ? 0 : 1);

  return {
    pattern,
    cacheWarm,
    cacheExpiredByTtl: Number(idleSeconds) > Number(cacheTtlSeconds),
    isAdvisorAntiPattern,
    midSessionModelSwitch: Boolean(midSessionModelSwitch),
    switchTriggeredAtCompaction: Boolean(switchTriggeredAtCompaction),
    extraCacheMissPenalty,
    freeCompactionSwitch: Boolean(midSessionModelSwitch && switchTriggeredAtCompaction),
  };
}

function buildDevinFusionHonestyReport(options = {}) {
  const findings = [];
  const claim = String(options.claim || '').trim();
  if (/\bdelegate\s+ambiguous\s+judgment\s+to\s+sidekick\b/i.test(claim)) {
    findings.push({
      id: 'delegating-judgment-backfires',
      severity: 'fail',
      gateId: DEVIN_FUSION_GATE_ID,
      message: 'When product/UX judgment is the deliverable, delegating coding to the sidekick loses subtle intent (54 -> 27 on FrontierCode); keep judgment on the frontier main agent.',
    });
  }
  if (/\bswitch\s+models\s+every\s+turn\s+without\s+compaction\b/i.test(claim)) {
    findings.push({
      id: 'uncompacted-switch-cache-miss',
      severity: 'fail',
      gateId: DEVIN_FUSION_GATE_ID,
      message: 'Couple mid-session model switches to context compaction boundaries to avoid extra KV-cache miss penalties.',
    });
  }

  return {
    ok: findings.length === 0,
    status: findings.length === 0 ? 'ready' : 'fail',
    sourceUrl: DEVIN_FUSION_SOURCE_URL,
    gateId: DEVIN_FUSION_GATE_ID,
    railMap: DEVIN_FUSION_RAIL_MAP,
    findings,
  };
}

function runCli(argv = process.argv.slice(2)) {
  const args = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, ...rest] = a.slice(2).split('=');
    args[k] = rest.length ? rest.join('=') : true;
  }
  const report = buildDevinFusionHonestyReport(args);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.ok ? 0 : 1;
}

module.exports = {
  DEFAULT_POOL,
  STEP_ROLE_HINTS,
  normalizeStep,
  inferStepRole,
  pickModelForStep,
  routeAgentSteps,
  evaluateRoutingAlgorithm,
  buildAlwaysOnAgentPlan,
  describeNemotronLightning,
  DEVIN_FUSION_SOURCE_URL,
  DEVIN_FUSION_GATE_ID,
  DEVIN_FUSION_RAIL_MAP,
  evaluateDevinFusionSidekickSplit,
  evaluateDualCacheAndCompactionSwitch,
  buildDevinFusionHonestyReport,
  runCli,
};
