#!/usr/bin/env node
'use strict';

const {
  buildCampaignEntries,
  defaultCampaignSchedule,
} = require('./publish-thumbgate-launch');
const {
  deletePost,
  listPosts,
} = require('./publishers/zernio');
const {
  buildScheduleKey,
  DEFAULT_STATE_PATH,
  writeScheduleState,
} = require('./schedule-thumbgate-campaign');

const CAMPAIGN_MARKERS = {
  proof_pack: 'campaign_proof_pack',
  free_local: 'campaign_free_local',
  checkout_path: 'campaign_checkout_path',
};

function parseArgs(argv = []) {
  const options = {
    cancelDuplicates: false,
    limit: 50,
    scheduleTimes: [],
    statePath: DEFAULT_STATE_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--cancel-duplicates') {
      options.cancelDuplicates = true;
      continue;
    }
    if (token.startsWith('--limit=')) {
      options.limit = Number(token.slice('--limit='.length)) || options.limit;
      continue;
    }
    if (token.startsWith('--times=')) {
      options.scheduleTimes = token.slice('--times='.length).split(',').map((value) => value.trim()).filter(Boolean);
      continue;
    }
    if (token.startsWith('--state-path=')) {
      options.statePath = token.slice('--state-path='.length).trim() || DEFAULT_STATE_PATH;
    }
  }

  return options;
}

function normalizePlatform(post) {
  return String(post?.platforms?.[0]?.platform || '').trim().toLowerCase();
}

function selectCanonicalPost(posts = []) {
  return [...posts].sort((left, right) => {
    const leftCreated = new Date(left.createdAt || 0).getTime();
    const rightCreated = new Date(right.createdAt || 0).getTime();
    return leftCreated - rightCreated;
  })[0] || null;
}

async function reconcileCampaignState(options = {}, api = {}) {
  const zernio = {
    deletePost: api.deletePost || deletePost,
    listPosts: api.listPosts || listPosts,
  };
  const scheduleTimes = options.scheduleTimes && options.scheduleTimes.length > 0
    ? options.scheduleTimes
    : defaultCampaignSchedule();
  const posts = await zernio.listPosts({ limit: options.limit || 50 });
  const scheduled = {};
  const duplicates = [];
  const kept = [];
  const entries = buildCampaignEntries();

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const scheduleLocal = scheduleTimes[index];
    if (!scheduleLocal) {
      continue;
    }

    const scheduledForUtc = new Date(scheduleLocal).toISOString();

    for (const platform of Object.keys(entry.posts)) {
      const marker = CAMPAIGN_MARKERS[entry.slug];
      const matchingPosts = posts.filter((post) => (
        post.status === 'scheduled' &&
        normalizePlatform(post) === platform &&
        String(post.content || '').includes(`utm_content=${marker}`) &&
        String(post.scheduledFor || '') === scheduledForUtc
      ));

      if (matchingPosts.length === 0) {
        continue;
      }

      const canonical = selectCanonicalPost(matchingPosts);
      if (!canonical) {
        continue;
      }

      const scheduleKey = buildScheduleKey({
        slug: entry.slug,
        platform,
        scheduledFor: scheduleLocal,
      });
      scheduled[scheduleKey] = {
        id: canonical._id,
        scheduledFor: scheduleLocal,
        slug: entry.slug,
        platform,
        recordedAt: new Date().toISOString(),
      };
      kept.push({
        key: scheduleKey,
        id: canonical._id,
      });

      const extras = matchingPosts.filter((post) => post._id !== canonical._id);
      for (const duplicate of extras) {
        const duplicateRecord = {
          key: scheduleKey,
          id: duplicate._id,
          platform,
          slug: entry.slug,
        };
        if (options.cancelDuplicates) {
          duplicateRecord.cancelled = await zernio.deletePost(duplicate._id);
        }
        duplicates.push(duplicateRecord);
      }
    }
  }

  writeScheduleState(options.statePath || DEFAULT_STATE_PATH, { scheduled });
  return {
    duplicates,
    kept,
    statePath: options.statePath || DEFAULT_STATE_PATH,
  };
}

if (require.main === module) {
  reconcileCampaignState(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      console.error(error && error.message ? error.message : error);
      process.exit(1);
    });
}

module.exports = {
  CAMPAIGN_MARKERS,
  normalizePlatform,
  parseArgs,
  reconcileCampaignState,
  selectCanonicalPost,
};
