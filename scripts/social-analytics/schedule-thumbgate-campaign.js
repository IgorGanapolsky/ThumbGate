#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { publishInstagramThumbGate } = require('./publish-instagram-thumbgate');
const {
  DEFAULT_TIMEZONE,
  buildCampaignEntries,
  defaultCampaignSchedule,
} = require('./publish-thumbgate-launch');
const {
  getConnectedAccounts,
  groupAccountsByPlatform,
  schedulePost,
} = require('./publishers/zernio');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_STATE_PATH = path.join(REPO_ROOT, '.thumbgate', 'social-campaign-schedule-state.json');

function parseArgs(argv = []) {
  const options = {
    dryRun: false,
    platforms: [],
    scheduleTimes: [],
    statePath: DEFAULT_STATE_PATH,
    timezone: DEFAULT_TIMEZONE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (token.startsWith('--platforms=')) {
      options.platforms = token.slice('--platforms='.length).split(',').map((value) => value.trim()).filter(Boolean);
      continue;
    }

    if (token === '--platforms' && argv[index + 1]) {
      options.platforms = String(argv[index + 1]).split(',').map((value) => value.trim()).filter(Boolean);
      index += 1;
      continue;
    }

    if (token.startsWith('--times=')) {
      options.scheduleTimes = token.slice('--times='.length).split(',').map((value) => value.trim()).filter(Boolean);
      continue;
    }

    if (token === '--times' && argv[index + 1]) {
      options.scheduleTimes = String(argv[index + 1]).split(',').map((value) => value.trim()).filter(Boolean);
      index += 1;
      continue;
    }

    if (token.startsWith('--timezone=')) {
      options.timezone = token.slice('--timezone='.length).trim() || DEFAULT_TIMEZONE;
      continue;
    }

    if (token.startsWith('--state-path=')) {
      options.statePath = token.slice('--state-path='.length).trim() || DEFAULT_STATE_PATH;
      continue;
    }

    if (token === '--timezone' && argv[index + 1]) {
      options.timezone = String(argv[index + 1]).trim() || DEFAULT_TIMEZONE;
      index += 1;
      continue;
    }

    if (token === '--state-path' && argv[index + 1]) {
      options.statePath = String(argv[index + 1]).trim() || DEFAULT_STATE_PATH;
      index += 1;
    }
  }

  return options;
}

function readScheduleState(statePath = DEFAULT_STATE_PATH) {
  if (!fs.existsSync(statePath)) {
    return { scheduled: {} };
  }

  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return { scheduled: {} };
  }
}

function writeScheduleState(statePath = DEFAULT_STATE_PATH, state = { scheduled: {} }) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function buildScheduleKey({ slug, platform, scheduledFor }) {
  return `${scheduledFor}::${slug}::${platform}`;
}

async function scheduleCampaign(options = {}, api = {}) {
  const scheduleApi = {
    getConnectedAccounts: api.getConnectedAccounts || getConnectedAccounts,
    groupAccountsByPlatform: api.groupAccountsByPlatform || groupAccountsByPlatform,
    publishInstagramThumbGate: api.publishInstagramThumbGate || publishInstagramThumbGate,
    schedulePost: api.schedulePost || schedulePost,
  };

  const campaignEntries = buildCampaignEntries();
  const scheduleTimes = options.scheduleTimes && options.scheduleTimes.length > 0
    ? options.scheduleTimes
    : defaultCampaignSchedule();
  const platforms = options.platforms && options.platforms.length > 0
    ? options.platforms
    : ['twitter', 'linkedin', 'instagram'];
  const statePath = options.statePath || DEFAULT_STATE_PATH;
  const state = readScheduleState(statePath);
  const scheduledState = state.scheduled && typeof state.scheduled === 'object' ? state.scheduled : {};
  const accounts = await scheduleApi.getConnectedAccounts();
  const groupedAccounts = scheduleApi.groupAccountsByPlatform(accounts);
  const results = {
    dryRun: options.dryRun === true,
    statePath,
    timezone: options.timezone || DEFAULT_TIMEZONE,
    scheduleTimes,
    platforms,
    scheduled: [],
    skipped: [],
    errors: [],
  };

  for (let index = 0; index < campaignEntries.length; index += 1) {
    const entry = campaignEntries[index];
    const scheduledFor = scheduleTimes[index];
    if (!scheduledFor) {
      results.skipped.push({ slug: entry.slug, reason: 'missing_schedule_time' });
      continue;
    }

    for (const platform of platforms) {
      const normalizedPlatform = String(platform || '').trim().toLowerCase();
      const platformAccounts = groupedAccounts.get(normalizedPlatform) || [];
      if (platformAccounts.length === 0) {
        results.skipped.push({ slug: entry.slug, platform: normalizedPlatform, reason: 'not_connected' });
        continue;
      }

      const content = entry.posts[normalizedPlatform];
      if (!content) {
        results.skipped.push({ slug: entry.slug, platform: normalizedPlatform, reason: 'no_content' });
        continue;
      }

      const scheduleKey = buildScheduleKey({
        slug: entry.slug,
        platform: normalizedPlatform,
        scheduledFor,
      });
      if (!results.dryRun && scheduledState[scheduleKey]) {
        results.skipped.push({
          slug: entry.slug,
          platform: normalizedPlatform,
          reason: 'already_scheduled',
          scheduledFor,
          existing: scheduledState[scheduleKey],
        });
        continue;
      }

      if (results.dryRun) {
        results.scheduled.push({
          slug: entry.slug,
          platform: normalizedPlatform,
          scheduledFor,
          dryRun: true,
          content,
        });
        continue;
      }

      const utm = {
        source: normalizedPlatform === 'twitter' ? 'x' : normalizedPlatform,
        medium: 'organic_social',
        campaign: 'first_customer_push',
      };

      try {
        if (normalizedPlatform === 'instagram') {
          const scheduledResult = await scheduleApi.publishInstagramThumbGate({
            caption: content,
            schedule: scheduledFor,
            timezone: options.timezone || DEFAULT_TIMEZONE,
            utm,
          });
          scheduledState[scheduleKey] = {
            id: scheduledResult.postId || scheduledResult.id || null,
            scheduledFor,
            slug: entry.slug,
            platform: normalizedPlatform,
            recordedAt: new Date().toISOString(),
          };
          results.scheduled.push({
            slug: entry.slug,
            platform: normalizedPlatform,
            scheduledFor,
            result: scheduledResult,
          });
          continue;
        }

        const scheduledResult = await scheduleApi.schedulePost(
          content,
          platformAccounts,
          scheduledFor,
          options.timezone || DEFAULT_TIMEZONE,
          { utm }
        );
        scheduledState[scheduleKey] = {
          id: scheduledResult.id || scheduledResult.post?._id || null,
          scheduledFor,
          slug: entry.slug,
          platform: normalizedPlatform,
          recordedAt: new Date().toISOString(),
        };
        results.scheduled.push({
          slug: entry.slug,
          platform: normalizedPlatform,
          scheduledFor,
          result: scheduledResult,
        });
      } catch (error) {
        results.errors.push({
          slug: entry.slug,
          platform: normalizedPlatform,
          error: error && error.message ? error.message : String(error),
        });
      }
    }
  }

  if (!results.dryRun) {
    writeScheduleState(statePath, { scheduled: scheduledState });
  }

  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = await scheduleCampaign(options);
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
  buildScheduleKey,
  DEFAULT_STATE_PATH,
  parseArgs,
  readScheduleState,
  scheduleCampaign,
  writeScheduleState,
};
