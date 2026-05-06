#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zernio = require('./publishers/zernio');

const DEFAULT_PLATFORMS = ['instagram', 'tiktok'];
const DEFAULT_LIMIT = 200;

function parseArgs(argv = []) {
  const opts = {
    confirmDelete: false,
    limit: DEFAULT_LIMIT,
    out: '',
    platforms: DEFAULT_PLATFORMS,
    status: '',
  };

  for (const arg of argv) {
    if (arg === '--confirm-delete') opts.confirmDelete = true;
    else if (arg.startsWith('--limit=')) opts.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--out=')) opts.out = arg.slice('--out='.length);
    else if (arg.startsWith('--platforms=')) {
      opts.platforms = arg.slice('--platforms='.length).split(',').map((p) => p.trim()).filter(Boolean);
    } else if (arg.startsWith('--status=')) {
      opts.status = arg.slice('--status='.length).trim();
    }
  }

  if (!Number.isFinite(opts.limit) || opts.limit < 1) opts.limit = DEFAULT_LIMIT;
  return opts;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizePlatform(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replaceAll(/https?:\/\/\S+/g, ' ')
    .replaceAll(/[#@][\w.-]+/g, ' ')
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function normalizeTimestamp(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function resolvePostId(post) {
  return firstString(post?._id, post?.id, post?.postId, post?.post_id);
}

function resolveCreatedAt(post) {
  return firstString(post?.publishedAt, post?.published_at, post?.createdAt, post?.created_at, post?.updatedAt, post?.updated_at);
}

function resolvePlatform(post) {
  const direct = firstString(post?.platform);
  if (direct) return normalizePlatform(direct);
  const platformEntry = Array.isArray(post?.platforms) ? post.platforms[0] : null;
  return normalizePlatform(firstString(platformEntry?.platform, platformEntry?.name));
}

function resolveUrl(post) {
  const platformEntry = Array.isArray(post?.platforms) ? post.platforms[0] : null;
  return firstString(
    post?.url,
    post?.postUrl,
    post?.post_url,
    post?.platformPostUrl,
    post?.platform_post_url,
    platformEntry?.platformPostUrl,
    platformEntry?.postUrl,
    platformEntry?.url,
  );
}

function resolveMediaSignature(post) {
  let mediaItems = [];
  if (Array.isArray(post?.mediaItems)) {
    mediaItems = post.mediaItems;
  } else if (Array.isArray(post?.media)) {
    mediaItems = post.media;
  }

  return mediaItems
    .map((item) => firstString(item?.url, item?.publicUrl, item?.key, item?.id))
    .filter(Boolean)
    .sort()
    .join('|');
}

function resolveCreativeText(post) {
  return firstString(
    post?.title,
    post?.content,
    post?.caption,
    post?.text,
    post?.description,
    post?.message,
  );
}

function buildDuplicateKey(post) {
  const platform = resolvePlatform(post);
  const text = normalizeText(resolveCreativeText(post));
  const media = normalizeText(resolveMediaSignature(post));
  const signature = [text, media].filter(Boolean).join(' | ');
  if (!platform || !signature) return '';
  return `${platform}::${signature}`;
}

function summarizePost(post) {
  return {
    id: resolvePostId(post),
    platform: resolvePlatform(post),
    createdAt: resolveCreatedAt(post),
    url: resolveUrl(post),
    text: resolveCreativeText(post).slice(0, 180),
    key: buildDuplicateKey(post),
  };
}

function findDuplicateGroups(posts, platforms = DEFAULT_PLATFORMS) {
  const allowed = new Set(platforms.map(normalizePlatform));
  const groups = new Map();

  for (const post of posts) {
    const platform = resolvePlatform(post);
    if (!allowed.has(platform)) continue;
    const id = resolvePostId(post);
    const key = buildDuplicateKey(post);
    if (!id || !key) continue;
    const list = groups.get(key) || [];
    list.push(post);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => {
      const sorted = [...group].sort((a, b) => normalizeTimestamp(resolveCreatedAt(b)) - normalizeTimestamp(resolveCreatedAt(a)));
      return {
        key,
        keep: summarizePost(sorted[0]),
        delete: sorted.slice(1).map(summarizePost),
      };
    });
}

async function run(options = {}, deps = {}) {
  const opts = { ...parseArgs([]), ...options };
  const listPosts = deps.listPosts || zernio.listPosts;
  const deletePost = deps.deletePost || zernio.deletePost;
  const posts = await listPosts({ limit: opts.limit, status: opts.status || undefined });
  const duplicateGroups = findDuplicateGroups(posts, opts.platforms);
  const deleted = [];
  const errors = [];

  if (opts.confirmDelete) {
    for (const group of duplicateGroups) {
      for (const duplicate of group.delete) {
        try {
          await deletePost(duplicate.id);
          deleted.push(duplicate);
        } catch (error) {
          errors.push({ id: duplicate.id, platform: duplicate.platform, error: error.message });
        }
      }
    }
  }

  const result = {
    dryRun: !opts.confirmDelete,
    platforms: opts.platforms,
    scanned: posts.length,
    duplicateGroups,
    deleteCandidateCount: duplicateGroups.reduce((sum, group) => sum + group.delete.length, 0),
    deleted,
    errors,
  };

  if (opts.out) {
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, JSON.stringify(result, null, 2));
  }

  return result;
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
  if (result.dryRun && result.deleteCandidateCount > 0) {
    console.log(`\nDRY RUN: rerun with --confirm-delete to delete ${result.deleteCandidateCount} older duplicate post(s).`);
  }
}

module.exports = {
  buildDuplicateKey,
  findDuplicateGroups,
  normalizeText,
  parseArgs,
  run,
  summarizePost,
};

if (path.resolve(process.argv[1] || '') === __filename) {
  run(parseArgs(process.argv.slice(2)))
    .then(printResult)
    .catch((error) => {
      console.error(`[cleanup-zernio-duplicates] ${error.message}`);
      process.exit(1);
    });
}
