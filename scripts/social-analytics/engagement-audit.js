#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readJsonl } = require('../fs-utils');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_REPLY_STATE_PATH = path.join(REPO_ROOT, '.thumbgate', 'reply-monitor-state.json');
const DEFAULT_DRAFTS_PATH = path.join(REPO_ROOT, '.thumbgate', 'reply-drafts.jsonl');
const DEFAULT_LAUNCH_ASSETS_PATH = path.join(REPO_ROOT, '.thumbgate', 'social-launch-assets.json');
const DEFAULT_TIMEZONE = 'America/New_York';

const PLATFORM_CAPABILITIES = {
  x: 'active_reply_monitor',
  reddit: 'draft_only_reply_monitor',
  linkedin: 'comment_intake_blocked_by_api_approval',
  instagram: 'no_comment_intake_implemented',
  tiktok: 'no_comment_intake_implemented',
  youtube: 'no_comment_intake_implemented',
  devto: 'no_comment_intake_implemented',
};

function parseArgs(argv = []) {
  const options = {
    date: '',
    timezone: DEFAULT_TIMEZONE,
    replyStatePath: DEFAULT_REPLY_STATE_PATH,
    draftsPath: DEFAULT_DRAFTS_PATH,
    launchAssetsPath: DEFAULT_LAUNCH_ASSETS_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    if (token.startsWith('--date=')) {
      options.date = token.slice('--date='.length).trim();
      continue;
    }
    if (token === '--date' && argv[index + 1]) {
      options.date = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (token.startsWith('--timezone=')) {
      options.timezone = token.slice('--timezone='.length).trim() || DEFAULT_TIMEZONE;
    }
  }

  return options;
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function formatDateInTimezone(date, timezone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(date));
}

function buildPlatformSummary() {
  return {
    checked: 0,
    replied: 0,
    drafted: 0,
    skipped: 0,
    skippedOwnTweet: 0,
    skippedNoReplyGenerated: 0,
    capability: '',
    ownedLaunchAssets: 0,
  };
}

function buildEngagementAudit(options = {}) {
  const timezone = options.timezone || DEFAULT_TIMEZONE;
  const targetDate = options.date || formatDateInTimezone(new Date(), timezone);
  const replyState = readJson(options.replyStatePath || DEFAULT_REPLY_STATE_PATH, { repliedTo: {}, lastCheck: {} });
  const drafts = readJsonl(options.draftsPath || DEFAULT_DRAFTS_PATH);
  const launchAssets = readJson(options.launchAssetsPath || DEFAULT_LAUNCH_ASSETS_PATH, { launchPosts: {}, campaignPosts: {} });

  const platforms = {
    x: buildPlatformSummary(),
    reddit: buildPlatformSummary(),
    linkedin: buildPlatformSummary(),
    instagram: buildPlatformSummary(),
    tiktok: buildPlatformSummary(),
    youtube: buildPlatformSummary(),
    devto: buildPlatformSummary(),
  };

  for (const [platform, capability] of Object.entries(PLATFORM_CAPABILITIES)) {
    platforms[platform].capability = capability;
  }

  for (const entry of Object.values(replyState.repliedTo || {})) {
    const platform = String(entry.platform || '').trim().toLowerCase();
    if (!platforms[platform]) continue;
    if (formatDateInTimezone(entry.at, timezone) !== targetDate) continue;
    platforms[platform].checked += 1;
    if (entry.drafted) {
      platforms[platform].drafted += 1;
      continue;
    }
    if (entry.skipped) {
      platforms[platform].skipped += 1;
      if (entry.skipped === 'own_tweet') {
        platforms[platform].skippedOwnTweet += 1;
      }
      if (entry.skipped === 'no_reply_generated') {
        platforms[platform].skippedNoReplyGenerated += 1;
      }
      continue;
    }
    platforms[platform].replied += 1;
  }

  for (const draft of drafts) {
    const platform = String(draft.platform || '').trim().toLowerCase();
    if (!platforms[platform]) continue;
    if (formatDateInTimezone(draft.draftedAt, timezone) !== targetDate) continue;
    platforms[platform].drafted += 1;
  }

  for (const platform of Object.keys(launchAssets.launchPosts || {})) {
    if (platforms[platform]) {
      platforms[platform].ownedLaunchAssets += 1;
    }
  }
  for (const byPlatform of Object.values(launchAssets.campaignPosts || {})) {
    for (const platform of Object.keys(byPlatform || {})) {
      if (platforms[platform]) {
        platforms[platform].ownedLaunchAssets += 1;
      }
    }
  }

  const totals = Object.values(platforms).reduce((acc, platform) => {
    acc.checked += platform.checked;
    acc.replied += platform.replied;
    acc.drafted += platform.drafted;
    acc.skipped += platform.skipped;
    return acc;
  }, { checked: 0, replied: 0, drafted: 0, skipped: 0 });

  return {
    date: targetDate,
    timezone,
    totals,
    platforms,
    evidence: {
      replyStatePath: options.replyStatePath || DEFAULT_REPLY_STATE_PATH,
      draftsPath: options.draftsPath || DEFAULT_DRAFTS_PATH,
      launchAssetsPath: options.launchAssetsPath || DEFAULT_LAUNCH_ASSETS_PATH,
    },
  };
}

if (require.main === module) {
  const audit = buildEngagementAudit(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
}

module.exports = {
  DEFAULT_DRAFTS_PATH,
  DEFAULT_LAUNCH_ASSETS_PATH,
  DEFAULT_REPLY_STATE_PATH,
  DEFAULT_TIMEZONE,
  PLATFORM_CAPABILITIES,
  buildEngagementAudit,
  formatDateInTimezone,
  parseArgs,
  readJsonl,
};
