#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  listPosts,
} = require('./publishers/zernio');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_STATE_PATH = path.join(REPO_ROOT, '.thumbgate', 'social-launch-assets.json');

const LAUNCH_MARKERS = {
  twitter: 'launch_post_twitter',
  linkedin: 'launch_post_linkedin',
  instagram: 'launch_post_instagram',
  reddit: 'launch_post_reddit',
};

const CAMPAIGN_MARKERS = {
  proof_pack: 'campaign_proof_pack',
  free_local: 'campaign_free_local',
  checkout_path: 'campaign_checkout_path',
};

function parseArgs(argv = []) {
  const options = {
    limit: 50,
    statePath: DEFAULT_STATE_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    if (token.startsWith('--limit=')) {
      options.limit = Number.parseInt(token.slice('--limit='.length), 10) || options.limit;
      continue;
    }
    if (token === '--limit' && argv[index + 1]) {
      options.limit = Number.parseInt(String(argv[index + 1]), 10) || options.limit;
      index += 1;
      continue;
    }
    if (token.startsWith('--state-path=')) {
      options.statePath = token.slice('--state-path='.length).trim() || DEFAULT_STATE_PATH;
      continue;
    }
    if (token === '--state-path' && argv[index + 1]) {
      options.statePath = String(argv[index + 1]).trim() || DEFAULT_STATE_PATH;
      index += 1;
    }
  }

  return options;
}

function normalizePlatform(post = {}) {
  return String(post?.platforms?.[0]?.platform || '').trim().toLowerCase();
}

function extractMarker(post = {}) {
  const content = String(post.content || '');

  for (const marker of Object.values(LAUNCH_MARKERS)) {
    if (content.includes(`utm_content=${marker}`)) {
      return marker;
    }
  }

  for (const marker of Object.values(CAMPAIGN_MARKERS)) {
    if (content.includes(`utm_content=${marker}`)) {
      return marker;
    }
  }

  return '';
}

function toTimestamp(post = {}) {
  return new Date(post.createdAt || post.updatedAt || post.scheduledFor || 0).getTime();
}

function selectNewestPost(posts = []) {
  return [...posts].sort((left, right) => toTimestamp(right) - toTimestamp(left))[0] || null;
}

function summarizePost(post = {}, marker = '') {
  return {
    id: post._id || post.id || null,
    platform: normalizePlatform(post),
    status: post.status || null,
    marker,
    createdAt: post.createdAt || null,
    updatedAt: post.updatedAt || null,
    scheduledFor: post.scheduledFor || null,
    content: post.content || '',
  };
}

function buildLaunchAssetState(posts = []) {
  const state = {
    updatedAt: new Date().toISOString(),
    launchPosts: {},
    campaignPosts: {},
  };

  for (const [platform, marker] of Object.entries(LAUNCH_MARKERS)) {
    const matching = posts.filter((post) => extractMarker(post) === marker);
    const selected = selectNewestPost(matching);
    if (selected) {
      state.launchPosts[platform] = summarizePost(selected, marker);
    }
  }

  for (const [slug, marker] of Object.entries(CAMPAIGN_MARKERS)) {
    const matching = posts.filter((post) => extractMarker(post) === marker);
    if (matching.length === 0) {
      continue;
    }

    const byPlatform = {};
    for (const post of matching) {
      const platform = normalizePlatform(post);
      if (!platform) continue;
      const existing = byPlatform[platform];
      if (!existing || toTimestamp(post) > toTimestamp(existing)) {
        byPlatform[platform] = post;
      }
    }

    state.campaignPosts[slug] = {};
    for (const [platform, post] of Object.entries(byPlatform)) {
      state.campaignPosts[slug][platform] = summarizePost(post, marker);
    }
  }

  return state;
}

function writeLaunchAssetState(statePath = DEFAULT_STATE_PATH, state = {}) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return statePath;
}

async function syncLaunchAssets(options = {}, api = {}) {
  const zernio = {
    listPosts: api.listPosts || listPosts,
  };

  const posts = await zernio.listPosts({ limit: options.limit || 50 });
  const state = buildLaunchAssetState(Array.isArray(posts) ? posts : []);
  const statePath = options.statePath || DEFAULT_STATE_PATH;
  writeLaunchAssetState(statePath, state);
  return {
    statePath,
    launchCount: Object.keys(state.launchPosts).length,
    campaignCount: Object.keys(state.campaignPosts).length,
    state,
  };
}

if (require.main === module) {
  syncLaunchAssets(parseArgs(process.argv.slice(2)))
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
  DEFAULT_STATE_PATH,
  LAUNCH_MARKERS,
  buildLaunchAssetState,
  extractMarker,
  normalizePlatform,
  parseArgs,
  selectNewestPost,
  summarizePost,
  syncLaunchAssets,
  writeLaunchAssetState,
};
