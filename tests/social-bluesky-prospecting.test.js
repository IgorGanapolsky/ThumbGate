'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProspectReply,
  normalizeSearchPost,
  parseQueries,
  postUrl,
  prospectBluesky,
  scoreProspect,
} = require('../scripts/social-bluesky-prospecting');

test('parseQueries falls back to focused Bluesky acquisition searches', () => {
  const defaults = parseQueries('');
  assert.ok(defaults.length >= 5);
  assert.ok(defaults.some((query) => /claude code/i.test(query)));
  assert.deepEqual(parseQueries('one,two\nthree'), ['one', 'two', 'three']);
});

test('scoreProspect prioritizes repeated agent failures with guardrail intent', () => {
  const high = scoreProspect({
    text: 'Claude Code keeps repeating the same mistake and deleted files again. Need guardrails for MCP tool calls.',
    metrics: { replies: 2, reposts: 1, likes: 8 },
  });
  assert.ok(high.score >= 20);
  assert.ok(high.reasons.includes('repeated_mistake'));
  assert.ok(high.reasons.includes('dangerous_action'));

  const low = scoreProspect({ text: 'crypto airdrop giveaway for bots', metrics: {} });
  assert.equal(low.score, 0);
});

test('buildProspectReply stays substantive and under Bluesky length', () => {
  const reply = buildProspectReply({
    text: 'My AI agent deleted files again after I told it not to.',
  }, { reasons: ['dangerous_action'] });

  assert.match(reply, /ThumbGate/);
  assert.match(reply, /Pre-Action Gate/);
  assert.ok(reply.length <= 290);
  assert.doesNotMatch(reply, /buy now|free trial/i);
});

test('normalizeSearchPost and postUrl preserve AT Protocol reply targets', () => {
  const post = normalizeSearchPost({
    uri: 'at://did:plc:abc/app.bsky.feed.post/3abc',
    cid: 'cid1',
    author: { did: 'did:plc:abc', handle: 'person.bsky.social' },
    record: { text: 'hello' },
    replyCount: 2,
  }, 'agent memory');

  assert.equal(post.uri, 'at://did:plc:abc/app.bsky.feed.post/3abc');
  assert.equal(post.cid, 'cid1');
  assert.equal(post.metrics.replies, 2);
  assert.equal(postUrl(post), 'https://bsky.app/profile/person.bsky.social/post/3abc');
});

test('prospectBluesky queues draft-only approved=false replies and dedupes state', async () => {
  const savedDrafts = [];
  let savedState = null;
  const state = { seen: {}, lastCheck: null };
  const session = { did: 'did:plc:me', handle: 'me.bsky.social', accessJwt: 'jwt' };
  const prospect = {
    uri: 'at://did:plc:them/app.bsky.feed.post/3abc',
    cid: 'cid1',
    text: 'Claude Code keeps repeating the same mistake and deleted files again. Need guardrails for MCP.',
    author: { did: 'did:plc:them', handle: 'them.bsky.social' },
    metrics: { replies: 1, reposts: 1, likes: 10 },
    query: 'Claude Code repeating mistakes',
  };

  const result = await prospectBluesky({
    sessionFactory: async () => session,
    searchPosts: async () => [
      prospect,
      { ...prospect, uri: 'at://did:plc:me/app.bsky.feed.post/own', author: { did: 'did:plc:me', handle: 'me.bsky.social' } },
    ],
    loadState: () => state,
    saveState: (next) => { savedState = next; },
    saveDraft: (draft) => { savedDrafts.push(draft); },
    queries: ['Claude Code repeating mistakes'],
    maxDrafts: 3,
    now: () => new Date('2026-05-04T15:45:00.000Z'),
  });

  assert.equal(result.queued, 1);
  assert.equal(savedDrafts.length, 1);
  assert.equal(savedDrafts[0].platform, 'bluesky');
  assert.equal(savedDrafts[0].kind, 'prospect_reply');
  assert.equal(savedDrafts[0].approved, false);
  assert.equal(savedDrafts[0].autoPost, false);
  assert.deepEqual(savedDrafts[0].reply.parent, { uri: prospect.uri, cid: prospect.cid });
  assert.ok(savedState.seen[prospect.uri]);
  assert.equal(savedState.lastCheck, '2026-05-04T15:45:00.000Z');
});

test('prospectBluesky dry-run does not save drafts or state', async () => {
  let writes = 0;
  const result = await prospectBluesky({
    sessionFactory: async () => ({ did: 'did:plc:me', handle: 'me.bsky.social', accessJwt: 'jwt' }),
    searchPosts: async () => [{
      uri: 'at://did:plc:them/app.bsky.feed.post/3abc',
      cid: 'cid1',
      text: 'MCP tool call mistake repeated again and needs policy guardrails.',
      author: { did: 'did:plc:them', handle: 'them.bsky.social' },
      metrics: {},
      query: 'MCP tool call mistake',
    }],
    loadState: () => ({ seen: {}, lastCheck: null }),
    saveState: () => { writes += 1; },
    saveDraft: () => { writes += 1; },
    queries: ['MCP tool call mistake'],
    dryRun: true,
  });

  assert.equal(result.queued, 0);
  assert.equal(result.drafts.length, 1);
  assert.equal(writes, 0);
});
