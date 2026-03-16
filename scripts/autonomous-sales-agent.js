#!/usr/bin/env node
/**
 * autonomous-sales-agent.js
 * 
 * March 2026 Autonomous GTM Strategy:
 * 1. Prospecting: Scans GitHub for developers recently active with MCP (Model Context Protocol).
 * 2. Personalization: Uses an LLM to read their repo description and draft a bespoke DM.
 * 3. Outcome-Based Pitch: Pitches our "Mistake-Free" memory package, driving them to the live Stripe link.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const { resolveHostedBillingConfig } = require('./hosted-config');

const PRODUCT_LINK = resolveHostedBillingConfig({
  requestOrigin: 'https://rlhf-feedback-loop-production.up.railway.app',
}).appOrigin;

// Helper to run gh api
function runGH(args) {
  const result = spawnSync('gh', ['api', ...args], { encoding: 'utf-8' });
  if (result.status !== 0) {
    console.error(`GH API Error: ${result.stderr}`);
    return null;
  }
  return JSON.parse(result.stdout);
}

// Phase 1: Autonomous Prospecting
function prospectTargets() {
  console.log('🤖 [Prospecting Agent] Scanning for recent MCP activity...');
  
  // Search for repositories updated recently mentioning MCP
  const searchResult = runGH(['search/repositories?q=MCP+Model+Context+Protocol&sort=updated']);
  
  if (!searchResult || !searchResult.items || searchResult.items.length === 0) {
    console.log('🤖 [Prospecting Agent] No viable targets found currently.');
    return [];
  }

  // Filter and format top 3 targets
  const targets = searchResult.items.slice(0, 3).map(repo => ({
    username: repo.owner.login,
    repoName: repo.name,
    description: repo.description || 'No description provided.',
    url: repo.html_url
  }));

  console.log(`🤖 [Prospecting Agent] Found ${targets.length} high-intent targets.`);
  return targets;
}

// Phase 2: Autonomous Personalization (using LLM)
async function generateOutreach(targets) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('🚨 GEMINI_API_KEY is missing. Cannot generate personalized outreach.');
    return [];
  }

  console.log('🤖 [Content Agent] Crafting hyper-personalized pitches based on repo data...');
  const ai = new GoogleGenAI({ apiKey });
  const messages = [];

  for (const target of targets) {
    const prompt = `
You are an expert, highly technical AI sales agent in March 2026. 
You are selling the "MCP Memory Gateway" to a developer. 
Our value proposition: We provide an 'Always-On' Context Hub that stops AI agents from repeating failures across sessions using a Thumbs-Up/Down Veto Layer.
Our Pricing: $29/mo Pro plan with auto-gate promotion, unlimited custom gates, multi-repo sync, and priority support. Link: ${PRODUCT_LINK}

Target Developer: @${target.username}
Target Repository: ${target.repoName}
Repository Description: ${target.description}

Write a very short (2-3 sentences max), highly technical direct message (DM) to this developer. 
Issue a "Live Debugging Challenge": tell them to throw their hardest repeating agent failure at our system, and if the Pro Veto Layer doesn't stop it, zero charge.
Reference their specific repo. Do not sound like a marketer. Sound like a senior engineer issuing a technical challenge.
`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });
      messages.push({
        target: target.username,
        repo: target.repoName,
        message: response.text.trim()
      });
      console.log(`🤖 [Content Agent] Drafted message for @${target.username}`);
    } catch (err) {
      console.error(`Error generating message for ${target.username}:`, err.message);
    }
  }

  return messages;
}

// Phase 3: Execution Handoff
async function executeGTM() {
  const targets = prospectTargets();
  if (targets.length === 0) return;

  const customizedMessages = await generateOutreach(targets);
  if (customizedMessages.length === 0) return;

  let report = '# 🚀 Autonomous GTM Execution Report (March 2026)\n\n';
  report += '> **Strategy:** Automated prospecting combined with LLM-driven personalized outreach to drive immediate outcome-based revenue.\n\n';
  
  customizedMessages.forEach(msg => {
    report += `## Target: @${msg.target}\n`;
    report += `- **Trigger:** Recent activity on \`${msg.repo}\`\n`;
    report += `- **Bespoke DM Script:**\n\n> ${msg.message}\n\n`;
    report += `---\n\n`;
  });

  const reportPath = path.join(__dirname, '../docs/AUTONOMOUS_GITOPS.md');
  fs.writeFileSync(reportPath, report);
  
  console.log(`\n✅ GTM Automation Complete. Open docs/AUTONOMOUS_GITOPS.md to review and dispatch the personalized campaigns.`);
}

executeGTM();
