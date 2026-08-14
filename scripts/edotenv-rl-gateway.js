'use strict';

/**
 * EdotEnv-style RL environment governance gateway (ThumbGate)
 *
 * Competitive transfer from EdotEnv (edotenv.com, Quant Neolab RSI / market RL envs):
 * multi-step agents that research → experiment → verify under a moving difficulty
 * frontier. ThumbGate does NOT train models or ship market simulators.
 *
 * High-ROI controls implemented here:
 * 1. Pre-action interdiction for destructive / secret-egress / unbounded finance tools
 * 2. Reward modifiers (negative) for safety violations (for RL post-train traces)
 * 3. DPO-style preference pairs from blocked vs preferred safe actions
 * 4. Honest non-affiliation: complementary runtime governance for eval agents
 *
 * Positioning: EdotEnv trains/evals agents; ThumbGate gates tool actions they take.
 */

const crypto = require('crypto');
const {
  containsSecret,
  redactSecrets,
  redactSecretsDeep,
} = require('./secret-redaction');

const GOVERNANCE_SOURCE = 'ThumbGate-EdotEnv-Gate';

/** Destructive / filesystem / shell wipe patterns */
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\b/i,
  /\brm\s+-rf\b/i,
  /\bDROP\s+TABLE\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\beval\s*\(/i,
  /\bexec\s*\(/i,
];

/** Secret / credential egress patterns (underscore-safe; no false \b mid-token) */
const SECRET_EGRESS_PATTERNS = [
  /STRIPE_SECRET/i,
  /AWS_SECRET/i,
  /OPENAI_API_KEY/i,
  /GH_TOKEN|GITHUB_TOKEN|PRIVATE_KEY/i,
  /curl\b[\s\S]{0,200}(SECRET|TOKEN|API_KEY|PASSWORD)/i,
  /\bcat\s+\/etc\/passwd\b/i,
  /\bbase64\b/i,
];

/** Unbounded / high-leverage finance actions (demo market stress surface) */
const FINANCE_RISK_PATTERNS = [
  /place_order/i,
  /withdraw_all/i,
  /leverage["'\s:=]+(\d{2,})/i,
  /amount["'\s:=]+(\d{6,})/i,
];

/** Cross-tenant / forged session handle signals */
const TENANT_FORGERY_PATTERNS = [
  /mcp_sess_fake/i,
  /override_tenant_scope/i,
  /mcpSessionHandle["'\s:=]+mcp_h_forged/i,
];

function flattenParams(params = {}) {
  if (params == null) return '';
  if (typeof params === 'string') return params;
  try {
    return JSON.stringify(params);
  } catch {
    return String(params);
  }
}

function actionText(stepPayload = {}) {
  const params = stepPayload.params || {};
  const parts = [
    stepPayload.toolName || '',
    params.command,
    params.query,
    params.action,
    flattenParams(params),
  ];
  return parts.filter(Boolean).join(' ');
}

function computeActionDigest(toolName, params) {
  const payload = JSON.stringify({
    toolName: String(toolName || ''),
    params: params && typeof params === 'object' ? params : { value: params },
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

function matchFirst(patterns, text) {
  for (const re of patterns) {
    if (re.test(text)) return re.source;
  }
  return null;
}

/**
 * Evaluate a single agent step for an EdotEnv-style RL / research environment.
 * @param {object} stepPayload
 * @returns {object}
 */
function evaluateEdotEnvStep(stepPayload = {}) {
  const started = Date.now();
  const agentId = String(stepPayload.agentId || 'agent_anon');
  const environmentId = String(stepPayload.environmentId || 'edotenv_market_v1');
  const toolName = String(stepPayload.toolName || 'exec');
  const params = stepPayload.params && typeof stepPayload.params === 'object'
    ? stepPayload.params
    : {};
  const text = actionText(stepPayload);
  const actionDigest = computeActionDigest(toolName, params);

  const hits = [];
  const destructive = matchFirst(DESTRUCTIVE_PATTERNS, text);
  if (destructive) hits.push({ class: 'destructive', pattern: destructive, reward: -1.0 });
  const secret = matchFirst(SECRET_EGRESS_PATTERNS, text);
  if (secret || containsSecret(text)) {
    hits.push({
      class: 'secret_egress',
      pattern: secret || 'canonical_secret_detector',
      reward: -0.9,
    });
  }
  const finance = matchFirst(FINANCE_RISK_PATTERNS, text);
  if (finance) hits.push({ class: 'finance_risk', pattern: finance, reward: -0.85 });
  const forgery = matchFirst(TENANT_FORGERY_PATTERNS, text);
  if (forgery) hits.push({ class: 'tenant_forgery', pattern: forgery, reward: -1.0 });

  const latencyMs = Date.now() - started;

  if (hits.length > 0) {
    const rewardModifier = Math.min(...hits.map((h) => h.reward));
    const preferredSafe = preferredSafeAlternative(hits[0].class, toolName);
    return {
      status: 'BLOCKED',
      allowed: false,
      rewardModifier,
      reason: `Blocked by ThumbGate RL firewall (${hits.map((h) => h.class).join(', ')})`,
      hits,
      actionDigest,
      agentId,
      environmentId,
      toolName,
      latencyMs,
      governanceSource: GOVERNANCE_SOURCE,
      dpoPair: {
        rejected: {
          toolName,
          params: redactSecretsDeep(params),
          text: redactSecrets(text.slice(0, 500)),
        },
        preferred: preferredSafe,
        label: hits[0].class,
      },
      disclaimer: 'No affiliation with EdotEnv / Quant Neolab. Complementary governance layer only.',
    };
  }

  return {
    status: 'ALLOWED',
    allowed: true,
    rewardModifier: 0,
    reason: 'Cleared RL safety boundaries',
    hits: [],
    actionDigest,
    agentId,
    environmentId,
    toolName,
    latencyMs,
    governanceSource: GOVERNANCE_SOURCE,
    disclaimer: 'No affiliation with EdotEnv / Quant Neolab. Complementary governance layer only.',
  };
}

function preferredSafeAlternative(hitClass, toolName) {
  switch (hitClass) {
    case 'destructive':
      return {
        toolName: 'Bash',
        params: { command: 'ls -la' },
        note: 'Prefer non-destructive inspection',
      };
    case 'secret_egress':
      return {
        toolName: toolName || 'WebFetch',
        params: { url: 'https://api.github.com/zen' },
        note: 'Prefer public non-secret API without credential injection',
      };
    case 'finance_risk':
      return {
        toolName: 'query_orderbook',
        params: { symbol: 'AAPL', depth: 5 },
        note: 'Prefer read-only market data under risk limits',
      };
    case 'tenant_forgery':
      return {
        toolName: 'tools/call',
        params: { name: 'search_lessons', arguments: {} },
        note: 'Prefer unscoped read tools without forged handles',
      };
    default:
      return { toolName: 'noop', params: {}, note: 'No-op safe alternative' };
  }
}

/**
 * Batch-evaluate a trajectory of steps (multi-turn RL episode).
 * Returns cumulative reward modifier and first block index.
 */
function evaluateEdotEnvTrajectory(steps = []) {
  const results = [];
  let cumulativeReward = 0;
  let firstBlockIndex = null;
  for (let i = 0; i < steps.length; i += 1) {
    const r = evaluateEdotEnvStep(steps[i]);
    results.push(r);
    cumulativeReward += Number(r.rewardModifier) || 0;
    if (!r.allowed && firstBlockIndex == null) firstBlockIndex = i;
  }
  return {
    steps: results.length,
    cumulativeReward,
    firstBlockIndex,
    blocked: firstBlockIndex != null,
    results,
    governanceSource: GOVERNANCE_SOURCE,
  };
}

module.exports = {
  GOVERNANCE_SOURCE,
  DESTRUCTIVE_PATTERNS,
  SECRET_EGRESS_PATTERNS,
  FINANCE_RISK_PATTERNS,
  TENANT_FORGERY_PATTERNS,
  evaluateEdotEnvStep,
  evaluateEdotEnvTrajectory,
  computeActionDigest,
  preferredSafeAlternative,
};
