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
  buildAiventyxMarketplacePlan,
  writeAiventyxMarketplaceOutputs,
} = require('./aiventyx-marketplace-plan');
const {
  buildCodexPluginRevenuePack,
  writeCodexPluginRevenuePack,
} = require('./codex-plugin-revenue-pack');
const {
  buildGeminiCliDemandPack,
  writeGeminiCliDemandPack,
} = require('./gemini-cli-demand-pack');
const {
  buildLinkedinWorkflowHardeningPack,
  writeLinkedinWorkflowHardeningPack,
} = require('./linkedin-workflow-hardening-pack');
const {
  buildChatgptGptRevenuePack,
  writeChatgptGptRevenuePack,
} = require('./chatgpt-gpt-revenue-pack');
const {
  buildCodexMarketplaceRevenuePack,
  writeCodexMarketplaceRevenuePack,
} = require('./codex-marketplace-revenue-pack');
const {
  DEFAULT_DOCS_PATH: DEFAULT_OUTREACH_DOCS_PATH,
  buildOutreachTargetsReport,
  renderOutreachTargetsMarkdown,
  writeOutreachTargetsDoc,
} = require('./github-outreach');

function buildDependencies(overrides = {}) {
  return {
    parseArgs,
    runRevenueLoop,
    buildClaudeWorkflowHardeningPack,
    writeClaudeWorkflowHardeningPack,
    buildCursorMarketplaceRevenuePack,
    writeCursorMarketplaceRevenuePack,
    buildAiventyxMarketplacePlan,
    writeAiventyxMarketplaceOutputs,
    buildGeminiCliDemandPack,
    writeGeminiCliDemandPack,
    buildLinkedinWorkflowHardeningPack,
    writeLinkedinWorkflowHardeningPack,
    buildChatgptGptRevenuePack,
    writeChatgptGptRevenuePack,
    buildCodexMarketplaceRevenuePack,
    writeCodexMarketplaceRevenuePack,
    buildCodexPluginRevenuePack,
    writeCodexPluginRevenuePack,
    buildOutreachTargetsReport,
    renderOutreachTargetsMarkdown,
    writeOutreachTargetsDoc,
    ...overrides,
  };
}

function resolveReportArtifactPath(options = {}, fileName) {
  if (!options.reportDir) {
    return '';
  }
  const repoRoot = options.repoRoot
    ? path.resolve(options.repoRoot)
    : path.resolve(__dirname, '..');
  return path.resolve(repoRoot, options.reportDir, fileName);
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
  const aiventyxPlan = deps.buildAiventyxMarketplacePlan();
  const aiventyxWritten = deps.writeAiventyxMarketplaceOutputs(aiventyxPlan, options);
  const geminiPack = deps.buildGeminiCliDemandPack(report);
  const geminiWritten = deps.writeGeminiCliDemandPack(geminiPack, options);
  const linkedinPack = deps.buildLinkedinWorkflowHardeningPack(report);
  const linkedinWritten = deps.writeLinkedinWorkflowHardeningPack(linkedinPack, options);
  const chatgptPack = deps.buildChatgptGptRevenuePack(report);
  const chatgptWritten = deps.writeChatgptGptRevenuePack(chatgptPack, options);
  const codexMarketplacePack = deps.buildCodexMarketplaceRevenuePack();
  const codexMarketplaceWritten = deps.writeCodexMarketplaceRevenuePack(codexMarketplacePack, options);
  const codexPluginPack = deps.buildCodexPluginRevenuePack(report);
  const codexPluginWritten = deps.writeCodexPluginRevenuePack(codexPluginPack, options);
  const outreachReportPath = resolveReportArtifactPath(options, 'gtm-revenue-loop.json');
  const outreachQueuePath = resolveReportArtifactPath(options, 'gtm-target-queue.jsonl');
  const shouldWriteDocs = options.writeDocs || !options.reportDir;
  let outreachDocsPath = '';

  if (outreachReportPath && outreachQueuePath) {
    const outreachReport = deps.buildOutreachTargetsReport({
      reportPath: outreachReportPath,
      queuePath: outreachQueuePath,
    });
    const outreachMarkdown = deps.renderOutreachTargetsMarkdown(outreachReport);
    outreachDocsPath = deps.writeOutreachTargetsDoc(
      outreachMarkdown,
      resolveReportArtifactPath(options, 'OUTREACH_TARGETS.md')
    );
  }

  if (shouldWriteDocs) {
    const outreachReport = deps.buildOutreachTargetsReport();
    const outreachMarkdown = deps.renderOutreachTargetsMarkdown(outreachReport);
    outreachDocsPath = deps.writeOutreachTargetsDoc(outreachMarkdown, DEFAULT_OUTREACH_DOCS_PATH);
  }

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
  if (aiventyxWritten.docsPath) {
    console.log(`Aiventyx pack updated: ${aiventyxWritten.docsPath}`);
  }
  if (geminiWritten.docsPath) {
    console.log(`Gemini pack updated: ${geminiWritten.docsPath}`);
  }
  if (linkedinWritten.docsPath) {
    console.log(`LinkedIn pack updated: ${linkedinWritten.docsPath}`);
  }
  if (chatgptWritten.docsPath) {
    console.log(`ChatGPT pack updated: ${chatgptWritten.docsPath}`);
  }
  if (codexMarketplaceWritten.docsPath) {
    console.log(`Codex marketplace pack updated: ${codexMarketplaceWritten.docsPath}`);
  }
  if (codexPluginWritten.docsPath) {
    console.log(`Codex plugin pack updated: ${codexPluginWritten.docsPath}`);
  }
  if (outreachDocsPath) {
    console.log(`Outreach targets updated: ${outreachDocsPath}`);
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
  buildDependencies,
  isCliInvocation,
  main,
  resolveReportArtifactPath,
};
