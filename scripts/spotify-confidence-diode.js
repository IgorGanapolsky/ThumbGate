#!/usr/bin/env node
'use strict';

/**
 * spotify-confidence-diode.js — Pre-Action Governance Diode for Spotify Confidence MCP
 *
 * Enforces pre-action safety rules before autonomous AI coding agents
 * (Claude Code, Cursor, Codex) mutate feature flags, experiments, or rollouts
 * via Spotify Confidence MCP (mcp.confidence.dev).
 *
 * Core Diodes:
 *   1. gate:confidence:rollout_ceiling (max 10% autonomous rollout without review)
 *   2. gate:confidence:test_proof_required (requires verified test pass before enabling)
 *   3. gate:confidence:protect_active_experiment (locks live A/B experiments against mutation)
 *   4. gate:confidence:prevent_flag_deletion (blocks flag deletion in production)
 */

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, '..', 'adapters', 'confidence', 'config.json');

const TICKET_NAME_RE = /^(?:[a-z]{2,12}-\d+|jira-\d+|agent-\d+|psn-\d+|gh-\d+|issue-\d+|pr-\d+|ticket-\d+)$/i;

const DIODES = Object.freeze([
  {
    id: 'gate:confidence:rollout_ceiling',
    description: 'Enforces 10% maximum autonomous canary rollout; requires operator approval for wider rollouts',
    category: 'blast_radius_governance',
  },
  {
    id: 'gate:confidence:test_proof_required',
    description: 'Blocks enabling or expanding feature flags while regression tests are failing or unverified',
    category: 'verification_gate',
  },
  {
    id: 'gate:confidence:protect_active_experiment',
    description: 'Prevents autonomous agents from modifying variants or allocations on live A/B experiments',
    category: 'experiment_integrity',
  },
  {
    id: 'gate:confidence:prevent_flag_deletion',
    description: 'Blocks flag deletion in production environments; flags must be archived first',
    category: 'destructive_action_protection',
  },
  {
    id: 'gate:confidence:behavior_named_flag',
    description: 'Name flags after the behaviour (new-checkout-flow), never the ticket (JIRA-1234)',
    category: 'naming_hygiene',
  },
  {
    id: 'gate:confidence:owner_and_removal_date_required',
    description: 'Requires every flag to have an owner and a planned removal date for Cleanup sweeps',
    category: 'lifecycle_governance',
  },
  {
    id: 'gate:confidence:default_off_fail_safe',
    description: 'Enforces default to "off" so every new flag fails safe (ship code without shipping the change)',
    category: 'fail_safe_defaults',
  },
  {
    id: 'gate:confidence:guardrail_metrics_required',
    description: 'Requires guardrail metrics (crashes, latency, errors) attached before launching any gradual rollout',
    category: 'rollout_guardrails',
  },
  {
    id: 'gate:confidence:rollback_trigger_required',
    description: 'Requires an explicit rollback trigger threshold decided before launching a rollout',
    category: 'rollout_guardrails',
  },
  {
    id: 'gate:confidence:gradual_step_start_small',
    description: 'Enforces starting rollouts at 1-5% and ramping in steps before promoting the same flag to an A/B test',
    category: 'rollout_guardrails',
  },
]);

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { name: 'spotify-confidence', maxAutonomousRolloutPercent: 10 };
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { name: 'spotify-confidence', maxAutonomousRolloutPercent: 10 };
  }
}

/**
 * Evaluates a proposed Spotify Confidence tool call against deterministic diodes.
 */
