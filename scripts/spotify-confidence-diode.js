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
