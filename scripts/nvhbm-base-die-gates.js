'use strict';

/**
 * NVHBM Base-Die Gates — ThumbGate steal of NVIDIA's NVHBM architecture
 * (announced Aug 2026, wccftech coverage; NVIDIA NVLink Fusion blog).
 *
 * NVHBM moves the memory controller OFF the XPU and INTO the HBM base die:
 *   +30% bandwidth, -15% power, +25% freed compute-die area,
 *   and a STANDARD implementation qualified once across multiple vendors.
 *
 * ThumbGate maps each claim 1:1 onto agent governance:
 *
 *   XPU die area  -> agent context window (the scarce resource)
 *   Memory wall   -> gate decisions that bounce out to a hosted LLM round trip
 *   Base die      -> ThumbGate's local, synchronous hook layer (the data plane)
 *   HBM power     -> tokens burned on actions that should never have started
 *   Multi-vendor  -> one canonical gate policy for every harness
 *                    (Claude Code, Codex, Gemini CLI, OpenCode, Herdr, amp)
 *
 * Honesty contract: every savings number produced here is MODELED, not
 * measured. Fields are tagged { modeled: true } and carry the source so no
 * downstream page can quote them as telemetry.
 */

const path = require('node:path');

/* ------------------------------------------------------------------ *
 * 1. Base-die decision engine (synchronous, zero I/O — the "die")
 * ------------------------------------------------------------------ */

const SEVERITY_ORDER = Object.freeze({
  allow: 0,
  log: 1,
  escalate: 2,
  block: 3,
});

/**
 * Evaluate one agent action against the canonical policy.
 * Pure and synchronous: this is the point of the steal — the decision
 * happens where the data lives, not after a round trip.
 *
 * @param {object} action  { tool, target?, agent?, costUsd?, tags? }
 * @param {object} policy  canonical policy (see defaultPolicy())
 * @returns {{decision: string, ruleId: string, latencyBudgetMs: number, modeled: boolean}}
 */
function evaluateAction(action, policy) {
  if (!action || typeof action.tool !== 'string' || action.tool.length === 0) {
    return {
      decision: 'escalate',
      ruleId: 'nvhbm/malformed-action',
      reason: 'action has no tool name — fail closed',
      latencyBudgetMs: 0,
      modeled: true,
    };
  }
  const pol = policy || defaultPolicy();
  for (const rule of pol.rules) {
    if (ruleMatches(rule, action)) {
      return {
        decision: rule.decision,
        ruleId: rule.id,
        reason: rule.reason,
        latencyBudgetMs: pol.baseDie.latencyBudgetMs,
        modeled: true,
      };
    }
  }
  // Default posture from the canonical policy (fail-closed is a policy knob).
  return {
    decision: pol.baseDie.defaultDecision,
    ruleId: 'nvhbm/default-posture',
    reason: 'no rule matched; default posture applies',
    latencyBudgetMs: pol.baseDie.latencyBudgetMs,
    modeled: true,
  };
}

function ruleMatches(rule, action) {
  if (rule.tool && rule.tool !== action.tool) return false;
  if (rule.targetContains && !(action.target || '').includes(rule.targetContains)) {
    return false;
  }
  if (rule.minCostUsd != null && Number(action.costUsd || 0) < rule.minCostUsd) {
    return false;
  }
  if (rule.tag && !(action.tags || []).includes(rule.tag)) return false;
  return true;
}

/**
 * Canonical "one die, all vendors" policy. Qualified once, reused everywhere.
 */
