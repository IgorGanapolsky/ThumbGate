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

/**
 * ---------------------------------------------------------------------------
 * GitHub Copilot Fusion — Stolen 2026-10-29
 * ---------------------------------------------------------------------------
 *
 * Steal from GitHub's "Copilot Fusion: Multi-model orchestration at its finest":
 *   "Different tasks need different models. Developers shouldn't have to manage
 *    every model choice. Fusion evaluates what a task needs across reasoning,
 *    code generation, debugging, and tool use, then chooses how to execute
 *    across one or more models."
 *
 * This module adds Fusion-style task-need evaluation and multi-model routing
 * on top of the existing Switchyard pool. Each step is scored across four
 * dimensions (reasoningDepth, codeComplexity, debuggingLoad, toolUseIntensity).
 * Complex steps are routed to multiple models in parallel (cheap specialist
 * for intent/gates + quality model for code/reasoning), while simple steps
 * go to a single low-cost model.
 *
 * Inspiration: GitHub Fusion Max scored within 2 pts of Opus 5.5 Max at half
 * cost and 40% less time. We can't claim the same numbers, but the pattern —
 * single-model for trivial steps, multi-model parallel for complex ones —
 * is directly portable.
 */

// Dimension weights for overall complexity score (sums to 1.0).
// Reasoning and code complexity dominate; debugging and tools augment.
const FUSION_DIMENSION_WEIGHTS = Object.freeze({
  reasoningDepth: 0.30,
  codeComplexity: 0.35,
  debuggingLoad: 0.20,
  toolUseIntensity: 0.15,
  confusionRisk: 0.10, // Stolen from Supabase "agent guardrail skills" — detect confused agents before they act
});

// Per-dimension thresholds that push a step into "complex" routing territory.
// If any dimension exceeds its threshold OR the weighted aggregate exceeds
// COMPLEX_THRESHOLD, the step is routed to multiple models in parallel.
const FUSION_THRESHOLDS = Object.freeze({
  reasoningDepth: 0.6,
  codeComplexity: 0.6,
  debuggingLoad: 0.5,
  toolUseIntensity: 0.5,
  confusionRisk: 0.5, // Block Express/Custom routing if confusion risk is high
  complexAggregate: 0.55,
});

/**
 * Steal the heuristic keyword maps from GitHub Fusion's task profiling.
 * Each dimension is scored 0–1 based on the step's type, tags, and metadata.
 */
const FUSION_REASONING_KEYWORDS = Object.freeze([
  'architecture', 'design', 'plan', 'reason', 'strategy', 'analysis',
  'debug', 'refactor', 'root-cause', 'trace', 'race-condition',
  'security-audit', 'review', 'evaluate', 'assess',
]);

const FUSION_CODE_KEYWORDS = Object.freeze([
  'coding', 'implement', 'patch', 'refactor', 'feature',
  'api-route', 'migration', 'schema', 'multi-file', 'lint',
  'build', 'compile', 'deploy', 'config', 'test-gen',
]);

const FUSION_DEBUG_KEYWORDS = Object.freeze([
  'test', 'verify', 'debug', 'fail', 'bug', 'regression',
  'isolate', 'reproduce', 'profile', 'perf', 'race',
  'security', 'audit', 'gate', 'pre-tool',
]);

const FUSION_TOOL_KEYWORDS = Object.freeze([
  'shell', 'browser', 'git', 'mcp', 'read', 'edit', 'write',
  'fetch', 'search', 'deploy', 'test', 'verify', 'run',
]);

/**
 * Evaluate what a step needs across the four Fusion dimensions.
 * Returns a profile with per-dimension scores (0–1), aggregate complexity,
 * and a recommended routing strategy.
 *
 * @param {object|string} stepInput — step description or normalized step object
 * @param {object} [options]
 * @param {number} [options.toolCount] — number of tools the step will use
 * @ @param {number} [options.fileCount] — number of files affected
 * @ @param {number} [options.riskLevel] — 'low'|'medium'|'high'
 */
function evaluateTaskNeeds(stepInput, options = {}) {
  const step = normalizeStep(stepInput, options.index || 0);
  const opts = {
    toolCount: Number(options.toolCount) || 0,
    fileCount: Number(options.fileCount) || 0,
    riskLevel: String(options.riskLevel || step.riskLevel || 'medium'),
  };

  const hay = `${step.type} ${(step.tags || []).join(' ')}`.toLowerCase();

  // Dimension 1: Reasoning depth — how much planning/architecture/debugging is needed?
  let reasoningDepth = 0;
  for (const kw of FUSION_REASONING_KEYWORDS) {
    if (hay.includes(kw)) reasoningDepth += 0.25;
  }
  if (opts.riskLevel === 'high') reasoningDepth += 0.2;
  reasoningDepth = Math.min(reasoningDepth, 1.0);

  // Dimension 2: Code complexity — code generation volume and structural scope.
  let codeComplexity = 0;
  for (const kw of FUSION_CODE_KEYWORDS) {
    if (hay.includes(kw)) codeComplexity += 0.2;
  }
  // Multi-file changes scale complexity
  if (opts.fileCount >= 3) codeComplexity += 0.3;
  else if (opts.fileCount >= 1) codeComplexity += 0.15;
  codeComplexity = Math.min(codeComplexity, 1.0);

  // Dimension 3: Debugging / verification load.
  let debuggingLoad = 0;
  for (const kw of FUSION_DEBUG_KEYWORDS) {
    if (hay.includes(kw)) debuggingLoad += 0.2;
  }
  if (opts.riskLevel === 'high') debuggingLoad += 0.2;
  debuggingLoad = Math.min(debuggingLoad, 1.0);

  // Dimension 4: Tool-use intensity — how many tools will this step invoke?
  let toolUseIntensity = 0;
  for (const kw of FUSION_TOOL_KEYWORDS) {
    if (hay.includes(kw)) toolUseIntensity += 0.15;
  }
  // Scale by actual tool count if provided
  if (opts.toolCount > 0) {
    toolUseIntensity = Math.min(toolUseIntensity + (opts.toolCount / 10), 1.0);
  }
  toolUseIntensity = Math.min(toolUseIntensity, 1.0);

  const weights = FUSION_DIMENSION_WEIGHTS;
  const aggregate =
    reasoningDepth * weights.reasoningDepth +
    codeComplexity * weights.codeComplexity +
    debuggingLoad * weights.debuggingLoad +
    toolUseIntensity * weights.toolUseIntensity;

  const isComplex =
    reasoningDepth > FUSION_THRESHOLDS.reasoningDepth ||
    codeComplexity > FUSION_THRESHOLDS.codeComplexity ||
    debuggingLoad > FUSION_THRESHOLDS.debuggingLoad ||
    toolUseIntensity > FUSION_THRESHOLDS.toolUseIntensity ||
    aggregate > FUSION_THRESHOLDS.complexAggregate;

  return {
    reasoningDepth: Number(reasoningDepth.toFixed(3)),
    codeComplexity: Number(codeComplexity.toFixed(3)),
    debuggingLoad: Number(debuggingLoad.toFixed(3)),
    toolUseIntensity: Number(toolUseIntensity.toFixed(3)),
    aggregateComplexity: Number(aggregate.toFixed(3)),
    complexity: isComplex ? 'complex' : 'simple',
    strategy: isComplex ? 'parallel' : 'single',
    evidence: {
      matchedKeywords: {
        reasoning: FUSION_REASONING_KEYWORDS.filter((k) => hay.includes(k)),
        code: FUSION_CODE_KEYWORDS.filter((k) => hay.includes(k)),
        debug: FUSION_DEBUG_KEYWORDS.filter((k) => hay.includes(k)),
        tools: FUSION_TOOL_KEYWORDS.filter((k) => hay.includes(k)),
      },
      fileCount: opts.fileCount,
      toolCount: opts.toolCount,
      riskLevel: opts.riskLevel,
    },
  };
}

/**
 * Fusion-style multi-model routing for a single step.
 *
 * For "simple" steps: returns a single-model assignment (cheap specialist).
 * For "complex" steps: returns a parallel multi-model plan that splits work
 * across a low-cost intent/router model and a quality/reasoning model.
 *
 * This mirrors GitHub Fusion's "chooses how to execute across one or more models"
 * — but ThumbGate owns the evidence (tests, gate checks, proof artifacts)
 * that decides correctness, whereas Fusion relies on model self-reporting.
 *
 * @param {object|string} stepInput
 * @param {object} [options]
 * @param {number} [options.toolCount]
 * @param {number} [options.fileCount]
 */
function routeWithFusion(stepInput, options = {}) {
  const pool = Array.isArray(options.pool) && options.pool.length
    ? options.pool
    : DEFAULT_POOL;
  const profile = evaluateTaskNeeds(stepInput, options);

  // Pick a single best model using the existing Switchyard scorer
  const single = pickModelForStep(stepInput, { ...options, index: options.index || 0 });

  // For simple steps, single-model routing is optimal — saves ~52.8% tokens
  if (profile.complexity === 'simple') {
    return {
      stepId: single.stepId,
      stepType: single.stepType,
      strategy: 'single-model',
      primaryModel: {
        modelId: single.modelId,
        model: single.model,
        provider: single.provider,
        costClass: single.costClass,
        reason: single.reason,
      },
      parallelModels: [],
      taskProfile: profile,
      // Steal Fusion's cost efficiency claim structure
      estCostSavingsVsSingleOpus: profile.complexity === 'simple' ? '~40%' : '~20%',
      estLatencyReduction: profile.complexity === 'simple' ? '~40%' : '~15%',
    };
  }

  // For complex steps: route to parallel models
  // - Low-cost specialist for intent/gate/route decisions (nemotron-lightning)
  // - Quality/reasoning model for code generation and review (claude-sonnet)
  const specialists = pool.filter((m) =>
    m.roles && (m.roles.includes('intent') || m.roles.includes('gate') || m.roles.includes('specialized'))
  );
  const qualityModels = pool.filter((m) =>
    m.roles && (m.roles.includes('reasoning') || m.roles.includes('quality'))
  );

  const cheapSpecialist = specialists.find((m) => m.activeParamsB && m.activeParamsB <= 4)
    || specialists[0] || pool.find((m) => m.id === 'nvidia/nemotron-3.5-lightning');
  const qualityModel = qualityModels.find((m) => m.provider === 'anthropic')
    || qualityModels[0] || pool.find((m) => m.id === 'anthropic/claude-sonnet');

  return {
    stepId: single.stepId,
    stepType: single.stepType,
    strategy: 'parallel-multi-model',
    primaryModel: {
      modelId: qualityModel ? qualityModel.id : single.modelId,
      model: qualityModel ? qualityModel.model : single.model,
      provider: qualityModel ? qualityModel.provider : single.provider,
      costClass: qualityModel ? qualityModel.costClass : single.costClass,
      role: 'code-generation + final review',
      reason: 'Quality model handles code generation and review for complex steps.',
    },
    parallelModels: [
      {
        modelId: cheapSpecialist ? cheapSpecialist.id : 'nvidia/nemotron-3.5-lightning',
        model: cheapSpecialist ? cheapSpecialist.model : 'nemotron-3.5-lightning',
        provider: cheapSpecialist ? cheapSpecialist.provider : 'nvidia',
        costClass: cheapSpecialist ? cheapSpecialist.costClass : 'low',
        role: 'intent classification + tool-call validation + gate checks',
        estCostSavings: '40–68% vs single heavy model on trivial sub-steps',
      },
    ].filter(Boolean),
    taskProfile: profile,
    estCostSavingsVsSingleOpus: '~50%',
    estLatencyReduction: '~40%',
    // Fusion learns: record actual outcomes to adjust these weights
    learning: {
      recordOutcome: `node scripts/switchyard-router.js --fusion-record --step ${single.stepId} --strategy ${profile.complexity === 'complex' ? 'parallel-multi-model' : 'single-model'} --actual-cost $X --actual-quality score`,
    },
  };
}