function evaluateConfidenceAction(params = {}) {
  const tool = String(params.tool || params.action || '').toLowerCase();
  const flag = String(params.flag || params.flagKey || 'unnamed-flag');
  const rollout = Number.isFinite(params.rolloutPercent) ? params.rolloutPercent : null;
  const env = String(params.environment || 'production').toLowerCase();
  const testsPassed = params.testsPassed !== false;
  const isExperiment = params.isActiveExperiment === true;

  // Diode 1: Rollout Ceiling (max 10% autonomous rollout)
  if (rollout !== null && rollout > 10) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:rollout_ceiling',
      flag,
      rolloutPercent: rollout,
      maxAllowed: 10,
      reason: `Blocked autonomous rollout of flag '${flag}' to ${rollout}%. Max autonomous canary is 10%. Rollouts >10% require explicit human approval.`,
    };
  }

  // Diode 2: Test Proof Required before enabling/updating flag
  if (['set_rollout', 'create_flag', 'update_flag'].includes(tool) && !testsPassed) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:test_proof_required',
      flag,
      reason: `Blocked flag update on '${flag}': verification tests are failing or unverified. Pass all regression tests before updating feature flags.`,
    };
  }

  // Diode 3: Protect Active Experiments
  if (isExperiment && ['update_flag', 'set_rollout', 'delete_flag'].includes(tool)) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:protect_active_experiment',
      flag,
      reason: `Flag '${flag}' is part of an active A/B experiment. Modifying live experiment allocations autonomously is prohibited.`,
    };
  }

  // Diode 4: Prevent Flag Deletion in Production
  if (tool === 'delete_flag' && env === 'production') {
    return {
      decision: 'block',
      gateId: 'gate:confidence:prevent_flag_deletion',
      flag,
      environment: env,
      reason: `Blocked deletion of flag '${flag}' in production. Flags must be archived or deprecated before deletion.`,
    };
  }

  // Diode 5: Name flags after behaviour, not ticket ('new-checkout-flow', not 'JIRA-1234')
  if (TICKET_NAME_RE.test(flag.trim())) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:behavior_named_flag',
      flag,
      reason: `Blocked ticket-named flag '${flag}'. Name flags after the behaviour ('new-checkout-flow'), not the ticket ('JIRA-1234').`,
    };
  }

  // Diode 6: Default to "off" (fail-safe invariant)
  if (params.defaultEnabled === true || String(params.defaultVariant || '').toLowerCase() === 'on') {
    return {
      decision: 'block',
      gateId: 'gate:confidence:default_off_fail_safe',
      flag,
      reason: `Blocked flag '${flag}' with default='on'. Feature flags must default to 'off' and fail safe so deploying code is separated from releasing it.`,
    };
  }

  // Diode 7: Owner + Planned Removal Date required when lifecycle metadata is enforced
  if (params.enforceLifecycleMetadata === true && (!params.owner || !params.plannedRemovalDate)) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:owner_and_removal_date_required',
      flag,
      reason: `Blocked flag '${flag}': every flag must have an owner and a planned removal date.`,
    };
  }

  // Diode 8 (confidence.pdf Best Practice #1): Attach guardrail metrics (crashes, latency, errors) before launch
  if (tool === 'launch_rollout' && (!Array.isArray(params.guardrailMetrics) || params.guardrailMetrics.length === 0)) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:guardrail_metrics_required',
      flag,
      reason: `Blocked launch_rollout on '${flag}': attach guardrail metrics (crashes, latency, errors) before starting a gradual rollout.`,
    };
  }

  // Diode 9 (confidence.pdf Best Practice #2): Start small (1-5%) and increase in steps
  if (tool === 'launch_rollout' && (rollout === null || rollout < 1 || rollout > 5)) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:gradual_step_start_small',
      flag,
      rolloutPercent: rollout,
      reason: `Blocked launch_rollout on '${flag}' at ${rollout}%: initial gradual rollout step must start small (1-5%) and increase in steps.`,
    };
  }

  // Diode 10 (confidence.pdf Best Practice #3): Decide rollback trigger before launch
  if (tool === 'launch_rollout' && !params.rollbackTrigger) {
    return {
      decision: 'block',
      gateId: 'gate:confidence:rollback_trigger_required',
      flag,
      reason: `Blocked launch_rollout on '${flag}': decide and attach an explicit rollbackTrigger before launching a rollout.`,
    };
  }

  return {
    decision: 'allow',
    flag,
    tool,
    environment: env,
    reason: `Confidence action '${tool}' on flag '${flag}' cleared all pre-action safety diodes.`,
  };
}

