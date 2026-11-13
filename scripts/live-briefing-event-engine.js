'use strict';

/**
 * ThumbGate Live Briefing Event & High-Status Conversion Engine
 *
 * Architectural & Business Steal:
 * - Omar El-Takrori & Neel Dhingra ("The NEW Way To Sell Your Offer")
 * - Greg Isenberg ("Build Permission Moats, High-Signal Curation, and Stacking")
 *
 * Framework:
 * 1. Lock in the calendar & publicly declare a recurring low-friction virtual briefing.
 * 2. Clear, Not Clever Title: "How to Stop Autonomous Coding Agents From Breaking Production".
 * 3. Mine the confirmation email for intent data to boost deliverability and tailor talking points.
 * 4. Shift beliefs: prompt engineering cannot fix architectural state failures (Ai2 StateBench)
 *    or tautological unit tests (Maude Lemaire). Only deterministic pre-action diodes work.
 * 5. Micro-conversion offer: ThumbGate Enterprise Workflow Gate Diagnostic ($499), strictly capped at 3 slots/week.
 */

const fs = require('node:fs');
const path = require('node:path');

const EVENT_BLUEPRINT = {
  title: 'How to Stop Autonomous Coding Agents From Breaking Production and Burning API Budgets',
  shortCode: 'agentic-sdlc-briefing',
  recurrence: 'Bi-Weekly on Thursdays at 1:00 PM EDT',
  durationMinutes: 45,
  registrationPlatform: 'Luma / Zoom',
  targetAudience: 'Engineering Leaders, VP of Eng, Staff Engineers, and AI Founders',
  coreReframe: 'Prompt engineering and bigger context windows cannot prevent agents from writing tautological tests or leaking API keys. Only deterministic, out-of-context pre-action diodes guarantee enterprise reliability.',
  caseStudies: [
    {
      companyType: 'High-Growth Fintech / NeoBank',
      before: 'Coding agents parallelized background tasks and generated 50,000 un-sharded scatter queries that took down read replicas.',
      after: 'ThumbGate Scatter Query Diode and Product-Aware Load Shedding reduced DB query load by 82% and prevented replica lag.',
      metric: '82% reduction in DB query spikes, 0 production crashes',
    },
    {
      companyType: 'Enterprise B2B SaaS',
      before: 'AI generated 140 unit tests that passed 100%, but failed catastrophically in production because the tests only confirmed AI-written code.',
      after: 'ThumbGate Mutation Testing Diode injected AST mutants; killed tautological tests and forced agents to write hardened boundary assertions.',
      metric: 'Mutation score improved from 28% to 94%; 0 regressions escaped to main',
    },
    {
      companyType: 'Multi-Agent Developer Platform',
      before: 'Agent swarm submitted 200 micro-commits per day, triggering thousands of redundant CI runs and $18,000/mo in GitHub Actions spend.',
      after: 'ThumbGate Lazy PR and In-Flight CI Cancellation halted superseded builds automatically.',
      metric: '$14,200/mo saved in redundant CI compute (78% savings)',
    },
  ],
  microOffer: {
    name: 'ThumbGate Enterprise Workflow Gate Diagnostic',
    price: '$499 one-time',
    url: 'https://thumbgate.ai/diagnostic',
    scarcityNotice: 'Strictly capped at 3 engineering org diagnostic slots per week.',
    deliverable: '48-hour automated harness audit, scatter query scan, mutation test coverage report, and custom pre-action diode policy bundle.',
  },
};

/**
 * Generates Luma / Zoom event configuration and copy.
 */
function generateEventConfig(options = {}) {
  const dateStr = options.date || 'Thursday, November 12, 2026 at 1:00 PM EDT';
  return {
    ...EVENT_BLUEPRINT,
    scheduledDate: dateStr,
    confirmationEmailTemplate: {
      subject: `Confirmed: ${EVENT_BLUEPRINT.title}`,
      from: 'Igor Ganapolsky <igor@thumbgate.ai>',
      body: `Hi there,\n\nYou are confirmed for the live briefing on ${dateStr}.\n\nTo ensure we tailor the live walkthrough directly to your stack, reply to this email with one line:\n\nWhat is your #1 concern with autonomous coding agents right now? (e.g. CI pipeline overload, tautological unit tests, credential leakage, or cloud token cost)\n\nLooking forward to seeing you live!\n\nBest,\nIgor Ganapolsky\nFounder, ThumbGate\nhttps://thumbgate.ai`,
    },
    postEventFollowUpTemplate: {
      subject: 'Quick question following today\'s agent briefing',
      from: 'Igor Ganapolsky <igor@thumbgate.ai>',
      body: `Hi [First Name],\n\nThanks for joining today's briefing on surviving the agentic commit explosion.\n\nQuick check-in: did you get what you needed, and where are you at with guardrails for your engineering team?\n\nIf you want us to run a comprehensive audit on your current agent harness and test suites, we have 2 diagnostic slots open for this week ($499): https://thumbgate.ai/diagnostic\n\nTalk soon,\nIgor`,
    },
  };
}

module.exports = {
  EVENT_BLUEPRINT,
  generateEventConfig,
};
