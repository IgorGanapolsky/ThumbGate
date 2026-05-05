#!/usr/bin/env node
'use strict';

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
const fs = require('node:fs');
const path = require('node:path');

const APP_ORIGIN = resolveHostedBillingConfig({
  requestOrigin: 'https://thumbgate-production.up.railway.app',
}).appOrigin;
const DEFAULT_TIMEZONE = 'America/New_York';
const LAUNCH_CAMPAIGN = 'first_customer_push';
const OPERATOR_LAB_CAMPAIGN = 'operator_lab_launch';
const SKOOL_OPERATOR_LAB_URL = 'https://www.skool.com/thumbgate-operator-lab-6000';
const DEFAULT_LAUNCH_PLATFORMS = ['twitter', 'linkedin', 'instagram'];
const DEFAULT_OPERATOR_LAB_PLATFORMS = ['linkedin', 'instagram', 'threads', 'bluesky', 'reddit', 'youtube'];

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OPERATOR_LAB_MEDIA = {
  landscape: path.join(REPO_ROOT, 'docs', 'marketing', 'assets', 'thumbgate-skool-cover-1084x576.png'),
  square: path.join(REPO_ROOT, 'docs', 'marketing', 'assets', 'thumbgate-skool-icon-128x128.png'),
};

function resolveOperatorLabMediaPlan(platform) {
  const normalized = String(platform || '').trim().toLowerCase();
  if (normalized === 'instagram') return [OPERATOR_LAB_MEDIA.square];
  return [OPERATOR_LAB_MEDIA.landscape];
}

function describeMediaPlan(paths = []) {
  return paths.map((p) => ({
    path: p,
    exists: fs.existsSync(p),
  }));
}

const OPERATOR_LAB_POSTS = {
  twitter: {
    source: 'x',
    content: 'operator_lab_twitter',
    separator: ' ',
    lines: [
      'Free ThumbGate Operator Lab: turn one repeated AI-agent mistake into one prevention rule.',
    ],
  },
  linkedin: {
    content: 'operator_lab_linkedin',
    separator: '\n\n',
    lines: [
      'I started a free ThumbGate Operator Lab for people running AI coding agents in real repos.',
      'The format is deliberately practical: bring one repeated Claude Code, Codex, Cursor, Gemini, Amp, OpenCode, or MCP failure, and we turn it into a prevention rule, pre-action gate, or workflow-hardening teardown.',
      'The best first win is narrow: one mistake, one rule, one blocked repeat.',
    ],
  },
  instagram: {
    content: 'operator_lab_instagram',
    separator: '\n',
    lines: [
      'Stop repeated AI-agent mistakes.',
      '',
      'ThumbGate Operator Lab is open and free: bring one Claude Code, Codex, Cursor, Gemini, Amp, OpenCode, or MCP failure and turn it into a prevention rule.',
      '',
    ],
  },
  reddit: {
    content: 'operator_lab_reddit',
    separator: '\n\n',
    lines: [
      'I started a free Skool group for people using AI coding agents in real repos.',
      'The premise: post one repeated agent mistake, then turn it into a prevention rule or pre-action gate instead of another prompt tweak.',
      'Useful for Claude Code, Codex, Cursor, Gemini, Amp, OpenCode, and MCP workflows.',
    ],
  },
  youtube: {
    content: 'operator_lab_youtube',
    separator: '\n',
    lines: [
      'Free ThumbGate Operator Lab: bring one repeated AI-agent mistake and turn it into a prevention rule.',
      '',
      'For Claude Code, Codex, Cursor, Gemini, Amp, OpenCode, and MCP operators.',
      '',
    ],
  },
  tiktok: {
    content: 'operator_lab_tiktok',
    separator: '\n\n',
    trailing: '#AIAgents #ClaudeCode #Cursor #DeveloperTools #ThumbGate',
    lines: [
      'Your AI coding agent keeps repeating the same mistake.',
      'Bring it to the free ThumbGate Operator Lab. One failure becomes one prevention rule.',
    ],
  },
};