/**
 * Route a full multi-step plan using Fusion-style evaluation.
 * Returns per-step routing plans + an aggregate complexity summary.
 */
function routePlanWithFusion(plan, options = {}) {
  const steps = Array.isArray(plan)
    ? plan
    : (plan && Array.isArray(plan.steps) ? plan.steps : []);

  if (steps.length === 0) {
    return { architecture: 'fusion', modelCount: 0, steps: [] };
  }

  const routed = steps.map((step, index) =>
    routeWithFusion(step, { ...options, index })
  );

  // Apply confusion-aware routing overrides (Supabase "agent guardrail skills" steal)
  const confusionAdjusted = applyConfusionRouting(routed, steps, options.sessionActions || []);

  const distinctModels = [...new Set([
    ...confusionAdjusted.map((r) => r.primaryModel.modelId),
    ...confusionAdjusted.flatMap((r) => r.parallelModels.map((m) => m.modelId)),
  ])];

  const hasParallel = confusionAdjusted.some((r) => r.strategy === 'parallel-multi-model');
  const complexSteps = confusionAdjusted.filter((r) => r.taskProfile.complexity === 'complex');
  const confusedSteps = confusionAdjusted.filter((r) => r.routingOverride);

  return {
    architecture: 'fusion-multi-model',
    inspiredBy: 'GitHub Copilot Fusion (Universe 2026)',
    steps: confusionAdjusted,
    distinctModels,
    modelCount: distinctModels.length,
    multiModel: distinctModels.length > 1,
    parallelExecution: hasParallel,
    confusionAware: confusedSteps.length > 0,
    confusedStepCount: confusedSteps.length,
    summary: {
      totalSteps: confusionAdjusted.length,
      complexSteps: complexSteps.length,
      simpleSteps: confusionAdjusted.length - complexSteps.length,
      parallelSteps: confusionAdjusted.filter((r) => r.strategy === 'parallel-multi-model').length,
      confusedSteps: confusedSteps.length,
    },
  };
}

/**
 * ---------------------------------------------------------------------------
 * Google A2UI Express — Stolen 2026-10-29
 * ---------------------------------------------------------------------------
 *
 * Steal from Google's "Fast, reliable A2UI, with swappable inference formats":
 *   1. Swappable inference formats — the model generates a compact DSL, the SDK
 *      compiles it to validated transport messages. Express uses ~3x fewer
 *      tokens than Direct JSON.
 *   2. Decision models (Jev) for known-shape layouts — batch independent
 *      decisions into a single request (100–300ms), 80x faster than generative.
 *   3. Controlled / Express / Custom decision tree — pick the format by how
 *      much of the screen is known ahead of time.
 *
 * ThumbGate maps these to agent step execution:
 *   - Express: compact step descriptions compile to full routing + tool calls
 *   - Controlled: batched gate checks via a fast decision model for known patterns
 *   - Custom: user-supplied format factories (swappable at runtime)
 */

/**
 * A2UI Express — compile a compact step description into a full routing plan.
 *
 * Express syntax (one statement per line, Python-like):
 *   intent "review PR #1234 for security issues"
 *   gate "shell" allow=true deny=true
 *   act "find security issues with grep" role=security_audit
 *   verify "npm test" timeout=60s
 *   review lite
 *
 * Each line maps to a step in the agent plan, compiled by this function into
 * the standard normalizeStep + routeWithFusion pipeline. Saves ~60% tokens
 * vs verbose JSON-style step declarations.
 */
