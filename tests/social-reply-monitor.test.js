'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  generateReply,
  getTrackedRedditThreadTargets,
  looksLikeQuestion,
  monitor,
  parseRedditThreadTarget,
} = require('../scripts/social-reply-monitor');

test('monitor defaults to Reddit and LinkedIn only (X retired 2026-04-20)', async () => {
  // Run in dry-run with invalid creds so platform checks short-circuit without network.
  // We only want to confirm the default platform list no longer dispatches to X.
  const prev = { ...process.env };
  for (const key of ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USERNAME', 'REDDIT_PASSWORD',
                     'LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_PERSON_URN']) {
    delete process.env[key];
  }
  try {
    const results = await monitor({ dryRun: true });
    assert.ok('reddit' in results, 'Reddit must be in default platform list');
    assert.ok('linkedin' in results, 'LinkedIn must be in default platform list');
    assert.ok(!('x' in results), 'X must not be in the default platform list after 2026-04-20 retirement');
  } finally {
    Object.assign(process.env, prev);
  }
});

test('generateReply acknowledges reddit process advice without pitching the product', async () => {
  const reply = await generateReply(
    'I have found that having skills that define specific processes works better. Another important thing is to review all your context docs for inconsistencies.',
    {
      platform: 'reddit',
      author: 'leogodin217',
      isQuestion: false,
    }
  );

  assert.match(reply, /matches what i have seen/i);
  assert.match(reply, /conflicting context docs/i);
  assert.doesNotMatch(reply, /https?:\/\//i);
  assert.doesNotMatch(reply, /npx thumbgate init/i);
});

test('generateReply returns null for hostile meta reddit comments', async () => {
  const reply = await generateReply(
    'This sounds like bot spam and not what I asked for.',
    {
      platform: 'reddit',
      author: 'someone_else',
      isQuestion: false,
    }
  );

  assert.equal(reply, null);
});

test('generateReply answers Reddit gate over-blocking concerns with scoped policy', async () => {
  const reply = await generateReply(
    'Pre-action gates from thumbs-down is a neat idea. Curious how you avoid over-blocking.',
    {
      platform: 'reddit',
      author: 'AssignmentDull5197',
      isQuestion: true,
    }
  );

  assert.match(reply, /over-blocking/i);
  assert.match(reply, /scope/i);
  assert.match(reply, /Pre-Action Gate/i);
  assert.doesNotMatch(reply, /https?:\/\//i);
});

test('generateReply answers deterministic policy and team sharing questions', async () => {
  const reply = await generateReply(
    'Question: how are you representing the gate rules, is it mostly regex/AST-ish checks on commands/tool args, or are you letting an LLM classify the action and then applying policies? Also curious if youve got a way to share gates across a team without them becoming brittle.',
    {
      platform: 'reddit',
      author: 'Otherwise_Wave9374',
      isQuestion: true,
    }
  );

  assert.match(reply, /deterministic/i);
  assert.match(reply, /tool name, args, cwd/i);
  assert.match(reply, /LLM making the final allow\/deny call/i);
  assert.match(reply, /teams/i);
  assert.doesNotMatch(reply, /https?:\/\//i);
});

test('tracked Reddit thread targets parse post and comment URLs', () => {
  assert.deepEqual(
    parseRedditThreadTarget('https://www.reddit.com/r/ClaudeCode/comments/1szi5qp/comment/oj29gdf/'),
    {
      url: 'https://www.reddit.com/r/ClaudeCode/comments/1szi5qp/comment/oj29gdf/',
      postId: '1szi5qp',
      commentId: 't1_oj29gdf',
    }
  );

  assert.equal(looksLikeQuestion('Curious how you avoid over-blocking.'), true);
  assert.equal(
    getTrackedRedditThreadTargets({
      THUMBGATE_REDDIT_TRACKED_THREADS: 'https://www.reddit.com/r/ClaudeCode/comments/1szi5qp/',
    })[0].postId,
    '1szi5qp'
  );
});

test('monitor drafts tracked Reddit thread replies without posting', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-reddit-monitor-'));
  const prevEnv = { ...process.env };
  const prevFetch = global.fetch;
  process.env.REDDIT_CLIENT_ID = 'test-client';
  process.env.REDDIT_CLIENT_SECRET = 'test-secret';
  process.env.REDDIT_USERNAME = 'eazyigz123';
  process.env.REDDIT_PASSWORD = 'test-password';
  process.env.THUMBGATE_REDDIT_TRACKED_THREADS = 'https://www.reddit.com/r/ClaudeCode/comments/1szi5qp/';
  process.env.THUMBGATE_REPLY_MONITOR_STATE_FILE = path.join(tmp, 'state.json');
  process.env.THUMBGATE_REPLY_DRAFT_FILE = path.join(tmp, 'drafts.jsonl');

  global.fetch = async (url) => {
    const textUrl = String(url);
    if (textUrl.includes('/api/v1/access_token')) {
      return { ok: true, json: async () => ({ access_token: 'token' }) };
    }
    if (textUrl.includes('/message/inbox')) {
      return { ok: true, json: async () => ({ data: { children: [] } }) };
    }
    if (textUrl.includes('/comments/1szi5qp')) {
      return {
        ok: true,
        json: async () => ([
          {
            data: {
              children: [{
                data: {
                  title: 'Local open-source tool that stops AI agents from making you pay twice for the same mistake',
                  subreddit: 'ClaudeCode',
                },
              }],
            },
          },
          {
            data: {
              children: [
                {
                  kind: 't1',
                  data: {
                    name: 't1_overblock',
                    author: 'AssignmentDull5197',
                    body: 'Pre-action gates from thumbs-down is a neat idea. Curious how you avoid over-blocking.',
                    subreddit: 'ClaudeCode',
                    permalink: '/r/ClaudeCode/comments/1szi5qp/comment/overblock/',
                  },
                },
                {
                  kind: 't1',
                  data: {
                    name: 't1_policy',
                    author: 'Otherwise_Wave9374',
                    body: 'Question: how are you representing the gate rules, is it mostly regex/AST-ish checks on commands/tool args, or are you letting an LLM classify the action and then applying policies? Also curious if youve got a way to share gates across a team without them becoming brittle.',
                    subreddit: 'ClaudeCode',
                    permalink: '/r/ClaudeCode/comments/1szi5qp/comment/policy/',
                  },
                },
              ],
            },
          },
        ]),
      };
    }
    throw new Error(`Unexpected fetch URL: ${textUrl}`);
  };

  try {
    const results = await monitor({ platforms: ['reddit'], dryRun: true });
    assert.equal(results.reddit.length, 2);
    assert.equal(results.reddit.every((result) => result.posted === false), true);
    assert.equal(results.reddit.every((result) => result.drafted === true), true);
    assert.equal(results.reddit.every((result) => result.source === 'tracked_thread'), true);

    const drafts = fs.readFileSync(process.env.THUMBGATE_REPLY_DRAFT_FILE, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(drafts.length, 2);
    assert.ok(drafts.every((draft) => draft.status === 'pending_review'));
    assert.ok(drafts.every((draft) => !draft.suggestedReply.includes('http')));
  } finally {
    global.fetch = prevFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in prevEnv)) delete process.env[key];
    }
    Object.assign(process.env, prevEnv);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('monitor still drafts tracked Reddit threads when inbox OAuth fails', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-reddit-public-'));
  const prevEnv = { ...process.env };
  const prevFetch = global.fetch;
  process.env.REDDIT_CLIENT_ID = 'test-client';
  process.env.REDDIT_CLIENT_SECRET = 'test-secret';
  process.env.REDDIT_USERNAME = 'eazyigz123';
  process.env.REDDIT_PASSWORD = 'bad-password';
  process.env.THUMBGATE_REDDIT_TRACKED_THREADS = 'https://www.reddit.com/r/ClaudeCode/comments/1szi5qp/comment/oj29gdf/';
  process.env.THUMBGATE_REPLY_MONITOR_STATE_FILE = path.join(tmp, 'state.json');
  process.env.THUMBGATE_REPLY_DRAFT_FILE = path.join(tmp, 'drafts.jsonl');

  global.fetch = async (url) => {
    const textUrl = String(url);
    if (textUrl.includes('/api/v1/access_token')) {
      return { ok: false, json: async () => ({ error: '401' }) };
    }
    if (textUrl.includes('www.reddit.com/comments/1szi5qp.json')) {
      return {
        ok: true,
        json: async () => ([
          {
            data: {
              children: [{
                data: {
                  title: 'Local open-source tool that stops AI agents from repeating mistakes',
                  subreddit: 'ClaudeCode',
                },
              }],
            },
          },
          {
            data: {
              children: [{
                kind: 't1',
                data: {
                  name: 't1_oj29gdf',
                  author: 'AssignmentDull5197',
                  body: 'Pre-action gates from thumbs-down is a neat idea. Curious how you avoid over-blocking.',
                  subreddit: 'ClaudeCode',
                  permalink: '/r/ClaudeCode/comments/1szi5qp/comment/oj29gdf/',
                },
              }],
            },
          },
        ]),
      };
    }
    throw new Error(`Unexpected fetch URL: ${textUrl}`);
  };

  try {
    const results = await monitor({ platforms: ['reddit'], dryRun: true });
    assert.equal(results.reddit.length, 1);
    assert.equal(results.reddit[0].commentId, 't1_oj29gdf');
    assert.equal(results.reddit[0].source, 'tracked_thread');
    assert.equal(fs.existsSync(process.env.THUMBGATE_REPLY_DRAFT_FILE), true);
  } finally {
    global.fetch = prevFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in prevEnv)) delete process.env[key];
    }
    Object.assign(process.env, prevEnv);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