const CAMPAIGN_POSTS = [
  {
    slug: 'proof_pack',
    posts: {
      twitter: { content: 'campaign_proof_pack', source: 'x', separator: ' ', lines: ['AI coding agents do not need more hype. They need proof-backed workflow hardening.', 'ThumbGate turns thumbs-down feedback into a prevention rule that blocks the same mistake next session.', 'Proof pack:'] },
      linkedin: { content: 'campaign_proof_pack', separator: ' ', lines: ['Workflow hardening beats generic AI hype.', 'ThumbGate captures failure signals, promotes them into prevention rules, and blocks the same bad pattern before the next tool call executes.', 'This is about one workflow becoming safe enough to ship, not abstract "agent memory."'] },
      instagram: { raw: `${THUMBGATE_CAPTION}\n\nProof-backed workflow hardening.\n\n${buildLandingUrl('instagram', 'campaign_proof_pack')}` },
      tiktok: { raw: 'Your AI agent has amnesia. Give it memory that survives restarts.\n\nThumbGate: proof-backed workflow hardening for coding agents.\n\n#AIAgents #DeveloperTools #ClaudeCode #ThumbGate' },
      youtube: { content: 'campaign_proof_pack', separator: '\n\n', lines: ['Your AI agent has amnesia. Give it memory that survives restarts.', 'ThumbGate turns thumbs-down feedback into prevention rules that block mistakes permanently.'] },
    },
  },
  {
    slug: 'free_local',
    posts: {
      twitter: { content: 'campaign_free_local', source: 'x', separator: ' ', lines: ['The free path is the point.', 'ThumbGate runs local-first, keeps lesson state in .thumbgate, and blocks repeated coding-agent mistakes without a cloud account.'] },
      linkedin: { content: 'campaign_free_local', separator: ' ', lines: ['Most AI tooling tries to sell a hosted layer first. ThumbGate does not.', 'The free local path gives you feedback capture, prevention rules, and blocking on your machine. Pro adds the personal dashboard and exports when the workflow is already valuable.'] },
      instagram: { content: 'campaign_free_local', separator: '\n\n', lines: ['Your AI coding agent forgets everything between sessions.', 'ThumbGate keeps the feedback loop local, durable, and enforceable.'] },
      tiktok: { raw: 'Free and local-first. ThumbGate blocks repeated AI coding mistakes without a cloud account.\n\nnpx thumbgate init\n\n#FreeDeveloperTools #AIAgents #OpenSource' },
      youtube: { content: 'campaign_free_local', separator: '\n\n', lines: ['ThumbGate runs local-first. No cloud account needed. Feedback capture, prevention rules, and blocking — all on your machine.'] },
    },
  },
  {
    slug: 'checkout_path',
    posts: {
      twitter: { content: 'campaign_checkout_path', source: 'x', separator: ' ', lines: ['If your agent repeats the same repo mistake every week, the fix is not another prompt.', 'ThumbGate blocks known-bad patterns before the next tool call lands.', 'Free local path, Pro trial here:'] },
      linkedin: { content: 'campaign_checkout_path', separator: ' ', lines: ['Repeated agent mistakes are a systems problem, not a prompt-writing problem.', 'ThumbGate turns explicit feedback into prevention rules and gives individual operators a paid path when they want the dashboard, exports, and check debugger.'] },
      instagram: { content: 'campaign_checkout_path', separator: '\n\n', lines: ['ThumbGate turns thumbs-down feedback into a prevention rule.', 'Next session, the same mistake gets blocked.'] },
      tiktok: { raw: 'Stop your AI agent from repeating the same mistake. One thumbs-down = permanent block.\n\nFree to start. Pro when you need the dashboard.\n\n#ThumbGate #AIAgents #DeveloperTools' },
      youtube: { content: 'campaign_checkout_path', separator: '\n\n', lines: ['Repeated agent mistakes are a systems problem. ThumbGate blocks known-bad patterns before the next tool call executes.', 'Free local path. Pro adds dashboard and exports.'] },
    },
  },
];

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

