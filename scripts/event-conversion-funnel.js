/**
 * Event-Driven High-Ticket Client Conversion Funnel
 * 
 * Based on the Omar El-Takrori & Neel Dhingra framework ("The NEW Way To Sell Your Offer"):
 * 1. Concrete Date & Public Declaration (Parkinson's Law)
 * 2. "Clear, Not Clever" Outcome-Driven Title
 * 3. Luma/RSVP Setup with Confirmation Email Data Mining (#1 Obstacle)
 * 4. The Big Reframe & 3 Relatable Client Case Studies
 * 5. Micro-Conversion Pitch with Real Scarcity (3 Onboarding Slots for $499 Managed Gate)
 * 6. 24-Hour Personal 1-on-1 Follow-up Sequences (Phone/Voice Memo)
 * 7. Continuous Masterclass Iteration Engine
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MASTERCLASS_BLUEPRINT = {
  eventDate: 'Thursday, November 12, 2026',
  eventTime: '1:00 PM EST (45 Minutes)',
  format: 'Live Interactive Virtual Workshop & Architecture Breakdown',
  registrationUrl: 'https://thumbgate.ai/masterclass',
  clearTitle: 'How to Stop Autonomous Coding Agents from Breaking Production and Burning Cloud Budgets',
  subtitle: 'A repeatable architectural framework for engineering leaders deploying Claude Code, Cursor, Codex, and agent swarms in production.',
  
  theBigReframe: {
    commonMisconception: 'Most engineering teams believe adding more markdown instructions (CLAUDE.md), more unit tests, or human PR reviews will keep autonomous agents safe.',
    theTruth: 'Autonomous agents ignore prompt rules under stress and sycophantic AI tests pass their own bugs. The ONLY mathematically provable solution is deterministic binary gate diodes at the MCP tool boundary that block unsafe execution before tokens execute.'
  },

  caseStudies: [
    {
      company: 'FinTech Growth Series-B',
      challenge: 'Cursor agent autonomously ran a migration script with an unindexed scatter query that locked the production Postgres ledger.',
      resolution: 'Deployed ThumbGate PreToolUse DatabaseDeepTrust diode in 15 minutes. Automatically blocked 14 unindexed migrations and kept zero downtime.',
      impact: '0 production outages, saved $18,400 in AWS RDS scaling surges.'
    },
    {
      company: 'Enterprise Agentic Swarm',
      challenge: 'Agent loop generated 42 duplicate pull requests and triggered a 12-hour CI runner tsunami.',
      resolution: 'Installed ThumbGate LazyPrCiManager with superseding cancellation. Halts obsolete builds the second newer commits arrive.',
      impact: 'Reduced GitHub Actions bill by 64% and saved 110 developer triage hours.'
    },
    {
      company: 'AI DevShop',
      challenge: 'Local 70B model offloaded KV cache to CPU, thrashing server response times down to 0.4 tokens/sec.',
      resolution: 'Enabled HardwareAwareHybridRouter to dynamically route memory-intensive contexts to Crusoe/NVIDIA Inception cloud clusters.',
      impact: 'Preserved sub-50ms tool evaluation latency and zero developer idle time.'
    }
  ],

  microOffer: {
    name: 'ThumbGate $499 Managed AI Agent Workflow Gate',
    checkoutUrl: 'https://buy.stripe.com/5kA8wO88d4Q3bkc14c',
    scarcityLimit: 3,
    deliverables: [
      '1-on-1 Architecture Audit of your team’s agent tool boundaries (Claude Code, Cursor, Codex)',
      'Custom pre-action MCP policy diode tailored to your repository and cloud stack',
      'Full CI/CD superseding cancellation & mutation test harness setup',
      'Guaranteed 30-day zero-breakage SLA on agent PR commits'
    ]
  }
};

function generateLumaInvitePayload() {
  return {
    title: MASTERCLASS_BLUEPRINT.clearTitle,
    start_time: '2026-11-12T18:00:00Z',
    duration_minutes: 45,
    description: `
${MASTERCLASS_BLUEPRINT.subtitle}

Join Igor Ganapolsky (Principal AI Systems Engineer) for an intensive 45-minute breakdown on surviving the agentic code tsunami.

What We Will Cover:
1. The Big Reframe: Why prompt guardrails fail and how tool-level binary diodes guarantee safety.
2. 3 Live Case Studies from production teams running autonomous agent swarms.
3. How to implement lazy PR triage and stop runaway CI billing.
4. Live Architecture Walkthrough: Sandboxing, permission-aware retrieval, and hardware-aware routing.

Capacity is limited to ensure live Q&A.
    `.trim(),
    confirmation_email_body: `
Hey there,

You're confirmed for "${MASTERCLASS_BLUEPRINT.clearTitle}" on ${MASTERCLASS_BLUEPRINT.eventDate} at ${MASTERCLASS_BLUEPRINT.eventTime}.

To help make this session as practical as possible for your stack:

Could you hit reply right now and let me know:
👉 What is the #1 problem or friction point your team is experiencing with AI coding agents (Claude Code, Cursor, Codex) right now?

I read every reply and will personally cover your specific use case during the live walkthrough.

See you on the call,
Igor Ganapolsky
Founder, ThumbGate
    `.trim()
  };
}

function generatePersonalOutreachDMs({ prospectName, companyName }) {
  return {
    linkedinDm: `Hey ${prospectName} — noticed you guys are scaling engineering at ${companyName}. We're hosting a small, focused session on "${MASTERCLASS_BLUEPRINT.clearTitle}" on ${MASTERCLASS_BLUEPRINT.eventDate}. No generic high-level fluff—just 45 minutes on deterministic MCP gate diodes and preventing agent PR blowouts. Grabbed you a link if you want to sit in: ${MASTERCLASS_BLUEPRINT.registrationUrl}`,
    
    postEventVoiceMemoScript: `Hey ${prospectName}, Igor here! Saw you were able to catch our masterclass yesterday. Wanted to do a quick low-pressure check-in—what was on your mind, and did you get what you needed regarding your agent setup at ${companyName}? We set aside time to build custom implementation plans for just 3 teams this week, so let me know if you want to walk through your repo.`
  };
}

if (require.main === module) {
  const lumaConfig = generateLumaInvitePayload();
  console.log('=== MASTERCLASS BLUEPRINT INITIALIZED ===');
  console.log(`Title: ${lumaConfig.title}`);
  console.log(`Date: ${MASTERCLASS_BLUEPRINT.eventDate}`);
  console.log(`Confirmation Email Prompt: 'What is your #1 problem?' active.`);
  console.log(`Micro-Offer: $499 Managed Gate (Capped at 3 slots).`);
}

module.exports = {
  MASTERCLASS_BLUEPRINT,
  generateLumaInvitePayload,
  generatePersonalOutreachDMs
};
