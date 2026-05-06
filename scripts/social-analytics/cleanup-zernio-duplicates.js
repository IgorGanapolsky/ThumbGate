#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const {
  deletePost,
  listPosts,
  isZernioBillingPausedError,
} = require('./publishers/zernio');

const DEFAULT_PLATFORMS = ['instagram', 'tiktok'];
const CONFIRM_TOKEN = 'DELETE_DUPLICATE_SOCIAL_POSTS';

function parseCsv(value, fallback = []) {
  const parsed = String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

function readOptionValue(argv, index, token, name) {
  const inlinePrefix = `--${name}=`;
  if (token.startsWith(inlinePrefix)) {
    return { index, value: token.slice(inlinePrefix.length).trim() };
  }
  if (token === `--${name}` && argv[index + 1]) {
    return { index: index + 1, value: String(argv[index + 1]).trim() };
  }
  return null;
}

function applyValueOption(options, argv, index, token) {
  const confirm = readOptionValue(argv, index, token, 'confirm-delete');
  if (confirm) {
    options.confirmDelete = confirm.value;
    return confirm.index;
  }

  const limit = readOptionValue(argv, index, token, 'limit');
  if (limit) {
    options.limit = Number.parseInt(limit.value, 10) || options.limit;
    return limit.index;
  }

  const platforms = readOptionValue(argv, index, token, 'platforms');
  if (platforms) {
    options.platforms = parseCsv(platforms.value, DEFAULT_PLATFORMS);
    return platforms.index;
  }

  const statuses = readOptionValue(argv, index, token, 'statuses');
  if (statuses) {
    options.statuses = parseCsv(statuses.value, []);
    return statuses.index;
  }

  return index;
}

function parseArgs(argv = []) {
  const options = {
    confirmDelete: '',
    dryRun: true,
    limit: 100,
    platforms: DEFAULT_PLATFORMS,
    statuses: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    if (token === '--delete') {
      options.dryRun = false;
      continue;
    }
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    index = applyValueOption(options, argv, index, token);
  }

  return options;
}

function postId(post = {}) {
  return String(post._id || post.id || post.postId || '').trim();
}

function postPlatform(post = {}) {
  const platform =
    post.platform ||
    post.platforms?.[0]?.platform ||
    post.accounts?.[0]?.platform ||
    post.socialAccount?.platform ||
    '';
  return String(platform).trim().toLowerCase();
}

function postStatus(post = {}) {
  return String(post.status || post.state || '').trim().toLowerCase();
}

function postContent(post = {}) {
  return String(post.content || post.caption || post.text || post.message || '').trim();
}

function postTimestamp(post = {}) {
  const value = post.publishedAt || post.published_at || post.createdAt || post.updatedAt || post.scheduledFor || 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function normalizeContent(content) {
  return String(content || '')
    .toLowerCase()
    .replaceAll(/https?:\/\/\S+/g, '<url>')
    .replaceAll(/utm_[a-z_]+=[^&\s]+/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function contentFingerprint(content) {
  return crypto.createHash('sha256').update(normalizeContent(content)).digest('hex').slice(0, 16);
}

function summarizePost(post = {}) {
  return {
    id: postId(post),
    platform: postPlatform(post),
    status: postStatus(post) || null,
    timestamp: postTimestamp(post),
    createdAt: post.createdAt || null,
    updatedAt: post.updatedAt || null,
    publishedAt: post.publishedAt || post.published_at || null,
    scheduledFor: post.scheduledFor || null,
    contentPreview: postContent(post).replaceAll(/\s+/g, ' ').slice(0, 140),
  };
}

function findDuplicatePosts(posts = [], options = {}) {
  const platformSet = new Set((options.platforms || DEFAULT_PLATFORMS).map((p) => String(p).toLowerCase()));
  const statusSet = new Set((options.statuses || []).map((s) => String(s).toLowerCase()).filter(Boolean));
  const groups = new Map();

  for (const post of posts) {
    const platform = postPlatform(post);
    if (!platformSet.has(platform)) continue;
    const status = postStatus(post);
    if (statusSet.size > 0 && !statusSet.has(status)) continue;
    const content = postContent(post);
    if (!content) continue;

    const key = `${platform}::${contentFingerprint(content)}`;
    const existing = groups.get(key) || [];
    existing.push(post);
    groups.set(key, existing);
  }

  const duplicateGroups = [];
  for (const [key, groupPosts] of groups.entries()) {
    if (groupPosts.length < 2) continue;
    const sorted = [...groupPosts].sort((left, right) => postTimestamp(right) - postTimestamp(left));
    duplicateGroups.push({
      key,
      keep: summarizePost(sorted[0]),
      delete: sorted.slice(1).map(summarizePost).filter((post) => post.id),
      total: sorted.length,
    });
  }

  return duplicateGroups;
}

async function cleanupZernioDuplicates(options = {}, api = {}) {
  const resolved = {
    ...options,
    dryRun: options.dryRun !== false,
    platforms: options.platforms || DEFAULT_PLATFORMS,
  };
  const zernio = {
    listPosts: api.listPosts || listPosts,
    deletePost: api.deletePost || deletePost,
  };

  const posts = await zernio.listPosts({ limit: resolved.limit || 100 });
  const duplicateGroups = findDuplicatePosts(posts, resolved);
  const deletions = duplicateGroups.flatMap((group) =>
    group.delete.map((post) => ({ groupKey: group.key, post }))
  );

  if (!resolved.dryRun && resolved.confirmDelete !== CONFIRM_TOKEN) {
    throw new Error(`Live deletion requires --confirm-delete=${CONFIRM_TOKEN}`);
  }

  const deleted = [];
  const errors = [];
  if (!resolved.dryRun) {
    for (const candidate of deletions) {
      try {
        const result = await zernio.deletePost(candidate.post.id);
        deleted.push({ ...candidate, result });
      } catch (error) {
        errors.push({
          ...candidate,
          error: error?.message ? error.message : String(error),
        });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    dryRun: Boolean(resolved.dryRun),
    platforms: resolved.platforms,
    statuses: resolved.statuses || [],
    scanned: Array.isArray(posts) ? posts.length : 0,
    duplicateGroups,
    candidateDeleteCount: deletions.length,
    deletedCount: deleted.length,
    deleted,
    errors,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  try {
    const result = await cleanupZernioDuplicates(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.errors.length > 0) process.exitCode = 1;
  } catch (error) {
    if (isZernioBillingPausedError(error)) {
      console.error('Zernio billing is paused; cleanup could not reach the posts API.');
    }
    console.error(error?.message ? error.message : error);
    process.exit(1);
  }
}

const isEntrypoint = !!require.main && require.main.filename === __filename;
if (isEntrypoint) {
  main();
}

module.exports = {
  CONFIRM_TOKEN,
  cleanupZernioDuplicates,
  contentFingerprint,
  findDuplicatePosts,
  normalizeContent,
  parseArgs,
  summarizePost,
};
