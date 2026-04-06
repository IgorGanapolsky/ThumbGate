#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { getActiveMcpProfile, getAllowedTools } = require('./mcp-policy');
const { loadGatesConfig } = require('./gates-engine');
const { loadModel, samplePosteriors } = require('./thompson-sampling');
const { analyzeCodeGraphImpact } = require('./codegraph-context');
const {
  buildPartnerStrategy,
  getPartnerActionBias,
} = require('./partner-orchestration');
const {
  evaluateDelegation,
  normalizeDelegationMode,
} = require('./delegation-runtime');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_BUNDLE_DIR = path.join(PROJECT_ROOT, 'config', 'policy-bundles');
const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

function getDefaultBundleId() {
  return process.env.THUMBGATE_POLICY_BUNDLE || 'default-v1';
}

function getBundlePath(bundleId = getDefaultBundleId()) {
  if (process.env.THUMBGATE_POLICY_BUNDLE_PATH) {
    return process.env.THUMBGATE_POLICY_BUNDLE_PATH;
  }
  // Prevent path traversal: resolve and verify result stays within bundle dir (CodeQL S2083)
  const candidate = path.resolve(DEFAULT_BUNDLE_DIR, `${bundleId}.json`);
  if (!candidate.startsWith(path.resolve(DEFAULT_BUNDLE_DIR))) {
    throw new Error(`Invalid bundle ID: path traversal detected in "${bundleId}"`);
  }
  return candidate;
}

function validateBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('Invalid policy bundle: expected object');
  }
  if (!bundle.bundleId || typeof bundle.bundleId !== 'string') {
    throw new Error('Invalid policy bundle: missing bundleId');
  }
  if (!Array.isArray(bundle.intents) || bundle.intents.length === 0) {
    throw new Error('Invalid policy bundle: intents must be a non-empty array');
  }

  bundle.intents.forEach((intent) => {
    if (!intent.id || typeof intent.id !== 'string') {
      throw new Error('Invalid policy bundle: intent id is required');
    }
    if (!RISK_LEVELS.includes(intent.risk)) {
      throw new Error(`Invalid policy bundle: unsupported risk '${intent.risk}' for intent '${intent.id}'`);
    }
    if (!Array.isArray(intent.actions) || intent.actions.length === 0) {
      throw new Error(`Invalid policy bundle: intent '${intent.id}' must define actions`);
    }
  });

  return true;
}

function loadPolicyBundle(bundleId = getDefaultBundleId()) {
  const raw = fs.readFileSync(getBundlePath(bundleId), 'utf-8');
  const parsed = JSON.parse(raw);
  validateBundle(parsed);
  return parsed;
}

function getRequiredApprovalRisks(bundle, mcpProfile) {
  const approval = bundle.approval || {};
  if (approval.profileOverrides && Array.isArray(approval.profileOverrides[mcpProfile])) {
    return approval.profileOverrides[mcpProfile];
  }
  return Array.isArray(approval.requiredRisks) ? approval.requiredRisks : ['high', 'critical'];
}

function assertKnownMcpProfile(profile) {
  getAllowedTools(profile);
  return profile;
}

function listIntents(options = {}) {
  const bundle = loadPolicyBundle(options.bundleId);
  const profile = assertKnownMcpProfile(options.mcpProfile || getActiveMcpProfile());
  const requiredRisks = getRequiredApprovalRisks(bundle, profile);
  const partnerStrategy = buildPartnerStrategy({
    partnerProfile: options.partnerProfile,
    tokenBudget: DEFAULT_TOKEN_BUDGET,
  });

  return {
    bundleId: bundle.bundleId,
    mcpProfile: profile,
    partnerProfile: partnerStrategy.profile,
    partnerStrategy: {
      verificationMode: partnerStrategy.verificationMode,
      recommendedChecks: partnerStrategy.recommendedChecks,
    },
    intents: bundle.intents.map((intent) => ({
      id: intent.id,
      description: intent.description,
      risk: intent.risk,
      actionCount: intent.actions.length,
      requiresApproval: requiredRisks.includes(intent.risk),
    })),
  };
}

/* ── Token Budget Defaults ──────────────────────────────────────── */
const DEFAULT_TOKEN_BUDGET = {
  total: 12000,
  perAction: 4000,
  contextPack: 6000,
};

function resolveTokenBudget(overrides = {}) {
  const budget = { ...DEFAULT_TOKEN_BUDGET };
  if (typeof overrides.total === 'number' && overrides.total > 0) budget.total = overrides.total;
  if (typeof overrides.perAction === 'number' && overrides.perAction > 0) budget.perAction = overrides.perAction;
  if (typeof overrides.contextPack === 'number' && overrides.contextPack > 0) budget.contextPack = overrides.contextPack;
  return budget;
}

