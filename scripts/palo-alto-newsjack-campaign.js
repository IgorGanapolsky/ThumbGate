/**
 * Palo Alto Networks / Clutch Security $500M Acquisition Newsjack Outreach Engine
 * 
 * News Source: The Information (Nov 5, 2026)
 * "Palo Alto Networks in Talks to Pay $500 Million for AI Security Startup Clutch Security"
 * 
 * Target Buyer: CISOs, VPs of Engineering, and Platform Leaders deploying
 * Claude Code, Cursor, and Autonomous Agent Swarms.
 * 
 * Pitch: Don't wait 9 months for a $150k enterprise tool. Install deterministic
 * PreToolUse credential & tool diodes with the $499 Setup Sprint (or npx thumbgate init).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CAMPAIGN_METADATA = {
  newsHook: 'Palo Alto Networks in talks to acquire Clutch Security for $500M (The Information, Nov 5, 2026)',
  offerName: 'Managed AI Agent Workflow Gate ($499 Setup Sprint)',
  stripeCheckoutUrl: 'https://buy.stripe.com/5kA8wO88d4Q3bkc14c',
  comparisonPageUrl: 'https://thumbgate.ai/compare/palo-alto-clutch-security',
  freeDeveloperCommand: 'npx thumbgate init'
};

function generateNewsjackEmail({ recipientName, companyName, agentTool = 'Claude Code and Cursor' }) {
  return {
    subject: `Palo Alto's $500M bet on agent credentials — quick question for ${companyName}`,
    body: `Hey ${recipientName},

Saw The Information's report this morning that Palo Alto Networks is in talks to pay $500M for Clutch Security to lock down passwords and API keys used by autonomous AI agents.

The enterprise takeaway is clear: non-human agent identities (NHIs) are now the fastest-growing attack surface in production.

If ${companyName} is deploying ${agentTool}, you don't need to wait 9 months for a $150k enterprise contract to trickle down.

We run a $499 Setup Sprint with ThumbGate:
1. In-line PreToolUse binary diode configured on your repo (<0.5ms).
2. Blocks credential exfiltration, unindexed DB queries, and unauthorized file edits BEFORE execution.
3. Delivered with full regression test proof within 2 business days (100% money-back guarantee).

Here's our full architectural comparison against the $500M enterprise model: ${CAMPAIGN_METADATA.comparisonPageUrl}

Or you can grab one of our 3 onboarding slots this week directly: ${CAMPAIGN_METADATA.stripeCheckoutUrl}

Open to a 15-minute review of your team's agent boundaries this Thursday?

Best,
Igor Ganapolsky
Founder, ThumbGate | Principal AI Systems Engineer`
  };
}

function generateSocialPost() {
  return `🚨 Palo Alto Networks is reportedly in talks to buy Clutch Security for $500 MILLION (The Information).

Why? Because autonomous AI agents (Claude Code, Cursor, Codex) are executing tools, reading .env files, and making commits with production credentials—and legacy IAM can't see it.

The enterprise playbook will charge $150k/yr to monitor tokens after they leak.

We built @ThumbGate to stop the action BEFORE tokens execute:
⚡ Deterministic PreToolUse binary diode (<0.5ms)
⚡ Zero network latency, native MCP support
⚡ Open-source developer tier (npx thumbgate init) + $499 Managed Sprint

Read the breakdown: https://thumbgate.ai/compare/palo-alto-clutch-security`.trim();
}

if (require.main === module) {
  console.log('=== PALO ALTO NETWORKS $500M NEWSJACK CAMPAIGN ===');
  console.log(`News Hook: ${CAMPAIGN_METADATA.newsHook}`);
  console.log(`Landing Page: ${CAMPAIGN_METADATA.comparisonPageUrl}`);
  console.log(`Checkout URL: ${CAMPAIGN_METADATA.stripeCheckoutUrl}\n`);
  
  const sampleEmail = generateNewsjackEmail({
    recipientName: 'David',
    companyName: 'FinTech AI Corp',
    agentTool: 'Cursor and Claude Code'
  });
  
  console.log('--- SAMPLE EMAIL ---');
  console.log(`Subject: ${sampleEmail.subject}`);
  console.log(sampleEmail.body);
  console.log('\n--- SOCIAL POST ---');
  console.log(generateSocialPost());
}

module.exports = {
  CAMPAIGN_METADATA,
  generateNewsjackEmail,
  generateSocialPost
};
