#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildUTMLink } = require('./utm');
const { publishInstagramThumbGate } = require('./publish-instagram-thumbgate');
const {
  getConnectedAccounts,
  groupAccountsByPlatform,
  publishPost,
  schedulePost,
  uploadLocalMedia,
} = require('./publishers/zernio');
const { THUMBGATE_CAPTION } = require('./instagram-thumbgate-post');
const { resolveHostedBillingConfig } = require('../hosted-config');

const REPO_ROOT = path.resolve(__dirname, '../..');
const APP_ORIGIN = resolveHostedBillingConfig({
  requestOrigin: 'https://thumbgate-production.up.railway.app',
}).appOrigin;
const DEFAULT_TIMEZONE = 'America/New_York';
const LAUNCH_CAMPAIGN = 'first_customer_push';
const OPERATOR_LAB_CAMPAIGN = 'operator_lab_launch';
const SKOOL_OPERATOR_LAB_URL = 'https://www.skool.com/thumbgate-operator-lab-6000';
const DEFAULT_LAUNCH_PLATFORMS = ['linkedin', 'instagram', 'threads', 'bluesky', 'reddit', 'youtube'];
const OPERATOR_LAB_MEDIA_PATHS = {
  landscape: path.join(REPO_ROOT, 'docs/marketing/assets/thumbgate-operator-lab-social-landscape.png'),
  square: path.join(REPO_ROOT, 'docs/marketing/assets/thumbgate-operator-lab-social-square.png'),
  verticalVideo: path.join(REPO_ROOT, 'docs/marketing/assets/thumbgate-operator-lab-explainer-vertical.mp4'),
};