/* ── Planning Decomposition ────────────────────────────────────── */

function decomposeActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return [];

  const phases = [];
  let currentPhase = { kind: actions[0].kind, actions: [] };

  actions.forEach((action) => {
    if (action.kind === currentPhase.kind) {
      currentPhase.actions.push(action);
    } else {
      phases.push(currentPhase);
      currentPhase = { kind: action.kind, actions: [action] };
    }
  });
  phases.push(currentPhase);

  return phases.map((phase, i) => ({
    phaseIndex: i,
    kind: phase.kind,
    parallel: phase.actions.length > 1,
    actions: phase.actions,
  }));
}

function mergeUnique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function planIntent(options = {}) {
  const bundle = loadPolicyBundle(options.bundleId);
  const profile = assertKnownMcpProfile(options.mcpProfile || getActiveMcpProfile());
  const intentId = String(options.intentId || '').trim();
  const context = String(options.context || '').trim();
  const approved = options.approved === true;
  const tokenBudget = resolveTokenBudget(options.tokenBudget);
  const delegationMode = normalizeDelegationMode(options.delegationMode);

  if (!intentId) {
    throw new Error('intentId is required');
  }

  const intent = bundle.intents.find((item) => item.id === intentId);
  if (!intent) {
    throw new Error(`Unknown intent: ${intentId}`);
  }

  const requiredRisks = getRequiredApprovalRisks(bundle, profile);
  const requiresApproval = requiredRisks.includes(intent.risk);
  const checkpointRequired = requiresApproval && !approved;
  const partnerStrategy = buildPartnerStrategy({
    partnerProfile: options.partnerProfile,
    tokenBudget,
  });
  const rankedActions = rankActions(intent.actions, {
    modelPath: options.modelPath,
    partnerStrategy,
  });
  const plannedActions = partnerStrategy.profile === 'balanced'
    ? intent.actions
    : rankedActions.ranked;
  const phases = decomposeActions(plannedActions);
  const codegraphImpact = analyzeCodeGraphImpact({
    intentId,
    context,
    repoPath: options.repoPath,
  });
  const partnerChecks = mergeUnique([
    ...partnerStrategy.recommendedChecks,
    ...codegraphImpact.verificationHints,
  ]);
  const enrichedPartnerStrategy = {
    ...partnerStrategy,
    recommendedChecks: partnerChecks,
  };
  const basePlan = {
    bundleId: bundle.bundleId,
    mcpProfile: profile,
    partnerProfile: enrichedPartnerStrategy.profile,
    generatedAt: new Date().toISOString(),
    status: checkpointRequired ? 'checkpoint_required' : 'ready',
    intent: {
      id: intent.id,
      description: intent.description,
      risk: intent.risk,
    },
    context,
    requiresApproval,
    approved,
    checkpoint: checkpointRequired
      ? {
        type: 'human_approval',
        reason: `Intent '${intent.id}' has risk '${intent.risk}' under profile '${profile}'.`,
        requiredForRiskLevels: requiredRisks,
      }
      : null,
    actions: plannedActions,
    phases,
    tokenBudget: enrichedPartnerStrategy.tokenBudget || tokenBudget,
    partnerStrategy: enrichedPartnerStrategy,
    actionScores: rankedActions.scores,
    codegraphImpact,
    killSwitches: loadGatesConfig().gates
      .filter((g) => {
        const isHighRisk = ['high', 'critical'].includes(intent.risk);
        if (isHighRisk && (g.severity === 'high' || g.severity === 'critical')) return true;

        const actionNames = plannedActions.map((a) => a.name);
        return g.trigger && actionNames.some((name) => g.trigger.toLowerCase().includes(name.toLowerCase()));
      })
      .map((g) => ({
        id: g.id,
        layer: g.layer || 'Execution',
        action: g.action,
        severity: g.severity,
      })),
  };
  const delegation = evaluateDelegation({
    delegationMode,
    plan: basePlan,
    mcpProfile: profile,
    context,
    repoPath: options.repoPath,
  });

  return {
    ...basePlan,
    executionMode: delegation.executionMode,
    delegationEligible: delegation.delegationEligible,
    delegationScore: delegation.delegationScore,
    delegationReason: delegation.delegationReason,
    delegateProfile: delegation.delegateProfile,
    handoffContract: delegation.handoffContract,
  };
}

