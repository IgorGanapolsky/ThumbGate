#!/usr/bin/env node
'use strict';

/**
 * thumbgate recover-checkout <session.json>
 *
 * CLI wrapper around scripts/checkout-recovery.js.
 *
 * Reads an abandoned Stripe checkout session snapshot (JSON), runs the
 * deterministic economics gate, emits a signed receipt into the recovery
 * ledger, and prints the recovery draft for human approval.
 *
 * Dry-run by default (approval sends nothing — see FIRST_DOLLAR_PLAYBOOK).
 * Pass --send to actually queue the draft (still requires prior explicit
 * "send it" approval through the dashboard; this flag only flips dry_run).
 */

const fs = require('node:fs');
const path = require('node:path');
const { recoverCheckout } = require(path.join(__dirname, '..', 'scripts', 'checkout-recovery.js'));

const args = process.argv.slice(2);
if (args.length === 0 || !args[0]) {
  console.error('usage: thumbgate recover-checkout <session.json> [--send]');
  process.exit(2);
}

const jsonPath = args[0];
const send = args.includes('--send');
let session;
try {
  session = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (err) {
  console.error(`checkout-recovery: cannot read session JSON from ${jsonPath}: ${err.message}`);
  process.exit(2);
}

const result = recoverCheckout(session, { dryRun: !send });

// Exit non-zero on a red gate so cron/automation can branch on it.
if (result.verdict !== 'VERIFIED') {
  console.error(JSON.stringify({ ok: false, verdict: result.verdict, gate: result.gate }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
