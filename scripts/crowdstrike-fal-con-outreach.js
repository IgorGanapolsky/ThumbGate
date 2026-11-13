/**
 * CrowdStrike Fal.Con Europe 2026 Newsjack & Sales Outreach Dispatcher
 * 
 * Target: CISOs, VPs of Engineering, and AI Platform Architects
 * Angle: CrowdStrike spending $495M on Fiddler & Dreadnode proves that AI Agent Flight Recorders
 * and Surgical Kill Switches are the mandatory stack for 2026.
 * Offer: $499 Managed Gate Setup Sprint (3 slots available) / npx thumbgate init
 */

'use strict';

const CAMPAIGN_METADATA = {
  hook: 'CrowdStrike Fal.Con Europe 2026 ($495M for Fiddler & Dreadnode + AI Kill Switch)',
  landingPage: 'https://thumbgate.ai/compare/crowdstrike-falcon-guardian',
  checkoutUrl: 'https://buy.stripe.com/5kA8wO88d4Q3bkc14c'
};

function generateFalConExecutiveEmail({ executiveName, companyName, agentTool = 'Claude Code and Cursor' }) {
  return {
    subject: `CrowdStrike's $495M AI agent acquisitions — quick question for ${companyName}`,
    body: `Hey ${executiveName},

Did you catch George Kurtz's keynote at Fal.Con Europe in Barcelona yesterday?

CrowdStrike agreed to acquire Fiddler AI ($400M) for "agent flight recorders" and Dreadnode ($95M) for red-teaming, while unveiling a surgical "AI Kill Switch" to stop rogue agents.

Kurtz's core thesis: "Every adversary and insider can now operate like a nation state with AI agents."

If ${companyName}'s engineering team is using ${agentTool}, you don't need a multi-million-dollar enterprise SIEM project to get surgical control over agent tool calls.

With ThumbGate:
1. In-line PreToolUse binary diode (<0.5ms) intercepting file/bash/MCP calls before execution.
2. Surgical AI Kill Switch that trips rogue subagents without halting active development.
3. Immutable SHA-256 flight recorder logs ready for SOC2 & board audit.

We do a 48-hour $499 Managed Setup Sprint: we audit your repos, install the gate diodes, and deliver 100% test-verified proof with a money-back guarantee.

Detailed comparison vs the CrowdStrike enterprise approach: ${CAMPAIGN_METADATA.landingPage}
Or claim one of our 3 setup slots directly: ${CAMPAIGN_METADATA.checkoutUrl}

Worth a 15-minute sync this week?

Best,
Igor Ganapolsky
Founder, ThumbGate | Principal AI Systems Engineer`
  };
}

function generateLinkedInPost() {
  return `🚨 CrowdStrike just dropped $495 MILLION at Fal.Con Europe to buy Fiddler AI ($400M) and Dreadnode ($95M).

George Kurtz's warning:
"Every adversary, every e-crime crew, every insider, now can operate like a nation state using AI agents."

CrowdStrike's answer:
1. Fiddler AI = "Flight recorder" for agent decisions.
2. Dreadnode = Automated red-teaming across 100+ attack patterns.
3. Falcon Guardian = Surgical AI Kill Switch.

The enterprise cybersecurity market has officially validated the threat of runaway coding agents.

You don't have to wait 9 months for a six-figure SIEM contract.

We built @ThumbGate to give engineering teams:
⚡ Sub-0.5ms PreToolUse binary gate diodes
⚡ Surgical AI Kill Switch halting rogue agents mid-turn
⚡ Cryptographic SHA-256 flight recorder logs
⚡ Open-source local CLI: npx thumbgate init
⚡ $499 Managed 48-Hour Setup Sprint

Full architectural teardown: https://thumbgate.ai/compare/crowdstrike-falcon-guardian`.trim();
}

if (require.main === module) {
  console.log('=== CROWDSTRIKE FAL.CON 2026 NEWSJACK CAMPAIGN ===');
  console.log(`Hook: ${CAMPAIGN_METADATA.hook}`);
  console.log(`Comparison Page: ${CAMPAIGN_METADATA.landingPage}`);
  console.log(`Checkout URL: ${CAMPAIGN_METADATA.checkoutUrl}\n`);

  const email = generateFalConExecutiveEmail({
    executiveName: 'Alex',
    companyName: 'CloudScale Technologies',
    agentTool: 'Cursor and Claude Code'
  });

  console.log('--- SAMPLE CISO EMAIL ---');
  console.log(`Subject: ${email.subject}`);
  console.log(email.body);
  console.log('\n--- VIRAL LINKEDIN POST ---');
  console.log(generateLinkedInPost());
}

module.exports = {
  CAMPAIGN_METADATA,
  generateFalConExecutiveEmail,
  generateLinkedInPost
};
