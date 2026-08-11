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
};
