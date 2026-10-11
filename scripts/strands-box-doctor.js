#!/usr/bin/env node
'use strict';

/**
 * Strands Box & Multi-Harness Doctor CLI
 *
 * Validates:
 * 1. Strands Box containment and Dogwood policy engine health
 * 2. Credential diode gateway (verifies secrets are injected outbound without local leak)
 * 3. Multi-harness RL invariant transfer compliance across 5 harnesses
 */

const { performance } = require('node:perf_hooks');
const { createBoxSession, evaluateBoxAction, EVENT_FS_READ, EVENT_HTTP_REQUEST, EVENT_FS_DELETE } = require('../adapters/strands/strands-box-diode');
const { normalizeToCanonicalAction, evaluateCrossHarnessInvariants, calculateTransferScorecard } = require('./multi-harness-invariants');

function runStrandsBoxDiagnostics() {
  const start = performance.now();
  const checks = [];

  // 1. Box Session Creation & Taint Tracking
  const session = createBoxSession({
    name: 'doctor-box',
    workspace: process.cwd(),
    credentialRoutes: [
      { match: 'api.stripe.com', header: 'Authorization', inject: 'Bearer sk_live_test_credential_injected' }
    ],
    rateLimits: {
      'http:request': { maxCount: 5, windowSeconds: 60 }
    }
  });

  const readVerdict = evaluateBoxAction(session, {
    type: EVENT_FS_READ,
    target: '.env.production'
  });
  checks.push({
    name: 'taint_propagation_on_secret_read',
    pass: readVerdict.allowed === true && session.isTainted === true,
    detail: `Tainted status: ${session.isTainted}, Reason: ${readVerdict.reason}`
  });

  // 2. Exfiltration Diode (Outbound blocked when tainted)
  const exfilVerdict = evaluateBoxAction(session, {
    type: EVENT_HTTP_REQUEST,
    target: 'https://malicious-leak-sink.com/collect'
  });
  checks.push({
    name: 'exfiltration_diode_blocks_tainted_egress',
    pass: exfilVerdict.allowed === false && exfilVerdict.decision === 'BLOCK',
    detail: `Verdict: ${exfilVerdict.decision}, Reason: ${exfilVerdict.reason}`
  });

  // 3. Credential Injection Diode (Placeholder replaced on allowlisted host)
  const untaintedSession = createBoxSession({
    name: 'clean-box',
    credentialRoutes: [
      { match: 'api.stripe.com', inject: 'Bearer sk_live_diode_vault_secret' }
    ]
  });
  const credVerdict = evaluateBoxAction(untaintedSession, {
    type: EVENT_HTTP_REQUEST,
    target: 'https://api.stripe.com/v1/charges',
    params: { headers: { Authorization: 'Bearer strands_placeholder_token' } }
  });
  const injectedSecret = credVerdict.transformedParams?.headers?.Authorization === 'Bearer sk_live_diode_vault_secret';
  checks.push({
    name: 'credential_injection_diode',
    pass: credVerdict.allowed === true && injectedSecret,
    detail: `Injected auth: ${credVerdict.injectedAuth}`
  });

  // 4. Critical Deletion Containment
  const deleteVerdict = evaluateBoxAction(session, {
    type: EVENT_FS_DELETE,
    target: '/'
  });
  checks.push({
    name: 'destructive_root_deletion_blocked',
    pass: deleteVerdict.allowed === false && deleteVerdict.decision === 'BLOCK',
    detail: `Verdict: ${deleteVerdict.decision}, Reason: ${deleteVerdict.reason}`
  });

  // 5. Multi-Harness Canonical Normalization
  const testTrajectory = [
    { harness: 'antigravity', toolName: 'run_command', args: { CommandLine: 'npm test' } },
    { harness: 'claude_code', toolName: 'Bash', args: { command: 'git status' } },
    { harness: 'strands', toolName: 'shell', args: { cmd: 'ls -la' } },
    { harness: 'openhands', toolName: 'execute_bash', args: { cmd: 'cargo build' } }
  ];
  const scorecard = calculateTransferScorecard(testTrajectory);
  checks.push({
    name: 'multi_harness_transfer_scorecard',
    pass: scorecard.formatSuccessRate === 1.0 && scorecard.transferReward > 0.8,
    detail: `Observed: ${scorecard.harnessesObserved.join(', ')}, Reward: ${scorecard.transferReward}`
  });

  const totalPassed = checks.filter(c => c.pass).length;
  const elapsed = performance.now() - start;

  return {
    status: totalPassed === checks.length ? 'HEALTHY' : 'DEGRADED',
    checksPassed: totalPassed,
    checksTotal: checks.length,
    elapsedMs: Number(elapsed.toFixed(3)),
    checks,
    scorecard
  };
}

if (require.main === module) {
  const isJson = process.argv.includes('--json');
  const results = runStrandsBoxDiagnostics();

  if (isJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(`\n=== Strands Box & Multi-Harness Doctor ===`);
    console.log(`Status: ${results.status} (${results.checksPassed}/${results.checksTotal} checks passed in ${results.elapsedMs}ms)\n`);
    for (const check of results.checks) {
      const mark = check.pass ? '✓' : '✖';
      console.log(`  ${mark} ${check.name.padEnd(45)} : ${check.detail}`);
    }
    console.log(`\nMulti-Harness Transfer Reward: ${results.scorecard.transferReward} (Harnesses: ${results.scorecard.harnessesObserved.join(', ')})\n`);
  }

  process.exit(results.status === 'HEALTHY' ? 0 : 1);
}

module.exports = { runStrandsBoxDiagnostics };
