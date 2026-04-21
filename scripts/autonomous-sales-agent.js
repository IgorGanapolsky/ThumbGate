#!/usr/bin/env node
/**
 * autonomous-sales-agent.js
 *
 * Wrapper for the truth-aware GSD revenue loop:
 * 1. read the current commercial snapshot
 * 2. pick the correct motion (Pro vs Workflow Hardening Sprint)
 * 3. generate operator-ready outreach artifacts
 * Canonical app origin remains https://thumbgate.ai.
 */

'use strict';

const { parseArgs, runRevenueLoop } = require('./gtm-revenue-loop');

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const { report, written } = await runRevenueLoop(options);

  console.log('\n✅ GTM automation complete.');
  if (written.docsPath) {
    console.log(`Open ${written.docsPath} to review the operator report.`);
  }
  if (written.reportDir) {
    console.log(`Artifacts written to ${written.reportDir}.`);
  }
  console.log(`State: ${report.directive.state} | Targets: ${report.targets.length}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  main,
};
