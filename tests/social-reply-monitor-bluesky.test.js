'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractPostText,
  buildReplyContext,
  monitor,
} = require('../scripts/social-reply-monitor-bluesky');

test('extractPostText returns record text when present', () => {
  const note = { record: { text: 'hello world' } };
  assert.equal(extractPostText(note), 'hello world');
});

test('extractPostText returns empty string for missing or non-string text', () => {
  assert.equal(extractPostText(null), '');
  assert.equal(extractPostText({}), '');
  assert.equal(extractPostText({ record: null }), '');
  assert.equal(extractPostText({ record: {} }), '');
  assert.equal(extractPostText({ record: { text: 42 } }), '');
});

test('buildReplyContext routes root CIDs from the reply chain', () => {
  const note = {
    uri: 'at://did:plc:user/app.bsky.feed.post/leaf',
    cid: 'leafCid',
    author: { handle: 'author.bsky.social', did: 'did:plc:author' },
    record: {
      text: 'Is this a question?',
      reply: {
        root: { uri: 'at://did:plc:orig/app.bsky.feed.post/root', cid: 'rootCid' },
        parent: { uri: 'ignored', cid: 'ignored' },
      },
    },
  };
  const ctx = buildReplyContext(note);
  assert.equal(ctx.platform, 'bluesky');
  assert.equal(ctx.author, 'author.bsky.social');
  assert.equal(ctx.isQuestion, true);
  assert.equal(ctx.rootUri, 'at://did:plc:orig/app.bsky.feed.post/root');
  assert.equal(ctx.rootCid, 'rootCid');
  // Parent always points at the notification post itself — that's the one we
  // are replying to, regardless of what the record's reply.parent says.
  assert.equal(ctx.parentUri, note.uri);
  assert.equal(ctx.parentCid, note.cid);
});

test('buildReplyContext falls back to notification uri for top-level mentions', () => {
  const note = {
    uri: 'at://did:plc:author/app.bsky.feed.post/mention',
    cid: 'mentionCid',
    author: { handle: 'author.bsky.social' },
    record: { text: 'hey there' },
  };
  const ctx = buildReplyContext(note);
  assert.equal(ctx.isQuestion, false);
  assert.equal(ctx.rootUri, note.uri);
  assert.equal(ctx.rootCid, note.cid);
  assert.equal(ctx.parentUri, note.uri);
  assert.equal(ctx.parentCid, note.cid);
});

test('buildReplyContext labels unknown authors', () => {
  const note = { uri: 'at://x/app.bsky.feed.post/y', cid: 'c', record: { text: 'anon' } };
  const ctx = buildReplyContext(note);
  assert.equal(ctx.author, 'unknown');
});

test('monitor queues drafts in dry-run without writing state', async () => {
  const session = { did: 'did:plc:me', handle: 'me.test', pdsHost: 'pds.example', accessJwt: 'jwt' };
  const notifications = [
    {
      uri: 'at://did:plc:other/app.bsky.feed.post/a',
      cid: 'cidA',
      reason: 'reply',
      indexedAt: '2026-04-21T00:00:00Z',
      author: { handle: 'someone.bsky.social', did: 'did:plc:someone' },
      record: { text: 'hey what is thumbgate?' },
    },
    {
      // Own reply — should be skipped
      uri: 'at://did:plc:me/app.bsky.feed.post/self',
      cid: 'cidSelf',
      reason: 'reply',
      indexedAt: '2026-04-21T00:00:00Z',
      author: { handle: 'me.test', did: 'did:plc:me' },
      record: { text: 'self' },
    },
    {
      // Non-actionable reason — filtered before the loop
      uri: 'at://did:plc:other/app.bsky.feed.post/like',
      cid: 'cidLike',
      reason: 'like',
      author: { handle: 'fan.bsky.social' },
      record: { text: '' },
    },
  ];

  let savedDraft = null;
  let savedState = null;
  const result = await monitor({
    sessionFactory: async () => session,
    listNotifications: async () => notifications,
    generateReply: async (text) => `drafted reply to: ${text}`,
    saveDraft: (d) => { savedDraft = d; },
    saveState: (s) => { savedState = s; },
    loadState: () => ({ repliedTo: { bluesky: {} }, lastCheck: {} }),
    dryRun: true,
  });

  assert.equal(result.notifications, 3);
  assert.equal(result.actionable, 2);
  assert.equal(result.queued, 0); // dry-run doesn't queue
  assert.equal(savedDraft, null);
  assert.equal(savedState, null); // dry-run skips saveState
});

test('monitor writes draft + state on real run', async () => {
  const session = { did: 'did:plc:me', handle: 'me.test', pdsHost: 'pds.example', accessJwt: 'jwt' };
  const notifications = [
    {
      uri: 'at://did:plc:other/app.bsky.feed.post/a',
      cid: 'cidA',
      reason: 'reply',
      indexedAt: '2026-04-21T00:00:00Z',
      author: { handle: 'someone.bsky.social', did: 'did:plc:someone' },
      record: { text: 'hello' },
    },
  ];

  let savedDraft = null;
  let savedState = null;
  const result = await monitor({
    sessionFactory: async () => session,
    listNotifications: async () => notifications,
    generateReply: async () => 'canned reply',
    saveDraft: (d) => { savedDraft = d; },
    saveState: (s) => { savedState = s; },
    loadState: () => ({ repliedTo: { bluesky: {} }, lastCheck: {} }),
    dryRun: false,
  });

  assert.equal(result.queued, 1);
  assert.ok(savedDraft);
  assert.equal(savedDraft.platform, 'bluesky');
  assert.equal(savedDraft.draftReply, 'canned reply');
  assert.equal(savedDraft.autoPost, false);
  assert.ok(savedState);
  assert.ok(savedState.repliedTo.bluesky['at://did:plc:other/app.bsky.feed.post/a']);
  assert.ok(savedState.lastCheck.bluesky);
});

test('monitor skips notifications already recorded as replied', async () => {
  const session = { did: 'did:plc:me', handle: 'me.test', pdsHost: 'pds.example', accessJwt: 'jwt' };
  const notifications = [
    {
      uri: 'at://did:plc:other/app.bsky.feed.post/alreadyDone',
      cid: 'cidX',
      reason: 'reply',
      author: { handle: 'someone.bsky.social' },
      record: { text: 'hello' },
    },
  ];
  const state = {
    repliedTo: {
      bluesky: {
        'at://did:plc:other/app.bsky.feed.post/alreadyDone': { queuedAt: 'earlier' },
      },
    },
    lastCheck: {},
  };
  let gen = 0;
  const result = await monitor({
    sessionFactory: async () => session,
    listNotifications: async () => notifications,
    generateReply: async () => { gen += 1; return 'should not'; },
    saveDraft: () => {},
    saveState: () => {},
    loadState: () => state,
    dryRun: false,
  });
  assert.equal(result.queued, 0);
  assert.equal(result.skipped, 1);
  assert.equal(gen, 0);
});