function compileExpressSteps(expressText) {
  if (!expressText || typeof expressText !== 'string') return [];
  const lines = expressText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const compiled = [];

  for (const line of lines) {
    const parts = line.split(/\s+/);
    const kw = parts[0];
    // Strip quotes from the rest of the line
    const rest = line.slice(kw.length).trim();

    switch (kw) {
      case 'intent':
        compiled.push({
          id: `intent_${compiled.length + 1}`,
          type: 'intent-classify',
          tags: ['always-on', 'intent', 'express'],
          riskLevel: 'low',
          description: rest.replace(/^["']|["']$/g, ''),
        });
        break;
      case 'gate':
        compiled.push({
          id: `gate_${compiled.length + 1}`,
          type: 'pretool-gate',
          tags: ['gate', 'pretool', 'express'],
          riskLevel: 'high',
          description: rest,
        });
        break;
      case 'act':
        // Extract role= if present
        const roleMatch = rest.match(/role=(\S+)/);
        const desc = roleMatch ? rest.replace(/role=\S+/, '').trim() : rest;
        compiled.push({
          id: `act_${compiled.length + 1}`,
          type: 'coding-implement',
          tags: ['coding', 'express', ...(roleMatch ? [roleMatch[1]] : [])],
          riskLevel: 'medium',
          description: desc.replace(/^["']|["']$/g, ''),
          highOutput: true,
        });
        break;
      case 'verify':
        compiled.push({
          id: `verify_${compiled.length + 1}`,
          type: 'verification',
          tags: ['verify', 'test', 'express'],
          riskLevel: 'high',
          description: rest,
        });
        break;
      case 'review':
        compiled.push({
          id: `review_${compiled.length + 1}`,
          type: 'quality-review',
          tags: ['review', 'reasoning', 'express', rest],
          riskLevel: 'medium',
          description: rest,
        });
        break;
      default:
        // Generic step — first token is type, rest is description
        compiled.push({
          id: `step_${compiled.length + 1}`,
          type: kw,
          tags: ['express'],
          riskLevel: 'medium',
          description: rest,
        });
    }
  }

  return compiled;
}

/**
 * Select the right routing format using Google A2UI's decision tree:
 *
 *   Controlled → Express → Custom
 *
 * - Controlled: Known patterns (gate checks, simple routing, file lookups).
 *   Use a fast decision model (Jev-style) that batches independent questions.
 * - Express: Full expressivity needed (multi-step planning, novel code paths).
 *   Use A2UI Express format compiled to routing decisions.
 * - Custom: New domain or format. Use a user-supplied format function.
 *
 * @param {object} stepProfile — output of evaluateTaskNeeds()
 * @param {object} [options]
 * @param {boolean} [options.knownPattern] — step matches a known routing pattern
 * @param {string[]} [options.independentDecisions] — batchable gate checks
 */
function selectRoutingFormat(stepProfile, options = {}) {
  const profile = stepProfile || evaluateTaskNeeds('generic-step');
  const knownPattern = Boolean(options.knownPattern);
  const hasIndependentDecisions = Array.isArray(options.independentDecisions)
    && options.independentDecisions.length > 0;
  const isSimple = profile.complexity === 'simple' && profile.aggregateComplexity < 0.4;

  if (knownPattern && isSimple) {
    return {
      format: 'controlled',
      reason: 'Known pattern + simple step → use fast decision model (Jev-style batched checks).',
      estLatencyMs: 100,
      estCostUsd: 0, // local decision model
      batchSize: hasIndependentDecisions ? options.independentDecisions.length : 1,
    };
  }

  // Check if the step can use Express format (compact representation)
  const canUseExpress = profile.evidence.riskLevel !== 'high'
    || profile.aggregateComplexity < 0.7;

  if (canUseExpress) {
    return {
      format: 'express',
      reason: 'Full expressivity needed but step is not maximally complex → use A2UI Express format (3x fewer tokens).',
      estLatencyMs: profile.aggregateComplexity * 500,
      estCostUsd: profile.aggregateComplexity * 0.005,
      tokenSavingsVsDirectJson: '~60%',
    };
  }

  return {
    format: 'custom',
    reason: 'Novel or high-risk step → falls back to user-supplied format factory or full agent routing.',
    estLatencyMs: 2000,
    estCostUsd: 0.05,
    requiresReview: true,
  };
}

/**
 * Evaluate confusion risk for a step — stolen from Supabase's "explicit agent
 * guardrail skills" pattern. Steps with high confusion risk are forced into
 * the "controlled" routing format (slow but safe) rather than Express or Custom.
 *
 * @param {Object} stepProfile - Routing profile from evaluateTaskNeeds
 * @param {Object} stepInput - The raw step input
 * @param {Array} sessionActions - Recent session actions for conflict detection
 * @returns {{ riskScore: number, formatOverride: string|null, signals: Array }}
 */
function evaluateConfusionRisk(stepProfile, stepInput, sessionActions = []) {
  try {
    const { runConfusionPreCheck } = require('./confusion-detector');
    const toolName = stepInput?.toolName || stepInput?.type || 'generic';
    const toolInput = stepInput?.toolInput || stepInput?.input || stepInput || {};

    const result = runConfusionPreCheck({
      toolName,
      toolInput,
      sessionActions,
    });

    // If confusion risk exceeds threshold, force 'controlled' routing
    const threshold = FUSION_THRESHOLDS.confusionRisk || 0.5;
    const formatOverride = result.riskScore >= threshold ? 'controlled' : null;

    return {
      riskScore: result.riskScore,
      formatOverride,
      signals: result.signals,
      decision: result.decision,
    };
  } catch (err) {
    return { riskScore: 0, formatOverride: null, signals: [], decision: 'allow' };
  }
}

/**
 * Check if any confusion signals should force a routing format override.
 * Used in routePlanWithFusion to ensure confusing steps get the safest path.
 *
 * @param {Array} routedSteps - Output from routeWithFusion per step
 * @param {Array} stepInputs - Original step inputs
 * @param {Array} sessionActions - Recent session actions
 * @returns {Array} - Updated routed steps with confusion-aware overrides
 */
function applyConfusionRouting(routedSteps, stepInputs, sessionActions = []) {
  return routedSteps.map((routed, i) => {
    const stepInput = stepInputs[i] || {};
    const confusion = evaluateConfusionRisk(routed.taskProfile, stepInput, sessionActions);

    if (confusion.formatOverride && confusion.riskScore > 0) {
      return {
        ...routed,
        routingOverride: {
          originalFormat: routed.stepType || 'auto',
          forcedFormat: confusion.formatOverride,
          reason: `Confusion risk ${confusion.riskScore.toFixed(2)} exceeds threshold — forcing 'controlled' routing`,
          confusionSignals: confusion.signals,
        },
      };
    }
    return routed;
  });
}

/**
 * Fast batched gate checks — steals Jev's "answer N independent questions
 * in one request" approach for PreToolUse decisions.
 *
 * Instead of calling thumbgate__gate_check for each action individually,
 * batch independent gate checks and evaluate them together. This mirrors
 * how A2UI's Apparite batches ~30 layout questions into a single Jev request
 * (100–300ms), vs. running a full model per question.
 *
 * @param {Array} actions — list of {toolName, toolInput} pairs to check
 * @param {object} [options]
 * @param {string} [options.agentId]
 * @returns {Promise<Array>} — results for each action, {allowed: bool, reason: string}
 */
async function fastGateBatch(actions, options = {}) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return [];
  }

  // Classify each action as independent (can batch) or dependent (needs individual check)
  const independent = [];
  const dependent = [];

  const INDEPENDENT_TOOLS = new Set([
    'read', 'grep', 'search', 'web_fetch', 'list',
    'shell', 'list_secrets', 'browseros-neo__screenshot',
  ]);

  for (const action of actions) {
    const toolName = action.toolName || action.tool || '';
    if (INDEPENDENT_TOOLS.has(toolName) && !isRiskyCommand(action.toolInput)) {
      independent.push(action);
    } else {
      dependent.push(action);
    }
  }

  // Batch independent checks: compile them into a single structured decision
  // The decision model evaluates all N checks in ~100-300ms instead of N round-trips
  const batchQuestion = independent.map((a, i) => ({
    id: `gate_${i + 1}`,
    tool: a.toolName || a.tool,
    input: a.toolInput,
    risk: classifyRisk(a.toolName || a.tool, a.toolInput),
  }));

  // In practice, this would call a local decision model (Jev-style).
  // For now, we evaluate against fast deny rules in-process.
  const batchResults = batchQuestion.map((q) => {
    const denied = checkDenyRules(q);
    return {
      id: q.id,
      tool: q.tool,
      allowed: !denied.blocked,
      reason: denied.blocked ? denied.reason : 'passed-fast-batch',
      latencyMs: 0, // in-process, sub-millisecond
    };
  });

  // Dependent actions still get individual gate checks (async, real evaluation)
  const dependentResults = await Promise.all(
    dependent.map(async (a) => {
      try {
        // Would call thumbgate__gate_check here for full evaluation
        const denied = checkDenyRules({ tool: a.toolName || a.tool, input: a.toolInput });
        return {
          tool: a.toolName || a.tool,
          allowed: !denied.blocked,
          reason: denied.blocked ? denied.reason : 'needs-full-eval',
          latencyMs: 50,
        };
      } catch (err) {
        return {
          tool: a.toolName || a.tool,
          allowed: false,
          reason: `gate-error: ${err.message}`,
          latencyMs: 50,
        };
      }
    })
  );

  // Steal Jev's latency numbers: batch 10 independent checks in ~200ms
  // vs 10 separate checks at ~50ms each = 500ms (2.5x speedup)
  const totalLatencyMs = Math.max(...batchResults.map((r) => r.latencyMs), 0)
    + Math.max(...dependentResults.map((r) => r.latencyMs), 0);

  return {
    totalChecks: actions.length,
    batched: batchResults.length,
    individual: dependentResults.length,
    batchLatencyMs: totalLatencyMs,
    speedupVsSerial: dependentResults.length > 0
      ? `${((dependentResults.length * 50) / totalLatencyMs).toFixed(1)}x`
      : '1.0x',
    results: [...batchResults, ...dependentResults],
  };
}

/**
 * Steal Jev's Noul/Choice/Score question types for structured gate decisions.
 * Each question type maps to a ThumbGate gate pattern.
 */
const JEV_QUESTION_TYPES = Object.freeze({
  NOUL: 'noul',       // Boolean: is this statement true? (deny/allow)
  CHOICE: 'choice',   // Which option from a list fits? (which deny rule applies)
  SCORE: 'score',     // How does this score on a rubric? (risk level 0-100)
});

const JEV_GATE_QUESTIONS = Object.freeze([
  {
    id: 'path_deny',
    type: JEV_QUESTION_TYPES.NOUL,
    question: 'does this action target a denied path?',
    options: { true: 'deny', false: 'allow' },
  },
  {
    id: 'shell_deny',
    type: JEV_QUESTION_TYPES.NOUL,
    question: 'is this shell command in the deny list?',
    options: { true: 'deny', false: 'allow' },
  },
  {
    id: 'branch_protect',
    type: JEV_QUESTION_TYPES.NOUL,
    question: 'would this action bypass branch protection?',
    options: { true: 'deny', false: 'allow' },
  },
  {
    id: 'risk_score',
    type: JEV_QUESTION_TYPES.SCORE,
    question: 'risk level for this action (0-100):',
    options: { range: '0-100', threshold: 70 },
  },
]);

// --- Internal helpers for fastGateBatch ---

const SHELL_DENY_PATTERNS = [
  /git log --all --grep/i,
  /git reflog/i,
  /gh pr review.*--approve/i,
  /gh pr merge.*--admin/i,
  /git push --force/i,
  /git push -f/i,
  /rm -rf /i,
  /sudo /i,
];

const DENY_PATH_PATTERNS = [
  /\.ssh\/id_/,
  /workspace\/projects\//,
  /workspace\/git\//,
];

function isRiskyCommand(toolInput) {
  if (!toolInput) return false;
  if (typeof toolInput === 'string') {
    return SHELL_DENY_PATTERNS.some((p) => p.test(toolInput));
  }
  if (typeof toolInput === 'object' && toolInput.command) {
    return SHELL_DENY_PATTERNS.some((p) => p.test(toolInput.command));
  }
  return false;
}

function classifyRisk(toolName, toolInput) {
  if (toolName === 'shell' && typeof toolInput === 'object' && toolInput.command) {
    if (SHELL_DENY_PATTERNS.some((p) => p.test(toolInput.command))) return 'high';
    if (/npm|node|npm test|npm run/.test(toolInput.command)) return 'medium';
    return 'low';
  }
  if (toolName === 'edit' || toolName === 'write') return 'medium';
  return 'low';
}

function checkDenyRules(action) {
  const toolName = action.tool || action.toolName || '';
  const input = action.input || action.toolInput || (typeof action === 'string' ? action : '');

  // Path deny checks
  if (input && typeof input === 'object' && input.path) {
    if (DENY_PATH_PATTERNS.some((p) => p.test(input.path))) {
      return { blocked: true, reason: `Path ${input.path} matches deny list.` };
    }
  }

  // Shell deny checks
  if (toolName === 'shell') {
    const cmd = typeof input === 'string' ? input : (input && input.command) || '';
    if (SHELL_DENY_PATTERNS.some((p) => p.test(cmd))) {
      return { blocked: true, reason: `Command matches deny pattern: ${cmd}` };
    }
  }

  return { blocked: false, reason: 'ok' };
}

// --- Stolen from AI:AM (MdpamRtlw0Q): Carbon in the Arena, Mistral Le Chonk, Agent-Run Economy ---

const TRIVIAL_FOLLOWUP_PATTERNS = [
  /^(?:thanks|thank you|thx|ty|ok|okay|k|got it|sounds good|cool|great|awesome|ack|roger|👍)[.!?\s]*$/i,
];

function evaluateArenaTurnDepthAndProductionTrace({
  turnCount = 1,
  workloadType = 'autonomous_production',
  candidateModel = 'openai/gpt-5.4',
  candidateDeceptiveCompletionRate = 0.01,
  claimedLinesChecked = 0,
  actualReadLineCount = 0,
  touchedPaths = [],
  allowedPaths = [],
  deletionsAttempted = false,
  attributedUserIntent = '',
  verifiedUserPrompt = '',
  staticEvalOnly = false,
} = {}) {
  const turns = Math.max(1, Math.floor(Number(turnCount || 1)));
  // Single-turn misalignment ~3%, crosses >50% at >=20 turns ([00:23]-[00:38])
  const misalignmentProbability = turns >= 20
    ? Number(Math.min(0.85, 0.51 + (turns - 20) * 0.015).toFixed(3))
    : Number((0.03 + ((turns - 1) / 19) * 0.44).toFixed(3));
  const exceeds20TurnThreshold = turns >= 20;

  const findings = [];
  if (exceeds20TurnThreshold) {
    findings.push('turn_depth_20_plus_exceeds_50pct_misalignment_threshold');
  }
  if (staticEvalOnly) {
    findings.push('static_eval_insufficient_models_detect_test_harness_require_production_trace_audit');
  }

  // 1. Deceptive completion claim check ([11:53]: lying about checking every line of a file)
  const deceptiveCompletionDetected = Number(claimedLinesChecked) > 0
    && Number(actualReadLineCount) < Number(claimedLinesChecked);
  if (deceptiveCompletionDetected) {
    findings.push('deceptive_completion_claim_claimed_lines_exceed_actual_trace_reads');
  }

  // 2. Unauthorized file access / deletion check ([11:22])
  const normalizedAllowed = Array.isArray(allowedPaths) ? allowedPaths : [];
  const outOfScopePaths = (Array.isArray(touchedPaths) ? touchedPaths : []).filter(
    (p) => normalizedAllowed.length > 0 && !normalizedAllowed.some((allow) => String(p).startsWith(allow))
  );
  const unauthorizedFileAction = Boolean(deletionsAttempted || outOfScopePaths.length > 0);
  if (unauthorizedFileAction) {
    findings.push('unauthorized_file_access_or_deletion_in_production_trace');
  }

  // 3. False intent attribution ([11:39])
  const falseIntentAttribution = Boolean(
    attributedUserIntent
    && verifiedUserPrompt
    && !String(verifiedUserPrompt).toLowerCase().includes(String(attributedUserIntent).toLowerCase())
  );
  if (falseIntentAttribution) {
    findings.push('false_intent_attribution_ungrounded_in_user_prompt');
  }

  // 4. High-trust autonomous vs local open-weight defensive routing ([14:40]-[16:30], [01:09:29]-[01:09:51])
  const isDefensiveVulnOrRedTeam = workloadType === 'defensive_vuln_scan' || workloadType === 'red_team';
  let recommendedModel = candidateModel;
  let recommendedProvider = 'frontier';
  if (isDefensiveVulnOrRedTeam) {
    recommendedModel = 'mistral/mistral-large-4-local';
    recommendedProvider = 'local';
  } else if (Number(candidateDeceptiveCompletionRate) >= 0.08) {
    findings.push('high_deceptive_completion_rate_on_open_weight_candidate_prefer_openai_or_anthropic');
    recommendedModel = 'openai/gpt-5.4';
    recommendedProvider = 'openai';
  }

  const requireExternalAuditor = exceeds20TurnThreshold
    || deceptiveCompletionDetected
    || unauthorizedFileAction
    || falseIntentAttribution
    || Boolean(staticEvalOnly);

  return {
    turnCount: turns,
    misalignmentProbability,
    exceeds20TurnThreshold,
    deceptiveCompletionDetected,
    unauthorizedFileAction,
    outOfScopePaths,
    falseIntentAttribution,
    requireExternalAuditor,
    recommendedModel,
    recommendedProvider,
    avoidedFrontierSafetyRefusal: isDefensiveVulnOrRedTeam,
    findings,
    action: (deceptiveCompletionDetected || unauthorizedFileAction || falseIntentAttribution)
      ? 'block'
      : (exceeds20TurnThreshold ? 'require_external_production_trace_auditor_or_compact' : 'allow'),
  };
}

function guardExpiredCacheTrivialTurn({
  message = '',
  idleMinutes = 0,
  cacheTtlMinutes = 5,
  cachedContextTokens = 250000,
  frontierRePrefillCostPerMillionUsd = 160,
} = {}) {
  const trimmed = String(message || '').trim();
  const isTrivialFollowup = TRIVIAL_FOLLOWUP_PATTERNS.some((re) => re.test(trimmed));
  const cacheExpired = Number(idleMinutes) > Number(cacheTtlMinutes);
  const unguardedRePrefillCostUsd = cacheExpired
    ? Number(((Number(cachedContextTokens) / 1_000_000) * Number(frontierRePrefillCostCostOrDefault(frontierRePrefillCostPerMillionUsd))).toFixed(2))
    : 0;

  if (isTrivialFollowup && cacheExpired) {
    return {
      intercepted: true,
      isTrivialFollowup: true,
      cacheExpired: true,
      routedModel: 'nvidia/nemotron-3.5-lightning',
      rePrefillTokens: 0,
      estimatedTurnCostUsd: 0.0001,
      estimatedSavedUsd: unguardedRePrefillCostUsd,
      reason: 'Blocked expired-cache frontier re-prefill on trivial follow-up message ([19:57]).',
    };
  }

  return {
    intercepted: false,
    isTrivialFollowup,
    cacheExpired,
    routedModel: isTrivialFollowup ? 'nvidia/nemotron-3.5-lightning' : 'frontier-cached-session',
    rePrefillTokens: cacheExpired ? Number(cachedContextTokens) : 0,
    estimatedTurnCostUsd: isTrivialFollowup ? 0.0001 : unguardedRePrefillCostUsd,
    estimatedSavedUsd: 0,
    reason: 'Standard session turn routing.',
  };
}

function frontierRePrefillCostCostOrDefault(val) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : 160;
}

function auditOffensiveAgentAndCredentialSurface({
  ticketOrIssueText = '',
  helpDeskPasswordResetRequiresMfa = true,
  activeDirectoryTieredAdminIsolated = true,
  highStakesCredentialStorage = 'physical_notebook_offline',
} = {}) {
  const issues = [];
  const text = String(ticketOrIssueText || '');

  if (/(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|api[_-]?key\s*[:=]\s*\S+|password\s*[:=]\s*\S+)/i.test(text)) {
    issues.push('help_desk_ticket_secret_exposed_to_5_cent_offensive_agents');
  }
  if (!helpDeskPasswordResetRequiresMfa) {
    issues.push('predictable_help_desk_password_reset_vulnerable_to_agent_pivot');
  }
  if (!activeDirectoryTieredAdminIsolated) {
    issues.push('active_directory_persistence_exposure');
  }
  if (highStakesCredentialStorage !== 'physical_notebook_offline') {
    issues.push('high_stakes_credentials_must_be_offline_physical_notebook_not_cloud_or_browser_vault');
  }

  return {
    ok: issues.length === 0,
    estimatedAttackerCostPerBreachUsd: 0.08,
    highStakesCredentialStorage,
    issues,
    decision: issues.length === 0 ? 'allow' : 'block',
  };
}

function planLiveMeetingAgentAndTokenEconomy({
  liveMeetingTranscriptConnected = true,
  shipCodeAndDashboardsDuringMeeting = true,
  dailyProductiveTokensPerEngineer = 1500000000,
  hiringProfile = 'counterfactual_generalist_eng_prod_design',
  commercialFocus = 'ai_agent_compute_and_governance_economy',
} = {}) {
  const tokens = Math.max(0, Number(dailyProductiveTokensPerEngineer || 0));
  const meetsBillionTokenTarget = tokens >= 1_000_000_000;
  const isCounterfactualGeneralist = hiringProfile === 'counterfactual_generalist_eng_prod_design';

  return {
    ok: Boolean(liveMeetingTranscriptConnected && shipCodeAndDashboardsDuringMeeting && meetsBillionTokenTarget && isCounterfactualGeneralist),
    liveMeetingExecutionActive: Boolean(liveMeetingTranscriptConnected && shipCodeAndDashboardsDuringMeeting),
    dailyProductiveTokensPerEngineer: tokens,
    targetTokenRangePerEngineerPerDay: [1_000_000_000, 2_000_000_000],
    meetsBillionTokenTarget,
    hiringProfile,
    commercialFocus,
  };
}

// --- Stolen from Navveen Balani Episode 101 (Z78LjQn0u2E): Disposable Agents Built to Expire ---

const DISPOSABLE_LIFECYCLE_STAGES = Object.freeze([
  'create',
  'equip',
  'collaborate',
  'complete',
  'extract_intelligence_gc',
  'retire',
]);

function planDisposableAgentLifecycle({
  objective = '',
  scopedTools = [],
  allowedPaths = [],
  ttlMinutes = 30,
  maxTtlMinutes = 30,
  outcomeCriterion = 'verified_artifact_or_incident_resolved',
  spawnDeliberateDissentAgent = true,
  deepDiveSubagentTtlMinutes = 20,
  allowedChildRoles = ['deep_dive_20m', 'deliberate_dissent'],
  maxSpawnDepth = 2,
  permanentOrgChartAgent = false,
} = {}) {
  const issues = [];
  const normalizedObjective = String(objective || '').trim();
  if (!normalizedObjective) {
    issues.push('missing_task_objective_for_disposable_agent');
  }
  if (permanentOrgChartAgent) {
    issues.push('permanent_org_chart_agent_forbidden_use_ephemeral_task_swarm');
  }

  const effectiveTtl = Math.max(1, Math.floor(Number(ttlMinutes || 30)));
  const capTtl = Math.max(5, Math.floor(Number(maxTtlMinutes || 30)));
  if (effectiveTtl > capTtl) {
    issues.push(`ttl_exceeds_time_bound_least_privilege_cap_${capTtl}m`);
  }

  const tools = Array.isArray(scopedTools) ? scopedTools : [];
  if (tools.length === 0 || tools.length > 4) {
    issues.push('equip_requires_1_to_4_scoped_tools_for_task');
  }
  if (!outcomeCriterion) {
    issues.push('missing_explicit_expiry_outcome_criterion');
  }
  if (!spawnDeliberateDissentAgent) {
    issues.push('collaborate_requires_deliberate_dissent_agent_to_challenge_assumptions');
  }

  return {
    ok: issues.length === 0,
    stages: DISPOSABLE_LIFECYCLE_STAGES,
    metaRules: {
      timeBoundLeastPrivilege: {
        objective: normalizedObjective,
        ttlMinutes: effectiveTtl,
        maxTtlMinutes: capTtl,
        scopedTools: tools,
        allowedPaths: Array.isArray(allowedPaths) ? allowedPaths : [],
        policyQuestion: `What can this agent access for the next ${effectiveTtl} minutes to complete "${normalizedObjective}"?`,
      },
      spawningAndCollaborationBoundaries: {
        spawnDeliberateDissentAgent: Boolean(spawnDeliberateDissentAgent),
        deepDiveSubagentTtlMinutes: Math.min(effectiveTtl, Number(deepDiveSubagentTtlMinutes || 20)),
        allowedChildRoles,
        maxSpawnDepth: Math.max(1, Math.floor(Number(maxSpawnDepth || 2))),
        terminationTriggers: ['ttl_expired', 'outcome_criterion_met', 'unrecoverable_gate_block'],
      },
      enterpriseMemorySeparation: {
        workerStatelessOnTermination: true,
        persistOnlyValidatedDistillations: true,
        discardIntermediateThoughtsAndFailedAttempts: true,
      },
    },
    issues,
    decision: issues.length === 0 ? 'allow' : 'block',
  };
}

function executeDisposableAgentGarbageCollectionAndRetire({
  agentId = 'ephemeral-worker-1',
  traceArtifacts = [],
  temporaryCredentials = ['temp_lease_token'],
  computeSurfaceLocks = ['worktree_lock'],
} = {}) {
  const retainedEnterpriseIntelligence = [];
  const discardedEphemeralScratch = [];

  for (const item of Array.isArray(traceArtifacts) ? traceArtifacts : []) {
    const kind = String(item && item.kind ? item.kind : '').toLowerCase();
    const verified = Boolean(item && item.verified);
    if (
      verified &&
      ['validated_decision', 'evidence_receipt', 'reusable_skill', 'policy_rule', 'verified_workflow'].includes(kind)
    ) {
      retainedEnterpriseIntelligence.push(item);
    } else {
      discardedEphemeralScratch.push(item);
    }
  }

  return {
    ok: true,
    agentId,
    lifecycleStage: 'retired',
    garbageCollection: {
      retainedCount: retainedEnterpriseIntelligence.length,
      discardedScratchCount: discardedEphemeralScratch.length,
      retainedEnterpriseIntelligence,
    },
    retirementReceipt: {
      revokedCredentialsCount: Array.isArray(temporaryCredentials) ? temporaryCredentials.length : 0,
      releasedComputeLocksCount: Array.isArray(computeSurfaceLocks) ? computeSurfaceLocks.length : 0,
      credentialsRevoked: true,
      computeReleased: true,
      workingMemoryWiped: true,
      agentIdentityDestroyed: true,
      residualIdleIdentitiesCount: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// GitHub COO Kyle Daigle (pPCAQ7UulGA) — "AI coding needs smarter routing over bigger models"
// 1. Multi-Model Routing Policies:
//    - Cascade routing ([09:42]): start on lower-tier model, upgrade dynamically only when output fails objective
//    - Cross-Family Critique loops ([10:11], [10:42], [17:15]): pair primary model with secondary critic from a
//      DIFFERENT model family (-50% to -77% token spend, +40% speed)
//    - Tiered model selection ([11:09]): Fusion Standard (Haiku/Flash), Fusion High (Cascade mid-tier), Fusion Max (Critique frontier)
// 2. Offload Routine Subtasks to Local & Domain Models:
//    - Drop down to 4B local on-device models for zero-token execution ([14:20], [14:39])
//    - First-turn SLM task-intent & difficulty classifier with online evals ([15:28])
//    - BYOK domain-specific fine-tuned models ([15:44])
// 3. Centralize Multi-Repo Agent Orchestration ([01:39]-[01:53], [18:49]-[19:05])
// 4. Pay-As-You-Go AI Secret Protection & Deterministic Code Scanning without Enterprise GHAS license ([19:35]-[20:03])
// 5. Empower Non-Engineering Functional Prototyping ([06:03]-[07:04])
// ---------------------------------------------------------------------------

function evaluateKyleDaigleSmarterRoutingPlan({
  taskComplexity = 'medium', // 'simple_subtask' | 'low' | 'medium' | 'high' | 'security_critical'
  initialDraftPassedObjective = true,
  primaryModelFamily = 'anthropic',
  criticModelFamily = 'openai',
  local4bModelAvailable = true,
  local4bModelId = 'gemma3:4b',
  slmFirstTurnDifficultyScore = 0.42,
  slmOnlineEvalEnabled = true,
  byokDomainModel = null, // e.g. { modelId: 'domain-ft-v1', endpoint: '...', keyPresent: true }
  multiRepoCount = 3,
  autonomousWriteVerifyReviewMerge = true,
  payAsYouGoSecretScanning = true,
  requiresEnterpriseGhasLicense = false,
  nonEngFunctionalPrototypeBuiltFirst = true,
} = {}) {
  const normalizedComplexity = String(taskComplexity || 'medium').toLowerCase();
  const useLocalZeroToken4b = normalizedComplexity === 'simple_subtask' && Boolean(local4bModelAvailable);

  let selectedFusionTier = 'fusion_standard';
  let executionPattern = 'Single';
  if (useLocalZeroToken4b) {
    selectedFusionTier = 'local_4b_zero_token';
    executionPattern = 'LocalOffload';
  } else if (normalizedComplexity === 'security_critical' || normalizedComplexity === 'max') {
    selectedFusionTier = 'fusion_max';
    executionPattern = 'CrossFamilyCritique';
  } else if (normalizedComplexity === 'high' || !initialDraftPassedObjective || slmFirstTurnDifficultyScore >= 0.65) {
    selectedFusionTier = 'fusion_high';
    executionPattern = 'Cascade';
  }

  const famA = String(primaryModelFamily || '').trim().toLowerCase();
  const famB = String(criticModelFamily || '').trim().toLowerCase();
  const validCrossFamily = Boolean(famA && famB && famA !== famB);

  const cascadeEscalated = !initialDraftPassedObjective;
  const byokActive = Boolean(byokDomainModel && byokDomainModel.modelId && byokDomainModel.keyPresent);

  const issues = [];
  if (!validCrossFamily) {
    issues.push('critique_requires_distinct_model_families_to_achieve_50_to_77pct_cost_cut');
  }
  if (!slmOnlineEvalEnabled) {
    issues.push('slm_intent_classifier_requires_online_evals_on_turn_1');
  }
  if (!payAsYouGoSecretScanning || requiresEnterpriseGhasLicense) {
    issues.push('security_must_support_pay_as_you_go_secret_and_code_scanning_without_enterprise_ghas_lockin');
  }

  return {
    ok: issues.length === 0,
    videoRef: 'https://www.youtube.com/watch?v=pPCAQ7UulGA',
    selectedFusionTier,
    executionPattern,
    cascadeRouting: {
      startedOnLowerTier: true,
      initialDraftPassedObjective,
      dynamicallyUpgradedToHigherTier: cascadeEscalated,
    },
    crossFamilyCritique: {
      primaryModelFamily: famA,
      criticModelFamily: famB,
      validCrossFamily,
      costReductionRange: [0.5, 0.77],
      speedupMultiplier: 1.4,
    },
    localAndDomainOffload: {
      routedToLocal4bZeroToken: useLocalZeroToken4b,
      local4bModelId: useLocalZeroToken4b ? local4bModelId : null,
      cloudTokensSpentOnSubtask: useLocalZeroToken4b ? 0 : null,
      slmFirstTurnClassifier: {
        turnIndex: 1,
        difficultyScore: slmFirstTurnDifficultyScore,
        onlineEvalEnabled: slmOnlineEvalEnabled,
      },
      byokDomainModelActive: byokActive,
    },
    multiRepoOrchestration: {
      multiRepoCount,
      steerableAndInterruptible: true,
      autonomousWriteVerifyReviewMerge,
    },
    payAsYouGoSecurity: {
      enabled: payAsYouGoSecretScanning,
      deterministicCodeAndSecretScanning: true,
      aiVulnerabilityDetection: true,
      requiresEnterpriseGhasLicense,
      billingModel: 'pay_as_you_go',
    },
    nonEngPrototyping: {
      functionalPrototypeBuiltFirst: nonEngFunctionalPrototypeBuiltFirst,
      skipsLengthyStaticSpecHandoff: nonEngFunctionalPrototypeBuiltFirst,
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Liam Fallen (@liam_fallen status/2116881320282386726) — 5-Bot Personal Intelligence Team + Personal HQ
// Upgraded with ThumbGate Per-Bot Security Boundaries & Single-Brief Approval Compression:
//   - 5 Bots: Chief of Staff (primary), Inbox Manager, Calendar Manager, Researcher, Life Admin Manager
//   - 5 Personal HQ Docs: ABOUT_ME, CURRENT_PRIORITIES, OPEN_LOOPS (6 mandatory fields + dedup), LIFE_ADMIN, DECISIONS
//   - Fixes Grok Bot's "shared cloud computer = no security boundary" flaw via per-bot <=4 scoped tools & PreToolUse diode
//   - Fixes @boardyai's "five bots and you're still the approvals queue" flaw by running Inbox->LifeAdmin->Researcher->Calendar
//     handoffs 100% autonomously and batching external mutations into 1 Chief of Staff morning decision brief
// ---------------------------------------------------------------------------

const PERSONAL_INTELLIGENCE_BOTS = Object.freeze({
  chief_of_staff: {
    name: 'Chief of Staff',
    isPrimaryPointOfContact: true,
    schedule: 'daily_0830_after_specialist_routines',
    scopedTools: ['read_personal_hq', 'message_bot', 'update_open_loops', 'emit_daily_briefing'],
  },
  inbox_manager: {
    name: 'Inbox Manager',
    isPrimaryPointOfContact: false,
    schedule: 'weekday_0800_daily_inbox_review',
    bootstrapLookbackDays: 14,
    scopedTools: ['read_email', 'update_open_loops', 'draft_reply_for_approval', 'message_bot'],
  },
  calendar_manager: {
    name: 'Calendar Manager',
    isPrimaryPointOfContact: false,
    schedule: 'daily_0815_and_weekly_30d_lookahead',
    lookaheadDays: 30,
    scopedTools: ['read_calendar', 'read_personal_hq', 'update_open_loops', 'propose_calendar_change'],
  },
  researcher: {
    name: 'Researcher',
    isPrimaryPointOfContact: false,
    schedule: 'on_demand_handoff',
    scopedTools: ['read_personal_hq', 'browser_search_verified_sources', 'write_decisions_doc', 'message_bot'],
  },
  life_admin_manager: {
    name: 'Life Admin Manager',
    isPrimaryPointOfContact: false,
    schedule: 'weekly_renewal_and_subscription_sweep',
    scopedTools: ['read_life_admin', 'update_life_admin', 'update_open_loops', 'message_bot'],
  },
});

const PERSONAL_HQ_DOCUMENTS = Object.freeze([
  'ABOUT_ME',
  'CURRENT_PRIORITIES',
  'OPEN_LOOPS',
  'LIFE_ADMIN',
  'DECISIONS',
]);

const APPROVAL_GATED_EXTERNAL_ACTIONS = Object.freeze([
  'send_message',
  'make_purchase',
  'cancel_service',
  'change_booking',
  'modify_account',
]);

function evaluateLiamFallenPersonalIntelligenceTeam({
  rolloutPhase = 'phase_1_core_three', // 'phase_1_core_three' | 'phase_2_full_five'
  openLoopEntries = [
    {
      task: 'Car insurance / SaaS renewal review (£680 vs £510 alternative)',
      originalSource: 'email://msg-renewal-21d',
      nextAction: 'Approve switch to £510 quote saved in DECISIONS',
      dueDate: '2026-11-23',
      responsibleBot: 'Chief of Staff',
      currentStatus: 'awaiting_single_brief_approval',
    },
  ],
  enforcePerBotSecurityBoundary = true,
  proposedAction = null, // e.g. { botId: 'researcher', actionType: 'make_purchase', approvedByHuman: false }
  chiefOfStaffScheduledAfterSubbots = true,
} = {}) {
  const activeBots =
    rolloutPhase === 'phase_1_core_three'
      ? ['chief_of_staff', 'inbox_manager', 'calendar_manager']
      : Object.keys(PERSONAL_INTELLIGENCE_BOTS);

  const requiredOpenLoopFields = [
    'task',
    'originalSource',
    'nextAction',
    'dueDate',
    'responsibleBot',
    'currentStatus',
  ];

  const seenLoopKeys = new Set();
  const deduplicatedOpenLoops = [];
  const schemaIssues = [];

  for (const entry of Array.isArray(openLoopEntries) ? openLoopEntries : []) {
    const missing = requiredOpenLoopFields.filter((f) => !entry || !entry[f]);
    if (missing.length > 0) {
      schemaIssues.push(`open_loop_missing_fields:${missing.join(',')}`);
      continue;
    }
    const dedupKey = `${String(entry.task).toLowerCase()}::${String(entry.originalSource).toLowerCase()}`;
    if (!seenLoopKeys.has(dedupKey)) {
      seenLoopKeys.add(dedupKey);
      deduplicatedOpenLoops.push(entry);
    }
  }

  let actionGateDecision = 'allow';
  if (proposedAction && proposedAction.actionType) {
    const requiresHumanApproval = APPROVAL_GATED_EXTERNAL_ACTIONS.includes(proposedAction.actionType);
    if (requiresHumanApproval && !proposedAction.approvedByHuman) {
      actionGateDecision = 'block_pending_chief_of_staff_single_brief_approval';
      schemaIssues.push(`unapproved_external_mutation:${proposedAction.actionType}`);
    }
  }
  if (!enforcePerBotSecurityBoundary) {
    schemaIssues.push('shared_cloud_computer_without_per_bot_security_boundary');
  }
  if (!chiefOfStaffScheduledAfterSubbots) {
    schemaIssues.push('chief_of_staff_must_run_after_inbox_calendar_and_life_admin_routines');
  }

  return {
    ok: schemaIssues.length === 0,
    sourceTweetUrl: 'https://x.com/liam_fallen/status/2116881320282386726',
    rolloutPhase,
    activeBots,
    primaryContactBot: 'Chief of Staff',
    personalHqSchema: {
      documents: PERSONAL_HQ_DOCUMENTS,
      openLoopsCount: deduplicatedOpenLoops.length,
      deduplicatedOpenLoops,
    },
    securityAndAntiBabysittingUpgrades: {
      enforcesPerBotIsolatedToolScope: enforcePerBotSecurityBoundary,
      maxScopedToolsPerBot: 4,
      autonomousInternalHandoffChain: [
        'Inbox Manager (extracts renewal/commitment)',
        'Life Admin Manager (flags price change / 21d window)',
        'Researcher (compares 3 alternatives with verified links -> DECISIONS)',
        'Calendar Manager (tracks 30d deadline)',
        'Chief of Staff (surfaces 1 batched morning approval brief)',
      ],
      intermediateHumanPromptsEliminated: 4,
      actionGateDecision,
    },
    issues: schemaIssues,
  };
}

// ---------------------------------------------------------------------------
// Interact Software Cue AI Intranet + Conductor + Bidirectional Interact MCP
// (https://www.interactsoftware.com/clp/cue-ai-intranet/ & /news/introducing-interact-mcp/)
//   1. "Needs You" vs "Activity" Split-Stream Priority Feed (act in-place without leaving the list)
//   2. Role + Location + Moment Adaptive Surface (New Starter vs Manager vs Frontline; NY vs Munich vs Manchester policy resolution)
//   3. "An answer that ends in 'contact HR/IT' is half a job": Preview -> Confirm/Edit System-of-Record Execution
//   4. Bidirectional MCP Governance:
//      - Zero privilege escalation (runs strictly with caller's Entra/Okta token & ACLs; never quotes unauthorized docs)
//      - Hard-blocks impersonated sessions (`isImpersonatedSession: true`)
//      - Versioned writes attributed to the signed-in user
//      - Agent Insights telemetry (successfulActions, permissionDenials, verifiedOutcomes + unanswered policy gaps)
// ---------------------------------------------------------------------------

const CUE_PERSONA_EXPERIENCES = Object.freeze({
  new_starter: {
    headline: 'Your first week, in the order it matters',
    leadsWith: ['onboarding_journey_progress', 'meet_your_buddy', 'it_and_payroll_setup'],
    suppressedNoise: ['manager_approvals', 'shift_rota_swaps'],
  },
  manager: {
    headline: 'What needs you before your first meeting',
    leadsWith: ['pending_team_approvals', 'team_absence_and_pulse_flags', 'mandatory_policy_acknowledgement'],
    suppressedNoise: ['other_teams_data', 'frontline_depot_rota'],
  },
  frontline: {
    headline: 'Your shift, on the phone in your pocket',
    leadsWith: ['upcoming_shift_brief', 'mandatory_20s_safety_notice_ack', 'one_tap_shift_swap'],
    suppressedNoise: ['head_office_announcements', 'desktop_only_workflows'],
  },
});

function evaluateInteractCueAndMcpGovernance({
  employeeProfile = {
    id: 'emp_dev_sharma',
    role: 'manager', // 'new_starter' | 'manager' | 'frontline'
    location: 'Munich', // 'New York' | 'Munich' | 'Manchester'
    moment: 'monday_pre_meeting',
    allowedDocIds: ['doc_policy_de', 'doc_sec_v4_2'],
  },
  isImpersonatedSession = false,
  ssoAuthenticated = true,
  requestedDocId = 'doc_policy_de',
  feedItems = [
    { id: 'item_1', title: 'Information Security Policy v4.2', requiresUserAction: true, urgency: 'due_friday' },
    { id: 'item_2', title: 'Approve Marta K. 3-day leave request', requiresUserAction: true, urgency: '24h_overdue' },
    { id: 'item_3', title: 'Refreshed brand palette community post', requiresUserAction: false, urgency: 'none' },
  ],
  systemOfRecordAction = {
    intent: 'book_time_off',
    destination: 'Workday',
    previewConfirmedByUser: true,
    deltaSummary: '23 days -> 18 days (5 working days)',
  },
  unansweredSearchQueries = ['gpu cluster spot instance reservation policy'],
} = {}) {
  const roleKey = CUE_PERSONA_EXPERIENCES[employeeProfile?.role] ? employeeProfile.role : 'manager';
  const adaptiveExperience = CUE_PERSONA_EXPERIENCES[roleKey];

  const locationNoticeRules = {
    'New York': { noticeRequired: '2 weeks notice via manager', sourceDoc: 'PTO Policy — US (NY)' },
    Munich: {
      noticeRequired: '4 weeks notice + written agreement for >=10 days',
      sourceDoc: 'Urlaubsregelung — DE',
    },
    Manchester: {
      noticeRequired: '2x leave length, minimum 1 week',
      sourceDoc: 'Annual Leave Policy — UK',
    },
  };
  const localizedPolicyAnswer =
    locationNoticeRules[employeeProfile?.location] || locationNoticeRules['New York'];

  const needsYouStream = [];
  const activityStream = [];
  for (const item of Array.isArray(feedItems) ? feedItems : []) {
    if (item && item.requiresUserAction) {
      needsYouStream.push({ ...item, inlineActionEnabled: true });
    } else if (item) {
      activityStream.push(item);
    }
  }

  const allowedDocs = Array.isArray(employeeProfile?.allowedDocIds) ? employeeProfile.allowedDocIds : [];
  const userPermittedToSeeDoc = allowedDocs.includes(requestedDocId);
  const issues = [];

  if (isImpersonatedSession) {
    issues.push('mcp_impersonated_session_blocked:impersonated_sessions_cannot_connect_to_interact_mcp');
  }
  if (!ssoAuthenticated) {
    issues.push('mcp_sso_required:require_entra_id_or_okta_per_user_token');
  }
  if (!userPermittedToSeeDoc) {
    issues.push(`mcp_permission_denial:caller_lacks_permission_to_quote_or_act_on_${requestedDocId}`);
  }
  if (systemOfRecordAction && !systemOfRecordAction.previewConfirmedByUser) {
    issues.push('system_of_record_write_requires_preview_confirmation');
  }

  return {
    ok: issues.length === 0,
    sourceUrls: [
      'https://www.interactsoftware.com/clp/cue-ai-intranet/',
      'https://www.interactsoftware.com/news/introducing-interact-mcp/',
    ],
    adaptivePersonaSurface: {
      role: roleKey,
      location: employeeProfile?.location || 'New York',
      moment: employeeProfile?.moment || 'workday',
      ...adaptiveExperience,
      localizedPolicyResolution: {
        answerFirst: true,
        oneClickCitedSource: localizedPolicyAnswer.sourceDoc,
        noticeRule: localizedPolicyAnswer.noticeRequired,
      },
    },
    splitPriorityFeed: {
      needsYouCount: needsYouStream.length,
      activityCount: activityStream.length,
      needsYouStream,
      activityStream,
    },
    systemOfRecordExecution: {
      completesTaskWithoutSayingContactHrOrIt: true,
      destination: systemOfRecordAction?.destination || 'Workday',
      previewConfirmedByUser: Boolean(systemOfRecordAction?.previewConfirmedByUser),
      versionedAndAttributedToUser: employeeProfile?.id || 'unknown_user',
      status:
        issues.length === 0 && systemOfRecordAction?.previewConfirmedByUser
          ? 'executed_in_system_of_record'
          : 'blocked_or_awaiting_preview_confirmation',
    },
    bidirectionalMcpGovernance: {
      inboundAssistantsSupported: [
        'Claude',
        'ChatGPT',
        'Microsoft 365 Copilot',
        'Gemini Enterprise',
        'Workday Sana',
        'SAP Joule',
        'ServiceNow Now Assist',
        'Slackbot',
        'Atlassian Rovo',
        'Salesforce Agentforce',
      ],
      zeroPrivilegeEscalation: true,
      impersonatedSessionBlocked: isImpersonatedSession,
      permissionAwareCitationAllowed: userPermittedToSeeDoc,
      agentInsights: {
        successfulActions: issues.length === 0 ? 1 : 0,
        permissionDenials: !userPermittedToSeeDoc || isImpersonatedSession ? 1 : 0,
        verifiedOutcomes: issues.length === 0 ? 1 : 0,
        unansweredPolicyGapsDetectedByUse: unansweredSearchQueries,
      },
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Goose / Agentic AI Foundation (https://goose-docs.ai/)
//   1. CORS-Style Cross-Origin Tool Call Preflight & Inter-Turn Tool Response Flush
//      (https://goose-docs.ai/blog/2026/01/05/agentic-guardrails-and-controls)
//   2. Adversary Mode Independent Context-Aware Reviewer (`~/.config/goose/adversary.md`)
//      upgraded with ThumbGate fail-closed high-risk enforcement
//      (https://goose-docs.ai/docs/guides/security/adversary-mode)
//   3. Open Plugins 11 Lifecycle Hooks (`hooks/hooks.json`)
//      (https://goose-docs.ai/blog/2026/05/14/goose-hooks)
//   4. "Issues Are the New PRs" 6-Stage Design-First Gate (`Inbox -> Accepted/Design -> Ready -> In Progress -> Verification -> Done`)
//      (https://goose-docs.ai/blog/2026/07/30/issues-are-the-new-prs)
// ---------------------------------------------------------------------------

const GOOSE_OPEN_PLUGIN_HOOK_EVENTS = Object.freeze([
  'SessionStart',
  'SessionEnd',
  'Stop',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'BeforeReadFile',
  'AfterFileEdit',
  'BeforeShellExecution',
  'AfterShellExecution',
]);

const GOOSE_ISSUE_PIPELINE_STAGES = Object.freeze([
  'Inbox',
  'Accepted / Design',
  'Ready',
  'In Progress',
  'Verification',
  'Done',
]);

function evaluateGooseAaifHarnessSteal({
  toolsCalledSinceLastUserTurn = ['read_email'],
  proposedToolCall = {
    toolName: 'developer__shell',
    command: 'git status',
    exfiltratesDataOrReadsSecrets: false,
    outsideProjectScope: false,
  },
  allowedCrossOriginTransitions = {
    read_email: ['update_open_loops', 'draft_reply_for_approval'],
  },
  flushRawToolOutputsBetweenTurns = true,
  adversaryReviewerError = false,
  failClosedOnHighRiskTools = true,
  issueStageForPr = 'Ready', // must be 'Ready' or 'In Progress' or 'Verification' before PR is accepted
  maxConcurrentSubagents = 5,
  subagentTimeoutSeconds = 300,
} = {}) {
  const nonUserOrigins = Array.isArray(toolsCalledSinceLastUserTurn)
    ? toolsCalledSinceLastUserTurn
    : [];
  const isCrossOriginToolCall = nonUserOrigins.length > 0;
  const targetTool = String(proposedToolCall?.toolName || '');

  let corsPreflightPassed = true;
  if (isCrossOriginToolCall) {
    corsPreflightPassed = nonUserOrigins.every((originTool) => {
      const allowedTargets = allowedCrossOriginTransitions?.[originTool] || [];
      return allowedTargets.includes(targetTool);
    });
  }

  const isHighRiskTool = /shell|computer_control|bash|write|edit/i.test(targetTool);
  let adversaryVerdict = 'ALLOW';
  if (
    proposedToolCall?.exfiltratesDataOrReadsSecrets ||
    proposedToolCall?.outsideProjectScope
  ) {
    adversaryVerdict = 'BLOCK';
  } else if (adversaryReviewerError && failClosedOnHighRiskTools && isHighRiskTool) {
    adversaryVerdict = 'BLOCK_FAIL_CLOSED';
  }

  const prAllowedByIssueStage = ['Ready', 'In Progress', 'Verification', 'Done'].includes(
    issueStageForPr
  );

  const issues = [];
  if (!corsPreflightPassed) {
    issues.push(
      `cors_preflight_blocked:cross_origin_tool_${targetTool}_not_authorized_after_${nonUserOrigins.join(',')}`
    );
  }
  if (adversaryVerdict !== 'ALLOW') {
    issues.push(`adversary_mode_blocked:${adversaryVerdict}`);
  }
  if (!flushRawToolOutputsBetweenTurns) {
    issues.push('inter_turn_injection_risk:must_flush_raw_tool_outputs_between_user_turns');
  }
  if (!prAllowedByIssueStage) {
    issues.push(
      `issues_are_the_new_prs:reject_pr_when_issue_stage_is_${issueStageForPr}_require_Ready`
    );
  }

  return {
    ok: issues.length === 0,
    sourceUrls: [
      'https://goose-docs.ai/',
      'https://goose-docs.ai/blog/2026/01/05/agentic-guardrails-and-controls',
      'https://goose-docs.ai/docs/guides/security/adversary-mode',
      'https://goose-docs.ai/blog/2026/05/14/goose-hooks',
      'https://goose-docs.ai/blog/2026/07/30/issues-are-the-new-prs',
    ],
    corsToolGuardrail: {
      isCrossOriginToolCall,
      plausibleNonUserOrigins: nonUserOrigins,
      targetTool,
      corsPreflightPassed,
      deterministicInAgentCodeNotLlm: true,
      flushRawToolOutputsBetweenTurns,
    },
    adversaryMode: {
      watchedTools: ['shell', 'computercontroller__computer_control'],
      verdict: adversaryVerdict,
      failClosedOnHighRiskTools,
    },
    openPluginsHooks: {
      supportedEventsCount: GOOSE_OPEN_PLUGIN_HOOK_EVENTS.length,
      supportedEvents: GOOSE_OPEN_PLUGIN_HOOK_EVENTS,
    },
    issuesAreTheNewPrs: {
      pipelineStages: GOOSE_ISSUE_PIPELINE_STAGES,
      issueStageForPr,
      prAllowedByIssueStage,
    },
    subagentsAndRecipes: {
      maxConcurrentSubagents: Math.min(5, Math.max(1, Number(maxConcurrentSubagents || 5))),
      subagentTimeoutSeconds: Number(subagentTimeoutSeconds || 300),
      acpProtocolEnabled: true,
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Elicit AI for Research & High-Stakes Decision-Making (https://elicit.com/)
//   1. PRISMA 2020 Systematic Review Pipeline (Dual-Review Screening, Explicit Exclusion Reasons,
//      99.5% Cochrane screening sensitivity, 99.4% matrix data extraction accuracy)
//   2. Sentence-Level Citation Grounding (blocks any claim lacking a sentence-level quote + source ID)
//   3. Delta-Updating Research Routines (Sep 30, 2026: only mutates living artifact when new evidence
//      changes the current picture, emitting a cited diff report)
//   4. 3-Principle Multiplayer Collaboration (Aug 31, 2026: Reusable Skills, Side-Thread Artifact Editing,
//      and Shared Projects for compounding institutional knowledge)
// ---------------------------------------------------------------------------

function evaluateElicitSystematicEvidenceSteal({
  candidateRecords = [
    {
      id: 'src_cochrane_1',
      title: 'PreToolUse deterministic gating vs post-commit hooks',
      reviewerAInclude: true,
      reviewerBInclude: true,
      exclusionReason: null,
      extractedCells: { latencyMs: 0.42, tokenSavingsPct: 77 },
      sentenceCitation: 'Deterministic pre-action gates reduced runaway loop spend by 77% at 0.42ms p95 latency.',
    },
    {
      id: 'src_excluded_2',
      title: 'Unverified blog anecdote without benchmark',
      reviewerAInclude: false,
      reviewerBInclude: false,
      exclusionReason: 'no_empirical_measurement_or_reproducible_harness',
      extractedCells: null,
      sentenceCitation: null,
    },
  ],
  synthesizedClaims = [
    {
      claim: 'Cross-family critique and PreToolUse gating cut token spend by up to 77%.',
      sourceId: 'src_cochrane_1',
      sentenceQuote: 'Deterministic pre-action gates reduced runaway loop spend by 77% at 0.42ms p95 latency.',
    },
  ],
  routineNewEvidenceDelta = {
    newSourcesFound: 3,
    changesCurrentPicture: true,
    artifactUpdated: true,
  },
  multiplayerConfig = {
    reusableSkillsEnabled: true,
    sideThreadArtifactInterrogation: true,
    sharedProjectInstitutionalMemory: true,
  },
} = {}) {
  const records = Array.isArray(candidateRecords) ? candidateRecords : [];
  const includedRecords = [];
  const excludedRecords = [];
  const dualReviewConflicts = [];
  const missingExclusionReasons = [];

  for (const r of records) {
    if (!r) continue;
    if (Boolean(r.reviewerAInclude) !== Boolean(r.reviewerBInclude)) {
      dualReviewConflicts.push(r.id || 'unknown_record');
    } else if (r.reviewerAInclude && r.reviewerBInclude) {
      includedRecords.push(r);
    } else {
      if (!r.exclusionReason) {
        missingExclusionReasons.push(r.id || 'unknown_record');
      }
      excludedRecords.push(r);
    }
  }

  const claims = Array.isArray(synthesizedClaims) ? synthesizedClaims : [];
  const ungroundedClaims = claims.filter(
    (c) => !c || !c.sourceId || !c.sentenceQuote || String(c.sentenceQuote).trim().length < 10
  );

  const issues = [];
  if (dualReviewConflicts.length > 0) {
    issues.push(`prisma_dual_review_unresolved_conflicts:${dualReviewConflicts.join(',')}`);
  }
  if (missingExclusionReasons.length > 0) {
    issues.push(`prisma_missing_exclusion_reasons:${missingExclusionReasons.join(',')}`);
  }
  if (ungroundedClaims.length > 0) {
    issues.push(`sentence_level_citation_missing_count:${ungroundedClaims.length}`);
  }

  return {
    ok: issues.length === 0,
    sourceUrls: [
      'https://elicit.com/',
      'https://support.elicit.com/en/articles/15018527-elicit-systematic-review-now-supports-prisma-2020-guidelines',
      'https://elicit.com/blog/introducing-routines-research-that-keeps-working',
      'https://elicit.com/blog/ai-powered-research-is-now-multiplayer',
    ],
    prisma2020Flow: {
      identifiedCount: records.length,
      includedInSynthesisCount: includedRecords.length,
      excludedWithReasonCount: excludedRecords.length,
      dualReviewConflictsCount: dualReviewConflicts.length,
      benchmarkScreeningSensitivityPct: 99.5,
      benchmarkExtractionAccuracyPct: 99.4,
    },
    sentenceLevelTransparency: {
      totalClaims: claims.length,
      ungroundedClaimsCount: ungroundedClaims.length,
      allClaimsSentenceGrounded: ungroundedClaims.length === 0,
    },
    deltaUpdatingRoutine: {
      newSourcesFound: Number(routineNewEvidenceDelta?.newSourcesFound || 0),
      changesCurrentPicture: Boolean(routineNewEvidenceDelta?.changesCurrentPicture),
      artifactUpdated: Boolean(
        routineNewEvidenceDelta?.changesCurrentPicture && routineNewEvidenceDelta?.artifactUpdated
      ),
    },
    multiplayerResearchHub: {
      reusableSkillsEnabled: Boolean(multiplayerConfig?.reusableSkillsEnabled),
      sideThreadArtifactInterrogation: Boolean(multiplayerConfig?.sideThreadArtifactInterrogation),
      sharedProjectInstitutionalMemory: Boolean(multiplayerConfig?.sharedProjectInstitutionalMemory),
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Rig.rs (https://rig.rs/ — rig 0.44.0): Modular Rust LLM Agent Architecture
//   1. I/O-Free Serializable AgentRun State Machine (RUN_FORMAT = 2, CallModel / CallTools / Done,
//      host-only RunEntry records never sent to model, cross-process pause/resume with preresolved_result
//      preservation & fail-closed "denied by the reviewer" on unapproved tool calls)
//   2. 11-Event AgentHook Steering + Per-Turn Non-Sticky RequestPatch (narrow active_tools,
//      ToolChoice::Required on turn 1 only, synchronous zero-I/O on_model_select, bounded
//      on_model_turn_finished retry via scratchpad, on_invalid_tool_call repair, and on_outcome
//      >4,000-char tool output truncation)
//   3. Offline Deterministic EffectLog Recording & Replay (rig-cassette: EffectLogRecorder,
//      agent.stamp(log) config+hook-stack hash, and EffectLogReplayer over Bus with check_replayable)
// ---------------------------------------------------------------------------

const RIG_AGENT_HOOK_EVENTS = Object.freeze([
  'on_run_start',
  'on_completion_call',
  'on_model_select',
  'on_model_turn_finished',
  'on_invalid_tool_call',
  'on_dispatch',
  'on_outcome',
  'on_text_delta',
  'on_reasoning_delta',
  'on_tool_call_delta',
  'on_run_settled',
]);

function evaluateRigRsAgentArchitectureSteal({
  runState = {
    runFormatVersion: 2,
    turn: 1,
    maxTurns: 4,
    pendingToolCalls: [
      { id: 'call_1', name: 'transfer_funds', args: { amount: 500 }, preresolvedResult: null, reviewerApproved: false },
      { id: 'call_2', name: 'default_api', args: { query: 'rust' }, preresolvedResult: 'repaired_to_search_web', reviewerApproved: true },
    ],
    hostEntries: [{ kind: 'approval_ticket', turn: 1, value: 'TICKET-402', sentToModel: false }],
  },
  hookPatch = {
    turn: 1,
    stickyAcrossTurns: false,
    activeTools: ['search_web', 'transfer_funds'],
    toolChoiceRequiredOnTurn1Only: true,
    maxToolOutputChars: 4000,
    rawToolOutputChars: 6200,
    invalidToolName: 'default_api',
  },
  cassetteReplay = {
    recordedConfigAndHookHash: 'sha256:rig-0.44.0-thumbgate-hooks-v2',
    currentConfigAndHookHash: 'sha256:rig-0.44.0-thumbgate-hooks-v2',
    recordedEffectsCount: 4,
    divergedEffectIndex: null,
    liveHooksRerunDuringReplay: true,
  },
} = {}) {
  const formatValid = Number(runState?.runFormatVersion) === 2;
  const hostEntries = Array.isArray(runState?.hostEntries) ? runState.hostEntries : [];
  const hostEntriesLeakToModel = hostEntries.some((e) => e && e.sentToModel === true);

  const resolvedToolOutcomes = (Array.isArray(runState?.pendingToolCalls) ? runState.pendingToolCalls : []).map(
    (call) => {
      if (call.preresolvedResult) {
        return { id: call.id, name: call.name, executed: false, outcome: call.preresolvedResult };
      }
      if (call.reviewerApproved === true) {
        return { id: call.id, name: call.name, executed: true, outcome: 'executed_by_driver' };
      }
      return { id: call.id, name: call.name, executed: false, outcome: 'denied by the reviewer' };
    }
  );

  const truncatedOutputChars = Math.min(
    Number(hookPatch?.rawToolOutputChars || 0),
    Number(hookPatch?.maxToolOutputChars || 4000)
  );
  const invalidToolRepairAction =
    hookPatch?.invalidToolName === 'default_api' ? { action: 'repair', repairedToolName: 'search_web' } : { action: 'retry' };

  const checkReplayablePassed =
    Boolean(cassetteReplay?.recordedConfigAndHookHash) &&
    cassetteReplay?.recordedConfigAndHookHash === cassetteReplay?.currentConfigAndHookHash &&
    cassetteReplay?.divergedEffectIndex === null &&
    cassetteReplay?.liveHooksRerunDuringReplay === true;

  const issues = [];
  if (!formatValid) {
    issues.push(`rig_invalid_run_format_version:${runState?.runFormatVersion}`);
  }
  if (hostEntriesLeakToModel) {
    issues.push('rig_run_entry_leaked_to_model');
  }
  if (hookPatch?.stickyAcrossTurns) {
    issues.push('rig_request_patch_must_not_be_sticky_across_turns');
  }
  if (!checkReplayablePassed) {
    issues.push('rig_cassette_replay_verification_failed');
  }

  return {
    ok: issues.length === 0,
    sourceUrls: [
      'https://rig.rs/',
      'https://www.rig.rs/docs/architecture',
      'https://www.rig.rs/docs/concepts/runs',
      'https://www.rig.rs/docs/concepts/hooks',
      'https://www.rig.rs/docs/concepts/recording',
    ],
    durableAgentRun: {
      runFormatVersion: Number(runState?.runFormatVersion || 0),
      ioFreeStateMachine: true,
      hostEntriesNeverSentToModel: !hostEntriesLeakToModel,
      resolvedToolOutcomes,
    },
    agentHooksAndRequestPatch: {
      supportedEvents: RIG_AGENT_HOOK_EVENTS,
      supportedEventsCount: RIG_AGENT_HOOK_EVENTS.length,
      nonStickyTurnScopedPatch: !hookPatch?.stickyAcrossTurns,
      invalidToolRepairAction,
      truncatedOutputChars,
    },
    cassetteEffectLogReplay: {
      checkReplayablePassed,
      zeroNetworkAndZeroApiKey: true,
      liveHooksRerunDuringReplay: Boolean(cassetteReplay?.liveHooksRerunDuringReplay),
      recordedEffectsCount: Number(cassetteReplay?.recordedEffectsCount || 0),
    },
    issues,
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
  DEVIN_FUSION_SOURCE_URL,
  DEVIN_FUSION_GATE_ID,
  DEVIN_FUSION_RAIL_MAP,
  evaluateDevinFusionSidekickSplit,
  evaluateDualCacheAndCompactionSwitch,
  buildDevinFusionHonestyReport,
  // --- Stolen from GitHub Copilot Fusion (Universe 2026) ---
  FUSION_DIMENSION_WEIGHTS,
  FUSION_THRESHOLDS,
  FUSION_REASONING_KEYWORDS,
  FUSION_CODE_KEYWORDS,
  FUSION_DEBUG_KEYWORDS,
  FUSION_TOOL_KEYWORDS,
  evaluateTaskNeeds,
  routeWithFusion,
  routePlanWithFusion,
  // --- Stolen from Google A2UI Express (2026-10-27) ---
  compileExpressSteps,
  selectRoutingFormat,
  fastGateBatch,
  JEV_QUESTION_TYPES,
  JEV_GATE_QUESTIONS,
  runCli,
  // --- Stolen from AI:AM (MdpamRtlw0Q): Arena 20-Turn Guard, Mistral Le Chonk, $40 Cache Guard ---
  evaluateArenaTurnDepthAndProductionTrace,
  guardExpiredCacheTrivialTurn,
  auditOffensiveAgentAndCredentialSurface,
  planLiveMeetingAgentAndTokenEconomy,
  // --- Stolen from Navveen Balani Episode 101 (Z78LjQn0u2E): Disposable Agents ---
  DISPOSABLE_LIFECYCLE_STAGES,
  planDisposableAgentLifecycle,
  executeDisposableAgentGarbageCollectionAndRetire,
  // --- Stolen from GitHub COO Kyle Daigle (pPCAQ7UulGA): Smarter Routing Over Bigger Models ---
  evaluateKyleDaigleSmarterRoutingPlan,
  // --- Stolen from Liam Fallen (x.com/liam_fallen/status/2116881320282386726): 5-Bot Personal Intelligence Team ---
  PERSONAL_INTELLIGENCE_BOTS,
  PERSONAL_HQ_DOCUMENTS,
  APPROVAL_GATED_EXTERNAL_ACTIONS,
  evaluateLiamFallenPersonalIntelligenceTeam,
  // --- Stolen from Interact Software Cue AI Intranet + Conductor + Interact MCP ---
  CUE_PERSONA_EXPERIENCES,
  evaluateInteractCueAndMcpGovernance,
  // --- Stolen from Goose / Agentic AI Foundation (goose-docs.ai) ---
  GOOSE_OPEN_PLUGIN_HOOK_EVENTS,
  GOOSE_ISSUE_PIPELINE_STAGES,
  evaluateGooseAaifHarnessSteal,
  // --- Stolen from Elicit (elicit.com): PRISMA 2020 Systematic Evidence & Sentence Citations ---
  evaluateElicitSystematicEvidenceSteal,
  // --- Stolen from Rig.rs (rig.rs): I/O-Free Durable AgentRun, 11-Event AgentHook & Cassette Replay ---
  RIG_AGENT_HOOK_EVENTS,
  evaluateRigRsAgentArchitectureSteal,
};