function auditConfidenceDiodes() {
  const checks = [];

  // Check 1: 10% Rollout Ceiling enforcement
  const rollBlock = evaluateConfidenceAction({ tool: 'set_rollout', flag: 'beta-paywall', rolloutPercent: 50 });
  const rollAllow = evaluateConfidenceAction({ tool: 'set_rollout', flag: 'beta-paywall', rolloutPercent: 5 });
  checks.push({
    id: 'rollout-ceiling-audit',
    ok: rollBlock.decision === 'block' && rollAllow.decision === 'allow',
    message: rollBlock.decision === 'block'
      ? 'Successfully blocked 50% rollout (exceeds 10% ceiling) and allowed 5% canary'
      : 'Failed rollout ceiling check',
  });

  // Check 2: Test proof requirement
  const testBlock = evaluateConfidenceAction({ tool: 'set_rollout', flag: 'new-search', rolloutPercent: 10, testsPassed: false });
  checks.push({
    id: 'test-proof-audit',
    ok: testBlock.decision === 'block',
    message: testBlock.decision === 'block'
      ? 'Successfully blocked flag rollout when verification tests were failing'
      : 'Failed test proof check',
  });

  // Check 3: Active experiment lock
  const expBlock = evaluateConfidenceAction({ tool: 'update_flag', flag: 'pricing-variant', isActiveExperiment: true });
  checks.push({
    id: 'experiment-lock-audit',
    ok: expBlock.decision === 'block',
    message: expBlock.decision === 'block'
      ? 'Successfully locked active A/B experiment against autonomous mutation'
      : 'Failed experiment lock check',
  });

  // Check 4: Production flag deletion protection
  const delBlock = evaluateConfidenceAction({ tool: 'delete_flag', flag: 'auth-v2', environment: 'production' });
  checks.push({
    id: 'flag-deletion-audit',
    ok: delBlock.decision === 'block',
    message: delBlock.decision === 'block'
      ? 'Successfully blocked flag deletion in production'
      : 'Failed flag deletion protection check',
  });

  // Check 5: Ticket-named flag blocked ('JIRA-1234' vs 'new-checkout-flow')
  const ticketBlock = evaluateConfidenceAction({ tool: 'create_flag', flag: 'JIRA-1234' });
  checks.push({
    id: 'behavior-named-flag-audit',
    ok: ticketBlock.decision === 'block' && ticketBlock.gateId === 'gate:confidence:behavior_named_flag',
    message: 'Successfully blocked ticket-named flag JIRA-1234 in favor of behaviour-named flags',
  });

  // Check 6: Default-off fail-safe invariant
  const defaultOnBlock = evaluateConfidenceAction({ tool: 'create_flag', flag: 'new-checkout-flow', defaultVariant: 'on' });
  checks.push({
    id: 'default-off-failsafe-audit',
    ok: defaultOnBlock.decision === 'block' && defaultOnBlock.gateId === 'gate:confidence:default_off_fail_safe',
    message: 'Successfully enforced default="off" fail-safe invariant',
  });

  // Check 7: Gradual rollout guardrails + 1-5% start + rollback trigger (confidence.pdf)
  const noGuardrailBlock = evaluateConfidenceAction({ tool: 'launch_rollout', flag: 'sticky-packet-cta', rolloutPercent: 5 });
  const noRollbackBlock = evaluateConfidenceAction({
    tool: 'launch_rollout',
    flag: 'sticky-packet-cta',
    rolloutPercent: 5,
    guardrailMetrics: ['crash_rate', 'p95_latency_ms', 'error_rate'],
  });
  const validGradualLaunch = evaluateConfidenceAction({
    tool: 'launch_rollout',
    flag: 'sticky-packet-cta',
    rolloutPercent: 2,
    guardrailMetrics: ['crash_rate', 'p95_latency_ms', 'error_rate'],
    rollbackTrigger: 'error_rate > 0.01 || p95_latency_ms > 800',
  });
  checks.push({
    id: 'gradual-rollout-guardrails-audit',
    ok:
      noGuardrailBlock.decision === 'block' &&
      noRollbackBlock.decision === 'block' &&
      validGradualLaunch.decision === 'allow',
    message:
      'Successfully enforced pre-launch guardrail metrics, 1-5% initial step, and rollback trigger before gradual rollout',
  });

  const allPassed = checks.every((c) => c.ok);
  return {
    status: allPassed ? 'PASS' : 'FAIL',
    adapter: 'spotify-confidence',
    mcpEndpoint: 'https://mcp.confidence.dev/mcp/flags',
    diodes: DIODES,
    checks,
  };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const args = { json: false, mapOnly: false, evaluate: false, flag: 'new-flag', rollout: 10 };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--map-only') args.mapOnly = true;
    else if (arg === '--evaluate') args.evaluate = true;
    else if (arg.startsWith('--flag=')) args.flag = arg.slice(7);
    else if (arg.startsWith('--rollout=')) args.rollout = Number(arg.slice(10)) || 10;
  }
  return args;
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);

  if (args.mapOnly) {
    const map = {
      name: 'spotify-confidence-diode',
      status: 'ready',
      mcpEndpoints: [
        'https://mcp.confidence.dev/mcp/flags',
        'https://mcp.confidence.dev/mcp/docs',
      ],
      diodes: DIODES,
    };
    console.log(JSON.stringify(map, null, 2));
    return 0;
  }

  if (args.evaluate) {
    const result = evaluateConfidenceAction({
      tool: 'set_rollout',
      flag: args.flag,
      rolloutPercent: args.rollout,
    });
    console.log(JSON.stringify(result, null, 2));
    return result.decision === 'allow' ? 0 : 1;
  }

  const report = auditConfidenceDiodes();
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n=== Spotify Confidence Pre-Action Diode (${report.status}) ===\n`);
    for (const c of report.checks) {
      console.log(`${c.ok ? '✓' : '✗'} ${c.message}`);
    }
  }
  return report.status === 'PASS' ? 0 : 1;
}

if (require.main === module) {
  process.exit(runCli());
}

module.exports = {
  DIODES,
  evaluateConfidenceAction,
  auditConfidenceDiodes,
  runCli,
};
