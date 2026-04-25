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
      message: 'Your question about rollback rates when context changes is exactly the right one. I am looking for one AI-agent workflow to harden end-to-end this week: repeated failure, prevention rule, and proof run. If you have one workflow where context drift or rollback risk keeps showing up, I can harden that workflow for you. Worth a 15-minute diagnostic?',
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
      message: 'Your ACT-R engram work is fascinating, especially the conflict resolution for opposing facts and the decay model. I am looking for one serious AI-agent workflow to harden end-to-end this week. If your memory system has one recurring failure mode such as stale context, opposing facts, bad handoffs, or unsafe tool calls, I can turn that into a prevention rule and proof run. Open to a 15-minute diagnostic?',
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
      message: 'Your arch-create to sprint workflow is one of the most mature agent processes I have seen anyone describe. I am looking for one AI-agent workflow to harden end-to-end this week. Your workflow already has phases, review boundaries, and context risk, so it is a strong fit: pick one repeating failure and I will help turn it into an enforceable Pre-Action Check plus proof run. Worth 15 minutes?',
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
      message: 'Appreciate the kind words on the Thompson Sampling approach. You nailed the core insight: most guardrails are brittle prompt hacks that break when context shifts. I am looking for one AI-agent workflow to harden end-to-end this week: repeated failure, prevention rule, and proof run. If you have a workflow where brittle guardrails keep failing, I can harden that workflow with you. Open to a 15-minute diagnostic?',
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