function parseArgs(argv = []) {
  const options = {
    dryRun: false,
    platforms: [],
    schedule: '',
    timezone: DEFAULT_TIMEZONE,
    offer: 'launch',
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
      continue;
    }

    if (token.startsWith('--offer=')) {
      options.offer = token.slice('--offer='.length).trim() || 'launch';
      continue;
    }

    if (token === '--offer' && argv[index + 1]) {
      options.offer = String(argv[index + 1]).trim() || 'launch';
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

function buildOperatorLabUrl(platform, content) {
  return buildUTMLink(SKOOL_OPERATOR_LAB_URL, {
    source: platform,
    medium: 'community_course',
    campaign: OPERATOR_LAB_CAMPAIGN,
    content,
  });
}

function buildOperatorLabPost(platform) {
  const normalized = String(platform || '').trim().toLowerCase();

  if (normalized === 'twitter' || normalized === 'x') {
    return [
      'Free ThumbGate Operator Lab: turn one repeated AI-agent mistake into one prevention rule.',
      buildOperatorLabUrl('x', 'operator_lab_twitter'),
    ].join(' ');
  }

  if (normalized === 'linkedin') {
    return [
      'I started a free ThumbGate Operator Lab for people running AI coding agents in real repos.',
      'The format is deliberately practical: bring one repeated Claude Code, Codex, Cursor, Gemini, Amp, OpenCode, or MCP failure, and we turn it into a prevention rule, pre-action gate, or workflow-hardening teardown.',
      'The best first win is narrow: one mistake, one rule, one blocked repeat.',
      buildOperatorLabUrl('linkedin', 'operator_lab_linkedin'),
    ].join('\n\n');
  }

  if (normalized === 'instagram') {
    return [
      'Stop repeated AI-agent mistakes.',
      '',
      'ThumbGate Operator Lab is open and free: bring one Claude Code, Codex, Cursor, Gemini, Amp, OpenCode, or MCP failure and turn it into a prevention rule.',
      '',
      buildOperatorLabUrl('instagram', 'operator_lab_instagram'),
    ].join('\n');
  }

  if (normalized === 'reddit') {
    return [
      'I started a free Skool group for people using AI coding agents in real repos.',
      'The premise: post one repeated agent mistake, then turn it into a prevention rule or pre-action gate instead of another prompt tweak.',
      'Useful for Claude Code, Codex, Cursor, Gemini, Amp, OpenCode, and MCP workflows.',
      buildOperatorLabUrl('reddit', 'operator_lab_reddit'),
    ].join('\n\n');
  }

  if (normalized === 'youtube') {
    return [
      'Free ThumbGate Operator Lab: bring one repeated AI-agent mistake and turn it into a prevention rule.',
      '',
      'For Claude Code, Codex, Cursor, Gemini, Amp, OpenCode, and MCP operators.',
      '',
      buildOperatorLabUrl('youtube', 'operator_lab_youtube'),
    ].join('\n');
  }

  if (normalized === 'tiktok') {
    return [
      'Your AI coding agent keeps repeating the same mistake.',
      'Bring it to the free ThumbGate Operator Lab. One failure becomes one prevention rule.',
      buildOperatorLabUrl('tiktok', 'operator_lab_tiktok'),
      '#AIAgents #ClaudeCode #Cursor #DeveloperTools #ThumbGate',
    ].join('\n\n');
  }

  return [
    'ThumbGate Operator Lab is a free community for turning repeated AI-agent mistakes into prevention rules and pre-action gates.',
    buildOperatorLabUrl(normalized || 'zernio', `operator_lab_${normalized || 'generic'}`),
  ].join(' ');
}

function resolveOperatorLabMediaPath(platform, offer = 'launch') {
  if (offer !== 'operator-lab') {
    return '';
  }

  const normalized = String(platform || '').trim().toLowerCase();
  if (normalized === 'instagram' || normalized === 'threads') {
    return OPERATOR_LAB_MEDIA_PATHS.square;
  }
  if (normalized === 'tiktok' || normalized === 'youtube') {
    return OPERATOR_LAB_MEDIA_PATHS.verticalVideo;
  }
  if (normalized === 'twitter' || normalized === 'x' || normalized === 'linkedin' || normalized === 'reddit' || normalized === 'bluesky') {
    return OPERATOR_LAB_MEDIA_PATHS.landscape;
  }
  return '';
}

async function buildMediaItemsForPlatform(platform, offer, uploadMedia = uploadLocalMedia) {
  const mediaPath = resolveOperatorLabMediaPath(platform, offer);
  if (!mediaPath) {
    return [];
  }
  if (!fs.existsSync(mediaPath)) {
    throw new Error(`Operator Lab media missing for ${platform}: ${mediaPath}`);
  }

  const uploaded = await uploadMedia(mediaPath);
  return [uploaded];
}

function buildPlatformPost(platform, offer = 'launch') {
  if (offer === 'operator-lab') {
    return buildOperatorLabPost(platform);
  }

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
    uploadLocalMedia: publisher.uploadLocalMedia || uploadLocalMedia,
  };

  const platforms = Array.isArray(options.platforms) && options.platforms.length > 0
    ? options.platforms
    : DEFAULT_LAUNCH_PLATFORMS;
  const schedule = String(options.schedule || '').trim();
  const timezone = String(options.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  const offer = String(options.offer || 'launch').trim() || 'launch';
  let accounts = [];
  let accountLookupError = null;
  try {
    accounts = await api.getConnectedAccounts();
  } catch (error) {
    if (options.dryRun === true && /ZERNIO_API_KEY/i.test(error && error.message ? error.message : String(error))) {
      accountLookupError = error;
    } else {
      throw error;
    }
  }
  const groupedAccounts = api.groupAccountsByPlatform(accounts);
  const results = {
    dryRun: options.dryRun === true,
    platforms,
    accountLookupError: accountLookupError ? accountLookupError.message : undefined,
    previews: [],
    published: [],
    scheduled: [],
    skipped: [],
    errors: [],
  };

  for (const platform of platforms) {
    const normalizedPlatform = String(platform || '').trim().toLowerCase();
    const platformAccounts = groupedAccounts.get(normalizedPlatform) || [];
    if (platformAccounts.length === 0 && !(results.dryRun && accountLookupError)) {
      results.skipped.push({ platform: normalizedPlatform, reason: 'not_connected' });
      continue;
    }

    const content = buildPlatformPost(normalizedPlatform, offer);
    const mediaPath = resolveOperatorLabMediaPath(normalizedPlatform, offer);
    results.previews.push({
      platform: normalizedPlatform,
      content,
      mediaPath: mediaPath || undefined,
      accountCount: platformAccounts.length,
    });

    if (results.dryRun) {
      continue;
    }

    const utm = {
      source: normalizedPlatform === 'twitter' ? 'x' : normalizedPlatform,
      medium: offer === 'operator-lab' ? 'community_course' : 'organic_social',
      campaign: offer === 'operator-lab' ? OPERATOR_LAB_CAMPAIGN : LAUNCH_CAMPAIGN,
    };

    try {
      if (normalizedPlatform === 'instagram') {
        if (schedule) {
          results.skipped.push({ platform: normalizedPlatform, reason: 'schedule_not_supported_for_instagram_launch' });
          continue;
        }

        const instagramOptions = {
          caption: content,
          utm,
        };
        if (mediaPath) {
          instagramOptions.imagePath = mediaPath;
          instagramOptions.postOnly = true;
        }
        const instagramResult = await api.publishInstagramThumbGate(instagramOptions);
        results.published.push({ platform: normalizedPlatform, result: instagramResult });
        continue;
      }

      const mediaItems = await buildMediaItemsForPlatform(normalizedPlatform, offer, api.uploadLocalMedia);
      if (schedule) {
        const scheduledResult = await api.schedulePost(content, platformAccounts, schedule, timezone, { utm, mediaItems });
        results.scheduled.push({ platform: normalizedPlatform, result: scheduledResult });
      } else {
        const publishResult = await api.publishPost(content, platformAccounts, { utm, mediaItems });
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
  OPERATOR_LAB_CAMPAIGN,
  OPERATOR_LAB_MEDIA_PATHS,
  SKOOL_OPERATOR_LAB_URL,
  buildMediaItemsForPlatform,
  buildCampaignEntries,
  buildLandingUrl,
  buildOperatorLabPost,
  buildOperatorLabUrl,
  buildPlatformPost,
  defaultCampaignSchedule,
  parseArgs,
  publishLaunchCampaign,
  resolveOperatorLabMediaPath,
};
