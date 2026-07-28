#!/usr/bin/env node
'use strict';

const MARKETING_AGENT_CAMPAIGN_ID = 'marketing_agent_governance_20260727';
const CAMPAIGN_ALIASES = Object.freeze({
  mg27: MARKETING_AGENT_CAMPAIGN_ID,
});
const CAMPAIGN_BUYER_ORIGIN = 'https://thumbgate-production.up.railway.app';

function campaignChannel(
  channel,
  permalink,
  medium,
  content = null,
  campaignId = MARKETING_AGENT_CAMPAIGN_ID
) {
  const buyerUrl = new URL('/go/pro', CAMPAIGN_BUYER_ORIGIN);
  buyerUrl.searchParams.set('utm_source', channel);
  buyerUrl.searchParams.set('utm_medium', medium);
  buyerUrl.searchParams.set('utm_campaign', campaignId);
  if (content) buyerUrl.searchParams.set('utm_content', content);
  return Object.freeze({
    channel,
    status: 'LIVE',
    permalink,
    trackedBuyerUrl: buyerUrl.toString(),
  });
}

const MARKETING_AGENT_CAMPAIGN = Object.freeze({
  campaignId: MARKETING_AGENT_CAMPAIGN_ID,
  aliases: ['mg27'],
  episode: {
    title: 'Marketing Agents Are Too Good Now',
    url: 'https://www.youtube.com/watch?v=U2hogriGmEw',
  },
  channels: [
    campaignChannel(
      'linkedin',
      'https://www.linkedin.com/feed/update/urn:li:share:7487654549785128960/',
      'organic_social',
      'episode_response'
    ),
    campaignChannel(
      'hashnode',
      'https://ai-agent-blog-12345.hashnode.dev/your-marketing-agent-can-publish-and-pause-ads-who-gates-the-write',
      'organic_article',
      'episode_deep_dive'
    ),
    campaignChannel(
      'bluesky',
      'https://bsky.app/profile/iganapolsky.bsky.social/post/3mro3mkmrzc2y',
      'social',
      null,
      'mg27'
    ),
    campaignChannel(
      'threads',
      'https://www.threads.com/@igorganapolsky/post/DbUMBzXDlj8',
      'social',
      null,
      'mg27'
    ),
    campaignChannel(
      'instagram',
      'https://www.instagram.com/igorganapolsky/p/DbUNjFsDQz3/',
      'organic_social',
      'episode_card'
    ),
    campaignChannel(
      'reddit',
      'https://www.reddit.com/r/SideProject/comments/1v8i0it/i_built_a_preaction_firewall_for_ai_agents_that/',
      'organic_social',
      'sideproject_build'
    ),
    campaignChannel(
      'youtube',
      'https://www.youtube.com/post/UgkxERIbGUvSgCkGQ_dx2W0nbTl5_abcF17O',
      'community_post',
      'episode_response'
    ),
  ],
});

function normalizeCampaignId(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return CAMPAIGN_ALIASES[normalized] || normalized;
}

function campaignAttributionKeys(campaign = MARKETING_AGENT_CAMPAIGN) {
  return [...new Set([
    campaign.campaignId,
    ...(campaign.aliases || []),
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function validateCampaignChannel(entry, campaign, seenChannels, seenSources) {
  const issues = [];
  const channel = String(entry.channel || '').trim().toLowerCase();
  if (!channel || seenChannels.has(channel)) {
    issues.push(`duplicate_or_missing_channel:${channel || 'unknown'}`);
  }
  seenChannels.add(channel);

  if (entry.status !== 'LIVE') {
    issues.push(`channel_not_live:${channel || 'unknown'}`);
  }

  let permalink;
  let trackedBuyerUrl;
  try {
    permalink = new URL(entry.permalink);
    trackedBuyerUrl = new URL(entry.trackedBuyerUrl);
  } catch {
    issues.push(`invalid_url:${channel || 'unknown'}`);
    return issues;
  }

  if (permalink.protocol !== 'https:') {
    issues.push(`permalink_not_https:${channel}`);
  }
  if (
    trackedBuyerUrl.protocol !== 'https:'
    || trackedBuyerUrl.origin !== CAMPAIGN_BUYER_ORIGIN
    || trackedBuyerUrl.pathname !== '/go/pro'
  ) {
    issues.push(`buyer_path_not_canonical:${channel}`);
  }

  const source = trackedBuyerUrl.searchParams.get('utm_source');
  if (source !== channel || seenSources.has(source)) {
    issues.push(`source_mismatch_or_duplicate:${channel}`);
  }
  seenSources.add(source);

  if (
    normalizeCampaignId(trackedBuyerUrl.searchParams.get('utm_campaign'))
    !== campaign.campaignId
  ) {
    issues.push(`campaign_mismatch:${channel}`);
  }
  if (!trackedBuyerUrl.searchParams.get('utm_medium')) {
    issues.push(`missing_medium:${channel}`);
  }
  return issues;
}

function validateMarketingAgentCampaign(campaign = MARKETING_AGENT_CAMPAIGN) {
  const issues = [];
  const channels = Array.isArray(campaign.channels) ? campaign.channels : [];
  const seenChannels = new Set();
  const seenSources = new Set();

  if (normalizeCampaignId(campaign.campaignId) !== MARKETING_AGENT_CAMPAIGN_ID) {
    issues.push('campaign_id_must_be_canonical');
  }
  if (campaign.episode?.url !== 'https://www.youtube.com/watch?v=U2hogriGmEw') {
    issues.push('episode_url_mismatch');
  }
  if (channels.length !== 7) {
    issues.push('expected_seven_channels');
  }
  for (const entry of channels) {
    issues.push(...validateCampaignChannel(
      entry,
      campaign,
      seenChannels,
      seenSources
    ));
  }

  return {
    ok: issues.length === 0,
    issues,
    channelCount: channels.length,
    campaignId: campaign.campaignId,
  };
}

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
  CAMPAIGN_ALIASES,
  MARKETING_AGENT_CAMPAIGN,
  MARKETING_AGENT_CAMPAIGN_ID,
  buildCreatorGrowthCampaign,
  campaignAttributionKeys,
  normalizeCampaignId,
  validateMarketingAgentCampaign,
};
