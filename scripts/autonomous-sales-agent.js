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

const path = require('node:path');
const { parseArgs, runRevenueLoop } = require('./gtm-revenue-loop');
const {
  buildClaudeWorkflowHardeningPack,
  writeClaudeWorkflowHardeningPack,
} = require('./claude-workflow-hardening-pack');
const {
  buildCursorMarketplaceRevenuePack,
  writeCursorMarketplaceRevenuePack,
} = require('./cursor-marketplace-revenue-pack');
const {
  buildGeminiCliDemandPack,
  writeGeminiCliDemandPack,
} = require('./gemini-cli-demand-pack');
const {
  buildCodexMarketplaceRevenuePack,
  writeCodexMarketplaceRevenuePack,
} = require('./codex-marketplace-revenue-pack');

function buildDependencies(overrides = {}) {
  return {
    parseArgs,
    runRevenueLoop,
    buildClaudeWorkflowHardeningPack,
    writeClaudeWorkflowHardeningPack,
    buildCursorMarketplaceRevenuePack,
    writeCursorMarketplaceRevenuePack,
    buildGeminiCliDemandPack,
    writeGeminiCliDemandPack,
    buildCodexMarketplaceRevenuePack,
    writeCodexMarketplaceRevenuePack,
    ...overrides,
  };
}

function isCliInvocation(argv = process.argv) {
  const scriptPath = argv[1];
  if (!scriptPath) {
    return false;
  }
  return path.resolve(scriptPath) === path.resolve(__filename);
}

async function main(argv = process.argv.slice(2), overrides = {}) {
  const deps = buildDependencies(overrides);
  const options = deps.parseArgs(argv);
  const { report, written } = await deps.runRevenueLoop(options);
  const claudePack = deps.buildClaudeWorkflowHardeningPack(report);
  const claudeWritten = deps.writeClaudeWorkflowHardeningPack(claudePack, options);
  const cursorPack = deps.buildCursorMarketplaceRevenuePack();
  const cursorWritten = deps.writeCursorMarketplaceRevenuePack(cursorPack, options);
  const geminiPack = deps.buildGeminiCliDemandPack(report);
  const geminiWritten = deps.writeGeminiCliDemandPack(geminiPack, options);
  const codexPack = deps.buildCodexMarketplaceRevenuePack();
  const codexWritten = deps.writeCodexMarketplaceRevenuePack(codexPack, options);

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
  if (geminiWritten.docsPath) {
    console.log(`Gemini pack updated: ${geminiWritten.docsPath}`);
  }
  if (codexWritten.docsPath) {
    console.log(`Codex pack updated: ${codexWritten.docsPath}`);
  }
  console.log(`State: ${report.directive.state} | Targets: ${report.targets.length}`);
}

if (isCliInvocation(process.argv)) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  isCliInvocation,
  main,
};