const ACTION_CATEGORY_MAP = {
  capture_feedback: 'code_edit',
  feedback_summary: 'debugging',
  search_lessons: 'search',
  retrieve_lessons: 'search',
  search_rlhf: 'search',
  prevention_rules: 'security',
  construct_context_pack: 'architecture',
  export_dpo_pairs: 'testing',
  export_databricks_bundle: 'testing',
  context_provenance: 'search',
  evaluate_context_pack: 'pr_review',
};

function getDefaultModelPath() {
  const feedbackDir = process.env.THUMBGATE_FEEDBACK_DIR
    || path.join(PROJECT_ROOT, '.claude', 'memory', 'feedback');
  return path.join(feedbackDir, 'feedback_model.json');
}

function getPartnerActionPriority(action, partnerStrategy) {
  if (!action || !partnerStrategy || partnerStrategy.verificationMode !== 'evidence_first') {
    return 1;
  }

  if (action.name === 'construct_context_pack' || action.name === 'context_provenance') {
    return 0;
  }

  return 1;
}

function scoreActions(actions, modelPath, options = {}) {
  const partnerStrategy = options.partnerStrategy || buildPartnerStrategy({
    partnerProfile: options.partnerProfile,
  });
  const model = loadModel(modelPath || getDefaultModelPath());
  const posteriors = samplePosteriors(model);
  const partnerScore = posteriors[partnerStrategy.partnerCategory] !== undefined
    ? posteriors[partnerStrategy.partnerCategory]
    : 0.5;

  return actions.map((action, index) => {
    const category = ACTION_CATEGORY_MAP[action.name] || 'uncategorized';
    const categoryScore = posteriors[category] !== undefined ? posteriors[category] : 0.5;
    const partnerBias = getPartnerActionBias(action, partnerStrategy);
    const score = Math.max(0, Math.min(1, (categoryScore * 0.7) + (partnerScore * 0.3) + partnerBias));
    return {
      action,
      category,
      actionScore: categoryScore,
      partnerProfile: partnerStrategy.profile,
      partnerCategory: partnerStrategy.partnerCategory,
      partnerScore,
      partnerBias,
      partnerPriority: getPartnerActionPriority(action, partnerStrategy),
      score,
      index,
    };
  }).sort((a, b) => {
    if (a.partnerPriority !== b.partnerPriority) {
      return a.partnerPriority - b.partnerPriority;
    }
    return b.score - a.score || a.index - b.index;
  });
}

function rankActions(actions, options = {}) {
  const modelPath = options.modelPath || getDefaultModelPath();
  const partnerStrategy = options.partnerStrategy || buildPartnerStrategy({
    partnerProfile: options.partnerProfile,
  });
  const scored = scoreActions(actions, modelPath, { partnerStrategy });
  return {
    ranked: scored.map((s) => s.action),
    scores: scored.map((s) => ({
      name: s.action.name,
      category: s.category,
      partnerProfile: s.partnerProfile,
      partnerCategory: s.partnerCategory,
      actionScore: s.actionScore,
      partnerScore: s.partnerScore,
      partnerBias: s.partnerBias,
      partnerPriority: s.partnerPriority,
      score: s.score,
    })),
  };
}

module.exports = {
  DEFAULT_BUNDLE_DIR,
  DEFAULT_TOKEN_BUDGET,
  RISK_LEVELS,
  getDefaultBundleId,
  getBundlePath,
  validateBundle,
  loadPolicyBundle,
  getRequiredApprovalRisks,
  assertKnownMcpProfile,
  listIntents,
  planIntent,
  resolveTokenBudget,
  decomposeActions,
  ACTION_CATEGORY_MAP,
  scoreActions,
  rankActions,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const intentArg = args.find((arg) => arg.startsWith('--intent='));
  const profileArg = args.find((arg) => arg.startsWith('--profile='));
  const bundleArg = args.find((arg) => arg.startsWith('--bundle='));
  const approved = args.includes('--approved');

  if (!intentArg) {
    console.log(JSON.stringify(listIntents({
      mcpProfile: profileArg ? profileArg.replace('--profile=', '') : undefined,
      bundleId: bundleArg ? bundleArg.replace('--bundle=', '') : undefined,
    }), null, 2));
    process.exit(0);
  }

  const plan = planIntent({
    intentId: intentArg.replace('--intent=', ''),
    mcpProfile: profileArg ? profileArg.replace('--profile=', '') : undefined,
    bundleId: bundleArg ? bundleArg.replace('--bundle=', '') : undefined,
    approved,
  });
  console.log(JSON.stringify(plan, null, 2));
}
