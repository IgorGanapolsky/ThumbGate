'use strict';

/**
 * ThumbGate Agent GTM Playbook Engine
 *
 * Adopted from Pancake.ai ("Infrastructure powering your GTM factory"):
 * - Brain (ICP, Voice, Deals)
 * - Signals (Hiring, funding, agent adoption markers)
 * - Plays (Automated, high-status outreach and reviewable approval flows)
 */

const fs = require('node:fs');
const path = require('node:path');

const GTM_BRAIN = {
  icp: {
    titles: ['VP of Engineering', 'Head of AI', 'Staff Platform Engineer', 'Founder / CEO'],
    companyStages: ['YC W24 / S24 / W25 / S25', 'Series A / B AI startups', 'Enterprise Dev Tools'],
    painPoints: [
      'Autonomous coding agents parallelizing PRs and burning CI pipeline budgets',
      'AI-generated tautological unit tests escaping to main branch',
      'Secrets and API tokens leaking into LLM context',
      'Un-sharded scatter queries crashing database read replicas',
    ],
  },
  voice: {
    tone: 'Direct, empirical, concise with completeness, zero AI slop, no vanity metrics',
    antiPatterns: ['I hope this email finds you well', 'excited to announce', 'game-changing paradigm shift'],
    proofPrinciples: ['Always include verifiable receipts: test runtimes, mutation scores, cost savings percentages'],
  },
  offerings: {
    freeScanner: {
      name: 'ThumbGate Open-Source Agent Safety Index Scanner',
      command: 'npx thumbgate scan',
      price: '$0.00 / MIT',
    },
    proTier: {
      name: 'ThumbGate Pro',
      price: '$19/mo or $149/yr',
      url: 'https://thumbgate.ai/go/pro-direct',
    },
    rulePackKit: {
      name: 'ThumbGate Production Rule-Pack Kit',
      price: '$49 one-time (<$50 corporate expense limit)',
      url: 'https://thumbgate.ai/go/bundle-49',
    },
    enterpriseDiagnostic: {
      name: 'ThumbGate Enterprise Workflow Gate Diagnostic',
      price: '$499 one-time (capped at 3/week)',
      url: 'https://thumbgate.ai/diagnostic',
    },
  },
};

/**
 * Generates an automated GTM Play based on detected account signals.
 * @param {object} account
 */
function generateGtmPlay(account) {
  const signal = account.signal || 'agent_adoption';
  let subject = '';
  let body = '';

  switch (signal) {
    case 'ci_budget_spike':
      subject = `Cutting redundant CI compute from agent micro-commits at ${account.companyName}`;
      body = `Hi ${account.contactName},\n\nNoticed ${account.companyName} is aggressively shipping with autonomous coding agents. One hidden friction point we see at scale is rapid micro-commits triggering parallel CI builds and burning team Actions budgets.\n\nWe built an open-source lazy PR & in-flight cancellation diode that cuts redundant CI compute by up to 78%:\nhttps://github.com/IgorGanapolsky/ThumbGate\n\nRun the free audit locally: npx thumbgate scan\n\nIf you want our team to audit your agent pipeline directly, we have two diagnostic slots open this week: https://thumbgate.ai/diagnostic\n\nBest,\nIgor Ganapolsky\nFounder, ThumbGate`;
      break;

    case 'tautological_tests':
      subject = `Preventing AI tautological unit tests at ${account.companyName}`;
      body = `Hi ${account.contactName},\n\nWhen autonomous agents write both the code and the tests, unit tests often pass 100% while asserting only that the code runs (circular testing).\n\nWe open-sourced an AST mutation testing diode that injects systematic code mutants to verify tests actually catch regressions before merging: npx thumbgate scan\n\nHappy to share the benchmark data if relevant to your platform team.\n\nBest,\nIgor`;
      break;

    default:
      subject = `Protecting ${account.companyName}'s codebase from autonomous agent regressions`;
      body = `Hi ${account.contactName},\n\nWe built ThumbGate to solve the runtime safety gap for autonomous coding agents (Claude Code, Cursor, Codex, OpenCode).\n\nIt runs pre-action firewall diodes (<0.5ms) that block credential leaks, tautological tests, and un-sharded database queries before code reaches production.\n\nFree CLI audit: npx thumbgate scan\nLive briefing details: https://thumbgate.ai\n\nBest,\nIgor Ganapolsky\nFounder, ThumbGate`;
      break;
  }

  return {
    accountId: account.id || account.companyName,
    companyName: account.companyName,
    signal,
    subject,
    body,
    estimatedValue: '$499',
    readyForReview: true,
  };
}

module.exports = {
  GTM_BRAIN,
  generateGtmPlay,
};
