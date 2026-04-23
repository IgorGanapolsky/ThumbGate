#!/usr/bin/env node
'use strict';

const { buildUTMLink } = require('./utm');
const { publishInstagramThumbGate } = require('./publish-instagram-thumbgate');
const {
  getConnectedAccounts,
  groupAccountsByPlatform,
  publishPost,
  schedulePost,
} = require('./publishers/zernio');
const { THUMBGATE_CAPTION } = require('./instagram-thumbgate-post');
const { resolveHostedBillingConfig } = require('../hosted-config');

const APP_ORIGIN = resolveHostedBillingConfig({
  requestOrigin: 'https://thumbgate-production.up.railway.app',
}).appOrigin;
const DEFAULT_TIMEZONE = 'America/New_York';
const LAUNCH_CAMPAIGN = 'first_customer_push';
const DEFAULT_LAUNCH_PLATFORMS = ['twitter', 'linkedin', 'instagram'];

function parseArgs(argv = []) {
  const options = {
    dryRun: false,
    platforms: [],
    schedule: '',
    timezone: DEFAULT_TIMEZONE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (token.startsWith('--platforms=')) {
      options.platforms = token
        .slice('--platforms='.length)
        .split(',')
        .map((platform) => platform.trim())
        .filter(Boolean);
      continue;
    }

    if (token === '--platforms' && argv[index + 1]) {
      options.platforms = String(argv[index + 1])
        .split(',')
        .map((platform) => platform.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }

    if (token.startsWith('--schedule=')) {
      options.schedule = token.slice('--schedule='.length).trim();
      continue;
    }

    if (token === '--schedule' && argv[index + 1]) {
      options.schedule = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (token.startsWith('--timezone=')) {
      options.timezone = token.slice('--timezone='.length).trim() || DEFAULT_TIMEZONE;
      continue;
    }

    if (token === '--timezone' && argv[index + 1]) {
      options.timezone = String(argv[index + 1]).trim() || DEFAULT_TIMEZONE;
      index += 1;
    }
  }

  return options;
}

function buildLandingUrl(platform, content) {
  return buildUTMLink(`${APP_ORIGIN}/`, {
    source: platform,
    medium: 'organic_social',
    campaign: LAUNCH_CAMPAIGN,
    content,
  });
}

function buildPlatformPost(platform) {
  const normalized = String(platform || '').trim().toLowerCase();

  if (normalized === 'twitter' || normalized === 'x') {
    return [
      'Claude Code kept repeating the same mistakes across sessions.',
      'ThumbGate turns thumbs-down feedback into a prevention rule that blocks the same pattern next time.',
      'Local-first. Free path. Pro trial.',
      buildLandingUrl('x', 'launch_post_twitter'),
    ].join(' ');
  }

  if (normalized === 'linkedin') {
    return [
      'AI coding agents do not reliably learn from your repo-level pain.',
      'That is the problem I kept hitting with Claude Code and Cursor: the same broken config, import, or workflow mistake would come back in the next session.',
      'ThumbGate turns thumbs-down feedback into a prevention rule and blocks the same pattern before the next tool call lands.',
      'Local-first. Free path. Pro adds the personal dashboard, DPO export, and a check debugger.',
      buildLandingUrl('linkedin', 'launch_post_linkedin'),
    ].join(' ');
  }

  if (normalized === 'instagram') {
    return `${THUMBGATE_CAPTION}\n\n${buildLandingUrl('instagram', 'launch_post_instagram')}`;
  }

  if (normalized === 'reddit') {
    return [
      'I built ThumbGate after watching Claude Code repeat the same repo mistakes across sessions.',
      'It turns thumbs-down feedback into a prevention rule so the same pattern gets blocked next time.',
      'Free local path, no cloud account required.',
      buildLandingUrl('reddit', 'launch_post_reddit'),
    ].join(' ');
  }

  return [
    'ThumbGate turns AI coding-agent feedback into enforced prevention rules so the same mistake gets blocked in the next session.',
    'Local-first. Free path. Pro adds the personal dashboard and DPO export.',
    buildLandingUrl(normalized || 'zernio', `launch_post_${normalized || 'generic'}`),
  ].join(' ');
}

function buildCampaignEntries() {
  return [
    {
      slug: 'proof_pack',
      posts: {
        twitter: [
          'AI coding agents do not need more hype. They need proof-backed workflow hardening.',
          'ThumbGate turns thumbs-down feedback into a prevention rule that blocks the same mistake next session.',
          'Proof pack:',
          buildLandingUrl('x', 'campaign_proof_pack'),
        ].join(' '),
        linkedin: [
          'Workflow hardening beats generic AI hype.',
          'ThumbGate captures failure signals, promotes them into prevention rules, and blocks the same bad pattern before the next tool call executes.',
          'This is about one workflow becoming safe enough to ship, not abstract "agent memory."',
          buildLandingUrl('linkedin', 'campaign_proof_pack'),
        ].join(' '),
        instagram: `${THUMBGATE_CAPTION}\n\nProof-backed workflow hardening.\n\n${buildLandingUrl('instagram', 'campaign_proof_pack')}`,
        tiktok: `Your AI agent has amnesia. Give it memory that survives restarts.\n\nThumbGate: proof-backed workflow hardening for coding agents.\n\n#AIAgents #DeveloperTools #ClaudeCode #ThumbGate`,
        youtube: `Your AI agent has amnesia. Give it memory that survives restarts.\n\nThumbGate turns thumbs-down feedback into prevention rules that block mistakes permanently.\n\n${buildLandingUrl('youtube', 'campaign_proof_pack')}`,
      },
    },
    {
      slug: 'free_local',
      posts: {
        twitter: [
          'The free path is the point.',
          'ThumbGate runs local-first, keeps lesson state in .thumbgate, and blocks repeated coding-agent mistakes without a cloud account.',
          buildLandingUrl('x', 'campaign_free_local'),
        ].join(' '),
        linkedin: [
          'Most AI tooling tries to sell a hosted layer first. ThumbGate does not.',
          'The free local path gives you feedback capture, prevention rules, and blocking on your machine. Pro adds the personal dashboard and exports when the workflow is already valuable.',
          buildLandingUrl('linkedin', 'campaign_free_local'),
        ].join(' '),
        instagram: [
          'Your AI coding agent forgets everything between sessions.',
          'ThumbGate keeps the feedback loop local, durable, and enforceable.',
          buildLandingUrl('instagram', 'campaign_free_local'),
        ].join('\n\n'),
        tiktok: `Free and local-first. ThumbGate blocks repeated AI coding mistakes without a cloud account.\n\nnpx thumbgate init\n\n#FreeDeveloperTools #AIAgents #OpenSource`,
        youtube: `ThumbGate runs local-first. No cloud account needed. Feedback capture, prevention rules, and blocking — all on your machine.\n\n${buildLandingUrl('youtube', 'campaign_free_local')}`,
      },
    },
    {
      slug: 'checkout_path',
      posts: {
        twitter: [
          'If your agent repeats the same repo mistake every week, the fix is not another prompt.',
          'ThumbGate blocks known-bad patterns before the next tool call lands.',
          'Free local path, Pro trial here:',
          buildLandingUrl('x', 'campaign_checkout_path'),
        ].join(' '),
        linkedin: [
          'Repeated agent mistakes are a systems problem, not a prompt-writing problem.',
          'ThumbGate turns explicit feedback into prevention rules and gives individual operators a paid path when they want the dashboard, exports, and check debugger.',
          buildLandingUrl('linkedin', 'campaign_checkout_path'),
        ].join(' '),
        instagram: [
          'ThumbGate turns thumbs-down feedback into a prevention rule.',
          'Next session, the same mistake gets blocked.',
          buildLandingUrl('instagram', 'campaign_checkout_path'),
        ].join('\n\n'),
        tiktok: `Stop your AI agent from repeating the same mistake. One thumbs-down = permanent block.\n\nFree to start. Pro when you need the dashboard.\n\n#ThumbGate #AIAgents #DeveloperTools`,
        youtube: `Repeated agent mistakes are a systems problem. ThumbGate blocks known-bad patterns before the next tool call executes.\n\nFree local path. Pro adds dashboard and exports.\n\n${buildLandingUrl('youtube', 'campaign_checkout_path')}`,
      },
    },
  ];
}

function defaultCampaignSchedule(now = new Date()) {
  const target = new Date(now.getTime());
  target.setDate(target.getDate() + 1);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');
  return [
    `${year}-${month}-${day}T10:15:00-04:00`,
    `${year}-${month}-${day}T14:30:00-04:00`,
    `${year}-${month}-${day}T18:45:00-04:00`,
  ];
}

async function publishLaunchCampaign(options = {}, publisher = {}) {
  const api = {
    getConnectedAccounts: publisher.getConnectedAccounts || getConnectedAccounts,
    groupAccountsByPlatform: publisher.groupAccountsByPlatform || groupAccountsByPlatform,
    publishPost: publisher.publishPost || publishPost,
    schedulePost: publisher.schedulePost || schedulePost,
    publishInstagramThumbGate: publisher.publishInstagramThumbGate || publishInstagramThumbGate,
  };

  const platforms = Array.isArray(options.platforms) && options.platforms.length > 0
    ? options.platforms
    : DEFAULT_LAUNCH_PLATFORMS;
  const schedule = String(options.schedule || '').trim();
  const timezone = String(options.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  const accounts = await api.getConnectedAccounts();
  const groupedAccounts = api.groupAccountsByPlatform(accounts);
  const results = {
    dryRun: options.dryRun === true,
    platforms,
    previews: [],
    published: [],
    scheduled: [],
    skipped: [],
    errors: [],
  };

  for (const platform of platforms) {
    const normalizedPlatform = String(platform || '').trim().toLowerCase();
    const platformAccounts = groupedAccounts.get(normalizedPlatform) || [];
    if (platformAccounts.length === 0) {
      results.skipped.push({ platform: normalizedPlatform, reason: 'not_connected' });
      continue;
    }

    const content = buildPlatformPost(normalizedPlatform);
    results.previews.push({
      platform: normalizedPlatform,
      content,
      accountCount: platformAccounts.length,
    });

    if (results.dryRun) {
      continue;
    }

    const utm = {
      source: normalizedPlatform === 'twitter' ? 'x' : normalizedPlatform,
      medium: 'organic_social',
      campaign: LAUNCH_CAMPAIGN,
    };

    try {
      if (normalizedPlatform === 'instagram') {
        if (schedule) {
          results.skipped.push({ platform: normalizedPlatform, reason: 'schedule_not_supported_for_instagram_launch' });
          continue;
        }

        const instagramResult = await api.publishInstagramThumbGate({ caption: content });
        results.published.push({ platform: normalizedPlatform, result: instagramResult });
        continue;
      }

      if (schedule) {
        const scheduledResult = await api.schedulePost(content, platformAccounts, schedule, timezone, { utm });
        results.scheduled.push({ platform: normalizedPlatform, result: scheduledResult });
      } else {
        const publishResult = await api.publishPost(content, platformAccounts, { utm });
        results.published.push({ platform: normalizedPlatform, result: publishResult });
      }
    } catch (error) {
      results.errors.push({
        platform: normalizedPlatform,
        error: error && error.message ? error.message : String(error),
      });
    }
  }

  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = await publishLaunchCampaign(options);
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  if (results.errors.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  APP_ORIGIN,
  DEFAULT_LAUNCH_PLATFORMS,
  DEFAULT_TIMEZONE,
  LAUNCH_CAMPAIGN,
  buildCampaignEntries,
  buildLandingUrl,
  buildPlatformPost,
  defaultCampaignSchedule,
  parseArgs,
  publishLaunchCampaign,
};
