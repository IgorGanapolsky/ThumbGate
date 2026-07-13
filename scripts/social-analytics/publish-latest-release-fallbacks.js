#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  buildLatestReleasePost,
  buildLatestReleaseUrl,
} = require('./publish-thumbgate-launch');
const { publishTextPost } = require('./publishers/linkedin');
const { getRedditToken, submitComment } = require('./publishers/reddit');
const qualityGate = require('../social-quality-gate');

const DEFAULT_REDDIT_PARENT_ID = 't3_1uqwwus';
const DEFAULT_REDDIT_THREAD_URL = 'https://www.reddit.com/r/AI_Agents/comments/1uqwwus/weekly_thread_project_display/';
const SUPPORTED_PLATFORMS = new Set(['linkedin', 'reddit']);

function parseArgs(argv = []) {
  const options = {
    dryRun: false,
    platforms: [],
    redditParentId: DEFAULT_REDDIT_PARENT_ID,
    redditThreadUrl: DEFAULT_REDDIT_THREAD_URL,
  };

  for (const token of argv) {
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (token.startsWith('--platforms=')) {
      options.platforms = token.slice('--platforms='.length)
        .split(',')
        .map((platform) => platform.trim().toLowerCase())
        .filter(Boolean);
      continue;
    }
    if (token.startsWith('--reddit-parent-id=')) {
      options.redditParentId = token.slice('--reddit-parent-id='.length).trim() || DEFAULT_REDDIT_PARENT_ID;
      continue;
    }
    if (token.startsWith('--reddit-thread-url=')) {
      options.redditThreadUrl = token.slice('--reddit-thread-url='.length).trim() || DEFAULT_REDDIT_THREAD_URL;
    }
  }

  return options;
}

function buildLinkedInPostUrl(postUrn) {
  const normalized = String(postUrn || '').trim();
  return normalized ? `https://www.linkedin.com/feed/update/${normalized}/` : null;
}

function normalizeRedditPostUrl(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return `https://www.reddit.com${normalized.startsWith('/') ? '' : '/'}${normalized}`;
}

function buildRedditProjectThreadComment() {
  const releaseUrl = buildLatestReleaseUrl('reddit', 'release_1_28_0_ai_agents_project_thread');
  return [
    'Disclosure: I maintain ThumbGate.',
    '',
    '`thumbgate@1.28.0` adds a guided `npx thumbgate quickstart`, opt-in fail-closed approval gates for autonomous runs (`THUMBGATE_AUTONOMOUS=1`), a Hermes `pre_tool_call` adapter, and regression checks before feedback-derived rules can hard-block.',
    '',
    `Release notes and MIT-licensed source: ${releaseUrl}`,
    '',
    'I would value technical feedback on the autonomous approval semantics and the Hermes fail-open versus strict-mode tradeoff.',
  ].join('\n');
}

function buildRedditCommentUrl(comment, threadUrl = DEFAULT_REDDIT_THREAD_URL) {
  const permalink = normalizeRedditPostUrl(comment?.permalink);
  if (permalink) return permalink;
  const id = String(comment?.id || comment?.name || '').replace(/^t1_/, '').trim();
  if (!id) return null;
  return `${String(threadUrl).replace(/\/?$/, '/')}${id}/`;
}

function resolvePlatforms(platforms = []) {
  const requested = platforms.length > 0 ? platforms : ['linkedin', 'reddit'];
  return requested
    .map((platform) => String(platform).trim().toLowerCase())
    .filter((platform) => SUPPORTED_PLATFORMS.has(platform));
}

function buildPreview(platform) {
  const isReddit = platform === 'reddit';
  return {
    content: isReddit ? buildRedditProjectThreadComment() : buildLatestReleasePost(platform),
    platform,
    title: isReddit ? 'r/AI_Agents weekly project-display comment' : null,
  };
}

async function publishLinkedInFallback(content, api, env) {
  const postUrn = await api.publishLinkedIn(
    env.LINKEDIN_ACCESS_TOKEN,
    env.LINKEDIN_PERSON_URN,
    content,
  );
  const url = buildLinkedInPostUrl(postUrn);
  if (!url) throw new Error('LinkedIn publish returned no post URN');
  return { platform: 'linkedin', postId: postUrn, url };
}

async function publishRedditFallback(content, options, api, env) {
  const gateResult = qualityGate.gatePost(content);
  if (!gateResult.allowed) throw new Error('Reddit quality gate blocked the release comment');

  const redditToken = await api.getRedditToken(
    env.REDDIT_CLIENT_ID,
    env.REDDIT_CLIENT_SECRET,
    env.REDDIT_USERNAME,
    env.REDDIT_PASSWORD,
  );
  const redditResult = await api.submitRedditComment(
    redditToken,
    env.REDDIT_USER_AGENT || `thumbgate/1.0 by ${env.REDDIT_USERNAME}`,
    {
      parentId: options.redditParentId || DEFAULT_REDDIT_PARENT_ID,
      text: content,
    },
  );
  const url = buildRedditCommentUrl(redditResult, options.redditThreadUrl);
  if (!url) throw new Error('Reddit publish returned no public comment URL');
  return {
    platform: 'reddit',
    postId: redditResult.name || redditResult.id || null,
    subreddit: 'AI_Agents',
    url,
  };
}

function publishPlatformFallback(platform, content, options, api, env) {
  if (platform === 'linkedin') return publishLinkedInFallback(content, api, env);
  return publishRedditFallback(content, options, api, env);
}

async function publishLatestReleaseFallbacks(options = {}, publishers = {}, env = process.env) {
  const platforms = resolvePlatforms(options.platforms);
  const api = {
    publishLinkedIn: publishers.publishLinkedIn || publishTextPost,
    getRedditToken: publishers.getRedditToken || getRedditToken,
    submitRedditComment: publishers.submitRedditComment || submitComment,
  };
  const results = {
    dryRun: Boolean(options.dryRun),
    errors: [],
    previews: [],
    published: [],
  };

  for (const platform of platforms) {
    const preview = buildPreview(platform);
    results.previews.push(preview);
    if (results.dryRun) continue;

    try {
      const receipt = await publishPlatformFallback(platform, preview.content, options, api, env);
      results.published.push(receipt);
    } catch (error) {
      results.errors.push({
        error: error?.message || String(error),
        platform,
      });
    }
  }

  return results;
}

async function main() {
  const results = await publishLatestReleaseFallbacks(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  if (results.errors.length > 0) process.exitCode = 1;
}

function isDirectRun(argv = process.argv, filename = __filename) {
  if (!argv[1]) return false;
  return path.resolve(argv[1]) === path.resolve(filename);
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_REDDIT_PARENT_ID,
  DEFAULT_REDDIT_THREAD_URL,
  buildLinkedInPostUrl,
  buildRedditCommentUrl,
  buildRedditProjectThreadComment,
  isDirectRun,
  normalizeRedditPostUrl,
  parseArgs,
  publishLatestReleaseFallbacks,
};
