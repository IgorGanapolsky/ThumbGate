#!/usr/bin/env node
/**
 * github-outreach.js
 * Scans recent GitHub activity for developers working with MCP (Model Context Protocol)
 * and generates targeted outreach messages pointing to the live checkout link.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveHostedBillingConfig } = require('./hosted-config');

const PRODUCT_LINK = resolveHostedBillingConfig({
  requestOrigin: 'https://rlhf-feedback-loop-production.up.railway.app',
}).appOrigin;

function runGH(args) {
  const result = spawnSync('gh', ['api', ...args], { encoding: 'utf-8' });
  if (result.status !== 0) {
    console.error(`GH API Error: ${result.stderr}`);
    return null;
  }
  return JSON.parse(result.stdout);
}

function findMCPDevelopers() {
  console.log('🔍 Scanning GitHub for recent MCP developers...');
  // Search for recent repos with MCP in the name or description
  const searchResult = runGH(['search/repositories?q=MCP+Model+Context+Protocol&sort=updated']);
  
  if (!searchResult || !searchResult.items) {
    console.log('No recent MCP activity found or API rate limited.');
    return [];
  }

  const targets = searchResult.items.slice(0, 5).map(repo => ({
    username: repo.owner.login,
    repoName: repo.name,
    repoUrl: repo.html_url
  }));

  return targets;
}

function generateOutreachScript(targets) {
  if (targets.length === 0) return;

  let report = '# 🚀 First Dollar Outreach Targets\n\nSend these DMs immediately to capture early adopters:\n\n';

  targets.forEach(t => {
    report += `### Target: @${t.username} (Author of ${t.repoName})\n`;
    report += `**DM Script:**\n`;
    report += `> "Hey @${t.username}, saw you're building with MCP on \`${t.repoName}\`. I just launched a Context Gateway that gives MCP agents 'Always-On' memory and stops them from repeating failures across sessions. Thought it might be highly relevant to your stack. Current self-serve offer is Pro at $29/mo: ${PRODUCT_LINK}"\n\n`;
  });

  const reportPath = path.join(__dirname, '../docs/OUTREACH_TARGETS.md');
  fs.writeFileSync(reportPath, report);
  console.log(`✅ Generated 5 targeted leads. Open docs/OUTREACH_TARGETS.md and send the DMs.`);
}

const targets = findMCPDevelopers();
generateOutreachScript(targets);
