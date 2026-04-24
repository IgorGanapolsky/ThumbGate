#!/usr/bin/env node
'use strict';

function buildCreatorGrowthCampaign(input = {}) {
  const appUrl = input.appUrl || 'https://thumbgate-production.up.railway.app';
  const webinarTitle = input.webinarTitle || 'Stop AI Agents From Repeating Expensive Mistakes';
  const offerCode = input.offerCode || 'AGENTGATES';
  return {
    campaignId: 'creator_webinar_agent_governance',
    channelFit: ['beehiiv', 'linkedin', 'newsletter', 'webinar', 'youtube'],
    audience: 'founders, engineering managers, AI automators, and creator-operators shipping with coding agents',
    webinar: {
      title: webinarTitle,
      promise: 'In 30 minutes, see how a thumbs-down turns into a pre-action gate that blocks the same agent mistake next time.',
      demoFlow: [
        'Show a risky agent action before ThumbGate.',
        'Capture corrective feedback with context.',
        'Regenerate the prevention rule.',
        'Replay the action and show the gate blocking it.',
        'Export the decision journal and proof report.',
      ],
      cta: `${appUrl}/#workflow-sprint-intake?utm_source=beehiiv&utm_campaign=creator_webinar_agent_governance&offer=${offerCode}`,
    },
    paywall: {
      freeMeter: 2,
      paidTrial: '$1 for 14 days',
      paidContent: [
        'Routine-ready security audit prompt',
        'CRE prompt review checklist',
        'Data Table Agent schema planner template',
        'Workspace Agent approval-policy checklist',
      ],
    },
    posts: [
      {
        platform: 'linkedin',
        text: 'AI agents are becoming scheduled coworkers. The missing layer is enforcement: approvals, evidence, rollback, and memory that blocks repeat mistakes. ThumbGate turns feedback into pre-action gates.',
      },
      {
        platform: 'newsletter',
        text: 'This week: how to stop prompting and hoping. Treat prompts as runtime programs, require evidence before tool actions, and use ThumbGate to block known-bad agent patterns.',
      },
    ],
  };
}

module.exports = {
  buildCreatorGrowthCampaign,
};

if (require.main === module) {
  console.log(JSON.stringify(buildCreatorGrowthCampaign(), null, 2));
}
