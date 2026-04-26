#!/usr/bin/env node
/**
 * autonomous-sales-agent.js
 *
 * Wrapper for the truth-aware GSD revenue loop:
 * 1. read the current commercial snapshot
 * 2. pick the correct motion (Pro vs Workflow Hardening Sprint)
 * 3. generate operator-ready outreach artifacts
 * Canonical app origin remains https://thumbgate-production.up.railway.app.
 */

'use strict';

const { parseArgs, runRevenueLoop } = require('./gtm-revenue-loop');
const {
  buildClaudeWorkflowHardeningPack,
  writeClaudeWorkflowHardeningPack,
} = require('./claude-workflow-hardening-pack');
const {
  buildCursorMarketplaceRevenuePack,
  writeCursorMarketplaceRevenuePack,
} = require('./cursor-marketplace-revenue-pack');

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const { report, written } = await runRevenueLoop(options);
  const claudePack = buildClaudeWorkflowHardeningPack(report);
  const claudeWritten = writeClaudeWorkflowHardeningPack(claudePack, options);
  const cursorPack = buildCursorMarketplaceRevenuePack();
  const cursorWritten = writeCursorMarketplaceRevenuePack(cursorPack, options);

  console.log('\n✅ GTM automation complete.');
  if (written.docsPath) {
    console.log(`Open ${written.docsPath} to review the operator report.`);
  }
  if (written.reportDir) {
    console.log(`Artifacts written to ${written.reportDir}.`);
  }
  if (claudeWritten.docsPath) {
    console.log(`Claude outbound pack updated: ${claudeWritten.docsPath}`);
  }
  if (cursorWritten.docsPath) {
    console.log(`Cursor pack updated: ${cursorWritten.docsPath}`);
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
