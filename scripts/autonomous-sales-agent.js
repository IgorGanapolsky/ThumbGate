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
  main: runGitHubOutreach,
  DEFAULT_DOCS_PATH: DEFAULT_GITHUB_OUTREACH_DOCS_PATH,
  DEFAULT_QUEUE_PATH: DEFAULT_GITHUB_OUTREACH_QUEUE_PATH,
  DEFAULT_REPORT_PATH: DEFAULT_GITHUB_OUTREACH_REPORT_PATH,
} = require('./github-outreach');
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
  buildRedditDmWorkflowHardeningPack,
  writeRedditDmWorkflowHardeningPack,
} = require('./reddit-dm-workflow-hardening-pack');
const {
  buildRooSunsetDemandPack,
  writeRooSunsetDemandPack,
} = require('./roo-sunset-demand-pack');
const {
  buildCodexMarketplaceRevenuePack,
  writeCodexMarketplaceRevenuePack,
} = require('./codex-marketplace-revenue-pack');
const {
  buildMcpDirectoryRevenuePack,
  writeMcpDirectoryRevenuePack,
} = require('./mcp-directory-revenue-pack');

function buildDependencies(overrides = {}) {
  return {
    parseArgs,
    runRevenueLoop,
    runGitHubOutreach,
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
    buildRedditDmWorkflowHardeningPack,
    writeRedditDmWorkflowHardeningPack,
    buildRooSunsetDemandPack,
    writeRooSunsetDemandPack,
    buildCodexMarketplaceRevenuePack,
    writeCodexMarketplaceRevenuePack,
    buildCodexPluginRevenuePack,
    writeCodexPluginRevenuePack,
    buildMcpDirectoryRevenuePack,
    writeMcpDirectoryRevenuePack,
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

function buildGitHubOutreachJobs(written = {}, repoRoot = path.resolve(__dirname, '..')) {
  const jobs = [];

  if (written.reportDir) {
    const reportDir = path.resolve(written.reportDir);
    jobs.push({
      queuePath: path.join(reportDir, 'gtm-target-queue.jsonl'),
      reportPath: path.join(reportDir, 'gtm-revenue-loop.json'),
      outPath: path.join(reportDir, 'OUTREACH_TARGETS.md'),
    });
  }

  if (written.docsPath) {
    jobs.push({
      queuePath: path.resolve(repoRoot, DEFAULT_GITHUB_OUTREACH_QUEUE_PATH),
      reportPath: path.resolve(repoRoot, DEFAULT_GITHUB_OUTREACH_REPORT_PATH),
      outPath: path.resolve(repoRoot, DEFAULT_GITHUB_OUTREACH_DOCS_PATH),
    });
  }

  return jobs;
}

function buildPackWriteOptions(options = {}) {
  return {
    ...options,
    writeDocs: Boolean(options.writeDocs || !options.reportDir),
  };
}

async function main(argv = process.argv.slice(2), overrides = {}) {
  const deps = buildDependencies(overrides);
  const options = deps.parseArgs(argv);
  const packWriteOptions = buildPackWriteOptions(options);
  const { report, written } = await deps.runRevenueLoop(options);
  const claudePack = deps.buildClaudeWorkflowHardeningPack(report);
  const claudeWritten = deps.writeClaudeWorkflowHardeningPack(claudePack, packWriteOptions);
  const cursorPack = deps.buildCursorMarketplaceRevenuePack();
  const cursorWritten = deps.writeCursorMarketplaceRevenuePack(cursorPack, packWriteOptions);
  const aiventyxPlan = deps.buildAiventyxMarketplacePlan();
  const aiventyxWritten = deps.writeAiventyxMarketplaceOutputs(aiventyxPlan, packWriteOptions);
  const geminiPack = deps.buildGeminiCliDemandPack(report);
  const geminiWritten = deps.writeGeminiCliDemandPack(geminiPack, packWriteOptions);
  const linkedinPack = deps.buildLinkedinWorkflowHardeningPack(report);
  const linkedinWritten = deps.writeLinkedinWorkflowHardeningPack(linkedinPack, packWriteOptions);
  const chatgptPack = deps.buildChatgptGptRevenuePack(report);
  const chatgptWritten = deps.writeChatgptGptRevenuePack(chatgptPack, packWriteOptions);
  const redditPack = deps.buildRedditDmWorkflowHardeningPack(report);
  const redditWritten = deps.writeRedditDmWorkflowHardeningPack(redditPack, packWriteOptions);
  const rooPack = deps.buildRooSunsetDemandPack(report);
  const rooWritten = deps.writeRooSunsetDemandPack(rooPack, packWriteOptions);
  const codexMarketplacePack = deps.buildCodexMarketplaceRevenuePack();
  const codexMarketplaceWritten = deps.writeCodexMarketplaceRevenuePack(codexMarketplacePack, packWriteOptions);
  const codexPluginPack = deps.buildCodexPluginRevenuePack(report);
  const codexPluginWritten = deps.writeCodexPluginRevenuePack(codexPluginPack, packWriteOptions);
  const mcpDirectoryPack = deps.buildMcpDirectoryRevenuePack();
  const mcpDirectoryWritten = deps.writeMcpDirectoryRevenuePack(mcpDirectoryPack, packWriteOptions);
  const githubOutreachJobs = buildGitHubOutreachJobs(written);
  const githubOutreachWritten = githubOutreachJobs.map((job) => deps.runGitHubOutreach(job));

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
  if (redditWritten.docsPath) {
    console.log(`Reddit DM pack updated: ${redditWritten.docsPath}`);
  }
  if (rooWritten.docsPath) {
    console.log(`Roo sunset pack updated: ${rooWritten.docsPath}`);
  }
  if (codexMarketplaceWritten.docsPath) {
    console.log(`Codex marketplace pack updated: ${codexMarketplaceWritten.docsPath}`);
  }
  if (codexPluginWritten.docsPath) {
    console.log(`Codex plugin pack updated: ${codexPluginWritten.docsPath}`);
  }
  if (mcpDirectoryWritten.docsPath) {
    console.log(`MCP directory pack updated: ${mcpDirectoryWritten.docsPath}`);
  }
  for (const asset of githubOutreachWritten) {
    if (asset?.docsPath) {
      console.log(`GitHub outreach asset updated: ${asset.docsPath}`);
    }
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
  buildGitHubOutreachJobs,
  buildPackWriteOptions,
  buildDependencies,
  isCliInvocation,
  main,
};