function defaultPolicy() {
  return {
    id: 'nvhbm-canonical-v1',
    modeled: true,
    source: {
      article:
        'https://wccftech.com/nvidia-develops-custom-nvhbm-memory-for-ai-more-bandwidth-lower-power-than-hbm4e/',
      vendor:
        'https://blogs.nvidia.com/blog/nvlink-fusion-nvhbm-custom-high-bandwidth-memory/',
    },
    baseDie: {
      // Synchronous local gate budget — no LLM round trip on the decision path.
      latencyBudgetMs: 5,
      defaultDecision: 'allow',
    },
    rules: [
      {
        id: 'nvhbm/payment-consequential',
        tool: 'payment',
        decision: 'escalate',
        reason: 'money movement always escalates to a human approver',
      },
      {
        id: 'nvhbm/destructive-shell',
        tool: 'shell',
        targetContains: 'rm -rf',
        decision: 'block',
        reason: 'recursive delete is blocked at the base die',
      },
      {
        id: 'nvhbm/secret-egress',
        tool: 'http',
        tag: 'carries-secret',
        decision: 'block',
        reason: 'egress carrying a secret never leaves the perimeter',
      },
      {
        id: 'nvhbm/high-cost',
        tool: 'llm',
        minCostUsd: 1,
        decision: 'log',
        reason: 'expensive inference is logged for attribution, not blocked',
      },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * 2. Savings model (bandwidth = latency headroom, power = tokens)
 * ------------------------------------------------------------------ */

/**
 * Model what the base die saved across a batch of decisions.
 * All numbers are MODELED estimates, tagged as such.
 *
 * @param {Array<{action: object, decision: object}>} evaluations
 * @param {object} opts { tokensPerBlockedAction, p50LlmGateLatencyMs }
 */
function computeSavings(evaluations, opts) {
  const o = Object.assign(
    { tokensPerBlockedAction: 4000, p50LlmGateLatencyMs: 2200 },
    opts,
  );
  const total = evaluations.length;
  const blocked = evaluations.filter((e) => e.decision.decision === 'block');
  const escalated = evaluations.filter((e) => e.decision.decision === 'escalate');
  const local = evaluations.length; // every decision resolved synchronously

  const tokensAvoided = blocked.length * o.tokensPerBlockedAction;
  // Modeled power draw: hosted gate round trips replaced by base-die checks.
  const llmRoundTripsAvoided = blocked.length + escalated.length;
  const latencyMsP50Avoided = llmRoundTripsAvoided * o.p50LlmGateLatencyMs;

  return {
    modeled: true,
    totals: {
      actions: total,
      blocked: blocked.length,
      escalated: escalated.length,
      localDecisions: local,
    },
    savings: {
      // "power": tokens never burned on doomed actions.
      tokensAvoided,
      // "bandwidth": latency headroom returned to the agent loop.
      latencyMsAvoided: latencyMsP50Avoided,
      // "die area": context not polluted with guard prose (policy lives in the die).
      contextLinesReclaimed: total * 2, // modeled: 2 guard-prose lines per action
    },
    claims: [
      { claim: '+30% bandwidth', mappedTo: 'gate latency p50 vs hosted round trip', modeled: true },
      { claim: '-15% power', mappedTo: 'tokens avoided on blocked actions', modeled: true },
      { claim: '+25% die area', mappedTo: 'context lines reclaimed from guard prose', modeled: true },
      { claim: 'multi-vendor standard', mappedTo: 'one policy, all harness adapters', modeled: true },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * 3. Multi-vendor conformance (qualified once, shipped everywhere)
 * ------------------------------------------------------------------ */

const REGISTERED_HARNESSES = Object.freeze([
  { name: 'claude-code', surface: 'hooks/hooks.json' },
  { name: 'codex', surface: 'adapters/codex/config.toml' },
  { name: 'gemini-cli', surface: 'adapters/gemini/function-declarations.json' },
  { name: 'opencode', surface: 'adapters/opencode/opencode.json' },
  { name: 'herdr', surface: 'adapters/herdr/herdr-plugin.toml' },
  { name: 'amp', surface: 'adapters/amp/skills/thumbgate-feedback/SKILL.md' },
]);

/**
 * Report which harness adapters can consume the canonical policy today.
 * Deterministic: checks adapter surfaces exist relative to the repo root.
 */
function vendorConformanceReport(policy, repoRoot) {
  const fs = require('node:fs');
  const root = repoRoot || path.join(__dirname, '..');
  const pol = policy || defaultPolicy();
  return {
    policyId: pol.id,
    modeled: true,
    harnesses: REGISTERED_HARNESSES.map((h) => {
      const surfacePath = path.join(root, h.surface);
      let surfacePresent = false;
      try {
        surfacePresent = fs.existsSync(surfacePath);
      } catch {
        surfacePresent = false;
      }
      return {
        harness: h.name,
        surface: h.surface,
        surfacePresent,
        policySupported: surfacePresent, // a die needs a socket; no socket = not qualified
      };
    }),
  };
}

/* ------------------------------------------------------------------ *
 * CLI demo
 * ------------------------------------------------------------------ */

function isCliEntrypoint() {
  return require.main === module;
}

function main() {
  const policy = defaultPolicy();
  const actions = [
    { tool: 'payment', target: 'stripe.charge', costUsd: 12 },
    { tool: 'shell', target: 'rm -rf ./build' },
    { tool: 'http', target: 'api.example.com', tags: ['carries-secret'] },
    { tool: 'llm', target: 'qwen3.8-max', costUsd: 2.5 },
    { tool: 'read_file', target: 'README.md' },
  ];
  const evaluations = actions.map((action) => ({
    action,
    decision: evaluateAction(action, policy),
  }));
  const savings = computeSavings(evaluations);
  const conformance = vendorConformanceReport(policy);

  const report = {
    engine: 'nvhbm-base-die-gates',
    honesty: 'all savings are MODELED estimates, tagged modeled=true',
    evaluations,
    savings,
    conformance,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

if (isCliEntrypoint()) main();

module.exports = {
  SEVERITY_ORDER,
  evaluateAction,
  defaultPolicy,
  computeSavings,
  vendorConformanceReport,
  REGISTERED_HARNESSES,
  isCliEntrypoint,
};
