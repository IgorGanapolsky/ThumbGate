#!/usr/bin/env node
'use strict';

function warmLead({
  username,
  accountName,
  description,
  score,
  evidence,
  outreachAngle,
  reason,
  subject,
  message,
  sprintLink,
}) {
  return {
    temperature: 'warm',
    source: 'reddit',
    channel: 'reddit_dm',
    username,
    accountName,
    contactUrl: `https://www.reddit.com/user/${username}/`,
    repoName: '',
    repoUrl: '',
    description,
    stars: 0,
    updatedAt: null,
    evidence: {
      score,
      evidence: ['warm inbound engagement', ...evidence],
      outreachAngle,
    },
    selectedMotion: {
      key: 'sprint',
      label: 'Workflow Hardening Sprint',
      reason,
    },
    subject,
    message,
    cta: sprintLink,
  };
}

function getWarmOutboundTargets(sprintLink) {
  return [
    warmLead({
      username: 'Deep_Ad1959',
      accountName: 'r/cursor',
      description: 'Asked how rollback rates change when agent context shifts and highlighted context-dependent blocking risk.',
      score: 10,
      evidence: ['workflow pain named: rollback risk', 'already in DMs'],
      outreachAngle: 'Lead with rollback safety and context-drift hardening for one workflow before any generic tool pitch.',
      reason: 'Warm Reddit engager already named a repeated workflow risk, so the fastest path is a founder-led diagnostic.',
      subject: 'Your context-dependent blocking idea',
      message: 'Your question about rollback rates when context changes is exactly the right one.\n\nI am taking one paid AI-agent workflow diagnostic today. We pick one workflow where the agent keeps failing, rolling back, losing context, or making unsafe tool decisions. I trace the failure, write the prevention rule, and give you a proof-ready hardening plan.\n\nIt is $499, same-day kickoff. Want me to look at yours?',
      sprintLink,
    }),
    warmLead({
      username: 'game-of-kton',
      accountName: 'r/cursor',
      description: 'Described ACT-R engrams, conflict resolution for opposing facts, and decay-model memory tradeoffs.',
      score: 9,
      evidence: ['built serious memory systems', 'workflow pain named: stale context and conflicting facts'],
      outreachAngle: 'Lead with one recurring memory or handoff failure that can be turned into an enforceable prevention rule.',
      reason: 'Warm Reddit engager already works on advanced agent memory, so discovery should center on one repeated failure pattern.',
      subject: 'Quick question about your agent workflow',
      message: 'Your ACT-R engram work is interesting, especially conflict resolution for opposing facts and decay.\n\nI am taking one paid AI-agent workflow diagnostic today. We pick one workflow where stale context, conflicting facts, bad handoffs, or unsafe tool calls keep showing up. I trace the failure, write the prevention rule, and give you a proof-ready hardening plan.\n\nIt is $499, same-day kickoff. Want me to look at yours?',
      sprintLink,
    }),
    warmLead({
      username: 'leogodin217',
      accountName: 'r/ClaudeCode',
      description: 'Shared a mature arch-create to sprint workflow with explicit review phases and context risk.',
      score: 9,
      evidence: ['mature multi-step workflow described', 'workflow pain named: review boundaries and context risk'],
      outreachAngle: 'Lead with one repeating failure inside an already-mature workflow and offer an enforceable Pre-Action Check plus proof run.',
      reason: 'Warm Reddit engager already described a mature workflow, so the next step is a targeted diagnostic on one failure mode.',
      subject: 'Quick question about AI agent safety in your workflow',
      message: 'Your arch-create to sprint workflow is one of the more mature agent processes I have seen described.\n\nI am taking one paid AI-agent workflow diagnostic today. Your workflow already has phases, review boundaries, and context risk, so it is a strong fit: pick one repeated failure and I will turn it into an enforceable prevention rule plus proof-ready hardening plan.\n\nIt is $499, same-day kickoff. Want me to look at yours?',
      sprintLink,
    }),
    warmLead({
      username: 'Enthu-Cutlet-1337',
      accountName: 'r/ClaudeCode',
      description: 'Called the Thompson Sampling approach genuinely clever and pointed at brittle guardrails that fail under context shift.',
      score: 8,
      evidence: ['responded to adaptive-gate positioning', 'workflow pain named: brittle guardrails'],
      outreachAngle: 'Lead with one brittle-guardrail workflow and offer to harden it with adaptive gates plus a proof run.',
      reason: 'Warm Reddit engager already understands the adaptive-gate thesis, so offer one concrete workflow hardening diagnostic.',
      subject: 'Quick question about your AI coding agent setup',
      message: 'You nailed the core issue: most guardrails are brittle prompt hacks that break when context shifts.\n\nI am taking one paid AI-agent workflow diagnostic today. We pick one workflow where brittle guardrails keep failing, I trace the failure, write the prevention rule, and give you a proof-ready hardening plan.\n\nIt is $499, same-day kickoff. Want me to look at yours?',
      sprintLink,
    }),
  ];
}

function buildWarmRedditMessages(sprintLink) {
  return getWarmOutboundTargets(sprintLink)
    .filter((target) => target.source === 'reddit' && target.channel === 'reddit_dm')
    .map((target) => ({
      to: target.username,
      subject: target.subject,
      text: target.message,
    }));
}

module.exports = {
  buildWarmRedditMessages,
  getWarmOutboundTargets,
};
