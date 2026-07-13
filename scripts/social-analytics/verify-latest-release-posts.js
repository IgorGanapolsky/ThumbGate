#!/usr/bin/env node
'use strict';

const { listPosts } = require('./publishers/zernio');

const LATEST_RELEASE_MARKERS = [
  'ThumbGate 1.28.0',
  'utm_campaign=thumbgate_1_28_0_release',
];

function parseArgs(argv = []) {
  const limitArg = argv.find((token) => token.startsWith('--limit='));
  return {
    limit: limitArg ? Number(limitArg.slice('--limit='.length)) || 100 : 100,
  };
}

function isLatestReleasePost(post) {
  const haystack = `${post?.title || ''}\n${post?.content || ''}`;
  return LATEST_RELEASE_MARKERS.some((marker) => haystack.includes(marker));
}

function flattenPostReceipts(post) {
  const platforms = Array.isArray(post?.platforms) ? post.platforms : [];
  return platforms.map((entry) => ({
    createdAt: post.createdAt || null,
    error: entry.errorMessage || entry.error || null,
    platform: String(entry.platform || '').trim().toLowerCase(),
    postId: entry.platformPostId || null,
    publishedAt: entry.publishedAt || null,
    status: String(entry.status || post.status || 'unknown').trim().toLowerCase(),
    url: entry.platformPostUrl || null,
    zernioPostId: post._id || post.id || null,
  })).filter((receipt) => receipt.platform);
}

function selectLatestByPlatform(receipts = []) {
  const latest = new Map();
  for (const receipt of receipts) {
    const existing = latest.get(receipt.platform);
    const receiptTime = new Date(receipt.publishedAt || receipt.createdAt || 0).getTime();
    const existingTime = new Date(existing?.publishedAt || existing?.createdAt || 0).getTime();
    if (!existing || receiptTime >= existingTime) latest.set(receipt.platform, receipt);
  }
  return [...latest.values()].sort((left, right) => left.platform.localeCompare(right.platform));
}

async function verifyLatestReleasePosts(options = {}, api = {}) {
  const fetchPosts = api.listPosts || listPosts;
  const posts = await fetchPosts({ limit: options.limit || 100 });
  const matchingPosts = posts.filter(isLatestReleasePost);
  const receipts = selectLatestByPlatform(matchingPosts.flatMap(flattenPostReceipts));
  return {
    matchingPosts: matchingPosts.length,
    receipts,
  };
}

async function main() {
  const result = await verifyLatestReleasePosts(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  flattenPostReceipts,
  isLatestReleasePost,
  parseArgs,
  selectLatestByPlatform,
  verifyLatestReleasePosts,
};
