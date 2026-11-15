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
      key: 'pro',
      label: 'ThumbGate Pro',
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
      reason: 'Warm Reddit engager already named a repeated workflow risk, so offer the free local CLI guide and current self-serve Pro plans.',
      subject: 'Your context-dependent blocking idea',
      message: 'I build ThumbGate. Your comments about agent reliability are relevant to its local guardrails. Start with the free CLI to configure and verify your own pre-action rules. Self-serve Pro adds recall, dashboard, adapters, and exports; it does not include a diagnostic or implementation service. Compare current plans at https://thumbgate.ai/pricing.',
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
      message: 'I build ThumbGate. Your comments about agent reliability are relevant to its local guardrails. Start with the free CLI to configure and verify your own pre-action rules. Self-serve Pro adds recall, dashboard, adapters, and exports; it does not include a diagnostic or implementation service. Compare current plans at https://thumbgate.ai/pricing.',
      sprintLink,
    }),
    warmLead({
      username: 'leogodin217',
      accountName: 'r/ClaudeCode',
      description: 'Shared a mature arch-create to sprint workflow with explicit review phases and context risk.',
      score: 9,
      evidence: ['mature multi-step workflow described', 'workflow pain named: review boundaries and context risk'],
      outreachAngle: 'Lead with one repeating failure inside an already-mature workflow and show how to configure and verify a local pre-action rule.',
      reason: 'Warm Reddit engager already described a mature workflow, so offer the free local CLI and self-serve Pro plans.',
      subject: 'Quick question about AI agent safety in your workflow',
      message: 'I build ThumbGate. Your comments about agent reliability are relevant to its local guardrails. Start with the free CLI to configure and verify your own pre-action rules. Self-serve Pro adds recall, dashboard, adapters, and exports; it does not include a diagnostic or implementation service. Compare current plans at https://thumbgate.ai/pricing.',
      sprintLink,
    }),
    warmLead({
      username: 'Enthu-Cutlet-1337',
      accountName: 'r/ClaudeCode',
      description: 'Called the Thompson Sampling approach genuinely clever and pointed at brittle guardrails that fail under context shift.',
      score: 8,
      evidence: ['responded to adaptive-gate positioning', 'workflow pain named: brittle guardrails'],
      outreachAngle: 'Lead with one brittle-guardrail workflow and show how to configure and verify local adaptive gates.',
      reason: 'Warm Reddit engager already understands the adaptive-gate thesis, so offer current self-serve tooling.',
      subject: 'Quick question about your AI coding agent setup',
      message: 'I build ThumbGate. Your comments about agent reliability are relevant to its local guardrails. Start with the free CLI to configure and verify your own pre-action rules. Self-serve Pro adds recall, dashboard, adapters, and exports; it does not include a diagnostic or implementation service. Compare current plans at https://thumbgate.ai/pricing.',
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