function renderTrackedPost(spec, platform, urlBuilder) {
  if (spec.raw) return spec.raw;
  const lines = Array.isArray(spec.lines) ? spec.lines : [];
  const trackedUrl = urlBuilder(platform, spec.content);
  return [...lines, trackedUrl, spec.trailing].filter((line) => line !== undefined).join(spec.separator || ' ');
}

function buildOperatorLabPost(platform) {
  const normalized = String(platform || '').trim().toLowerCase();
  const key = normalized === 'x' ? 'twitter' : normalized;
  const spec = OPERATOR_LAB_POSTS[key];
  if (spec) {
    return renderTrackedPost(spec, spec.source || key, buildOperatorLabUrl);
  }
  const fallbackKey = normalized || 'zernio';
  return renderTrackedPost({
    content: `operator_lab_${fallbackKey || 'generic'}`,
    separator: ' ',
    lines: ['ThumbGate Operator Lab is a free community for turning repeated AI-agent mistakes into prevention rules and pre-action gates.'],
  }, fallbackKey, buildOperatorLabUrl);
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
  return CAMPAIGN_POSTS.map(({ slug, posts }) => ({
    slug,
    posts: Object.fromEntries(Object.entries(posts).map(([platform, spec]) => [
      platform,
      renderTrackedPost(spec, spec.source || platform, buildLandingUrl),
    ])),
  }));
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

  const offer = String(options.offer || 'launch').trim() || 'launch';
  const platforms = Array.isArray(options.platforms) && options.platforms.length > 0
    ? options.platforms
    : (offer === 'operator-lab' ? DEFAULT_OPERATOR_LAB_PLATFORMS : DEFAULT_LAUNCH_PLATFORMS);
  const schedule = String(options.schedule || '').trim();
  const timezone = String(options.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;

  let groupedAccounts = new Map();
  if (!(options.dryRun === true && !process.env.ZERNIO_API_KEY)) {
    const accounts = await api.getConnectedAccounts();
    groupedAccounts = api.groupAccountsByPlatform(accounts);
  }

  const results = {
    dryRun: options.dryRun === true,
    offer,
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
    if (platformAccounts.length === 0 && !results.dryRun) {
      results.skipped.push({ platform: normalizedPlatform, reason: 'not_connected' });
      continue;
    }

    const content = buildPlatformPost(normalizedPlatform, offer);
    const mediaPlanPaths = offer === 'operator-lab' ? resolveOperatorLabMediaPlan(normalizedPlatform) : [];
    results.previews.push({
      platform: normalizedPlatform,
      content,
      accountCount: platformAccounts.length || 0,
      mediaPlan: describeMediaPlan(mediaPlanPaths),
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
      const mediaItems = [];
      if (offer === 'operator-lab') {
        for (const mediaPath of mediaPlanPaths) {
          mediaItems.push(await api.uploadLocalMedia(mediaPath));
        }
      }

      if (normalizedPlatform === 'instagram' && offer !== 'operator-lab') {
        if (schedule) {
          results.skipped.push({ platform: normalizedPlatform, reason: 'schedule_not_supported_for_instagram_launch' });
          continue;
        }

        const instagramResult = await api.publishInstagramThumbGate({ caption: content });
        results.published.push({ platform: normalizedPlatform, result: instagramResult });
        continue;
      }

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

const isDirectRun = (() => {
  try {
    const resolvedArgv = path.resolve(process.argv[1] || '');
    return resolvedArgv === path.resolve(__filename);
  } catch {
    return false;
  }
})();

if (isDirectRun) {
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
  SKOOL_OPERATOR_LAB_URL,
  buildCampaignEntries,
  buildLandingUrl,
  buildOperatorLabPost,
  buildOperatorLabUrl,
  buildPlatformPost,
  defaultCampaignSchedule,
  parseArgs,
  publishLaunchCampaign,
};
