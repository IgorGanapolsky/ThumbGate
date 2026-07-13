'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildLinkedInPostUrl,
  buildRedditProjectThreadComment,
  isDirectRun,
  normalizeRedditPostUrl,
  parseArgs: parseFallbackArgs,
  publishLatestReleaseFallbacks,
} = require('../scripts/social-analytics/publish-latest-release-fallbacks');
const {
  isLatestReleasePost,
  selectLatestByPlatform,
  verifyLatestReleasePosts,
} = require('../scripts/social-analytics/verify-latest-release-posts');

test('fallback argument parsing and receipt URL normalization are deterministic', () => {
  assert.deepEqual(parseFallbackArgs([
    '--platforms=linkedin,reddit',
    '--reddit-parent-id=t3_1uqwwus',
  ]), {
    dryRun: false,
    platforms: ['linkedin', 'reddit'],
    redditParentId: 't3_1uqwwus',
    redditThreadUrl: 'https://www.reddit.com/r/AI_Agents/comments/1uqwwus/weekly_thread_project_display/',
  });
  assert.equal(
    buildLinkedInPostUrl('urn:li:share:123'),
    'https://www.linkedin.com/feed/update/urn:li:share:123/',
  );
  assert.equal(
    normalizeRedditPostUrl('/r/ClaudeAI/comments/abc/release/'),
    'https://www.reddit.com/r/ClaudeAI/comments/abc/release/',
  );
  assert.match(buildRedditProjectThreadComment(), /Disclosure: I maintain ThumbGate/);
  assert.doesNotMatch(buildRedditProjectThreadComment(), /\$|buy\.stripe\.com/);
});

test('direct-run detection compares resolved entrypoint paths', () => {
  const sourcePath = require.resolve('../scripts/social-analytics/publish-latest-release-fallbacks');

  assert.equal(isDirectRun([process.execPath, sourcePath], sourcePath), true);
  assert.equal(isDirectRun([process.execPath, path.join(__dirname, 'other.js')], sourcePath), false);
  assert.equal(isDirectRun([process.execPath], sourcePath), false);
});

test('fallback publisher returns public receipts for LinkedIn and Reddit', async () => {
  const result = await publishLatestReleaseFallbacks({
    platforms: ['linkedin', 'reddit'],
  }, {
    publishLinkedIn: async () => 'urn:li:share:123',
    getRedditToken: async () => 'reddit-token',
    submitRedditComment: async () => ({
      id: 'def',
      name: 't3_abc',
    }),
  }, {
    LINKEDIN_ACCESS_TOKEN: 'test-token',
    LINKEDIN_PERSON_URN: 'urn:li:person:test',
    REDDIT_CLIENT_ID: 'client',
    REDDIT_CLIENT_SECRET: 'secret',
    REDDIT_PASSWORD: 'password',
    REDDIT_USERNAME: 'user',
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.published.length, 2);
  assert.match(result.published[0].url, /linkedin\.com\/feed\/update/);
  assert.match(result.published[1].url, /reddit\.com\/r\/AI_Agents/);
});

test('fallback publisher isolates a failed channel and continues', async () => {
  const result = await publishLatestReleaseFallbacks({
    platforms: ['linkedin', 'reddit'],
  }, {
    publishLinkedIn: async () => {
      throw new Error('LinkedIn token expired');
    },
    getRedditToken: async () => 'reddit-token',
    submitRedditComment: async () => ({ id: 'abc' }),
  });

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].platform, 'linkedin');
  assert.equal(result.published.length, 1);
  assert.equal(result.published[0].platform, 'reddit');
});

test('latest release verifier returns the newest receipt per platform', async () => {
  const result = await verifyLatestReleasePosts({}, {
    listPosts: async () => ([
      {
        _id: 'old-instagram',
        content: 'ThumbGate 1.28.0',
        createdAt: '2026-07-13T09:00:00.000Z',
        platforms: [{ platform: 'instagram', status: 'processing' }],
      },
      {
        _id: 'new-instagram',
        content: 'ThumbGate 1.28.0',
        createdAt: '2026-07-13T10:00:00.000Z',
        platforms: [{
          platform: 'instagram',
          status: 'published',
          platformPostId: 'ig-123',
          platformPostUrl: 'https://www.instagram.com/p/example/',
        }],
      },
      {
        _id: 'unrelated',
        content: 'Another campaign',
        platforms: [{ platform: 'threads', status: 'published' }],
      },
    ]),
  });

  assert.equal(result.matchingPosts, 2);
  assert.deepEqual(result.receipts, [{
    createdAt: '2026-07-13T10:00:00.000Z',
    error: null,
    platform: 'instagram',
    postId: 'ig-123',
    publishedAt: null,
    status: 'published',
    url: 'https://www.instagram.com/p/example/',
    zernioPostId: 'new-instagram',
  }]);
});

test('release matcher accepts copy and campaign UTM markers', () => {
  assert.equal(isLatestReleasePost({ content: 'ThumbGate 1.28.0 shipped' }), true);
  assert.equal(isLatestReleasePost({ content: 'x?utm_campaign=thumbgate_1_28_0_release' }), true);
  assert.equal(isLatestReleasePost({ content: 'ThumbGate operator lab' }), false);
  assert.deepEqual(selectLatestByPlatform([]), []);
});
