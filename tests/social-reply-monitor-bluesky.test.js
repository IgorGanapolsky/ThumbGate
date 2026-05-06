'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractPostText,
  buildReplyContext,
  monitor,
  assertPublishableDraft,
  isSafeAutoReply,
  parseLimitArg,
  publishApprovedDrafts,
  publishReply,
  reconcileDraftsWithState,
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

test('monitor can auto-approve a bounded safe Bluesky reply for autonomous publishing', async () => {
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
  const result = await monitor({
    sessionFactory: async () => session,
    listNotifications: async () => notifications,
    generateReply: async () => 'Pre-action checks are useful because they stop the repeated bad move before another tool call spends money.',
    saveDraft: (d) => { savedDraft = d; },
    saveState: () => {},
    loadState: () => ({ repliedTo: { bluesky: {} }, lastCheck: {} }),
    dryRun: false,
    autoApproveSafe: true,
    autoApproveLimit: 1,
  });

  assert.equal(result.approved, 1);
  assert.equal(savedDraft.approved, true);
  assert.equal(savedDraft.autoPost, true);
  assert.equal(savedDraft.approvalReason, 'safe_auto_reply');
});

test('safe auto-reply gate rejects promotional or link-bearing replies', () => {
  assert.equal(isSafeAutoReply('This local check stops the repeated bad move before the next tool call.'), true);
  assert.equal(isSafeAutoReply('Buy now at https://example.com'), false);
  assert.equal(isSafeAutoReply('DM me for a limited time sale'), false);
});

test('parseLimitArg accepts positive integer limits only', () => {
  assert.equal(parseLimitArg(['--limit=2']), 2);
  assert.equal(parseLimitArg(['--limit=0']), null);
  assert.equal(parseLimitArg(['--limit=nope']), null);
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

test('publishReply refuses unapproved drafts', async () => {
  await assert.rejects(
    () => publishReply({ did: 'did:plc:me', accessJwt: 'jwt', pdsHost: 'pds.example' }, {
      platform: 'bluesky',
      approved: false,
      draftReply: 'hello',
      reply: {
        root: { uri: 'at://did:plc:a/app.bsky.feed.post/root', cid: 'rootCid' },
        parent: { uri: 'at://did:plc:a/app.bsky.feed.post/parent', cid: 'parentCid' },
      },
    }),
    /unapproved/,
  );
});

test('publishReply creates an AT Protocol reply record for approved drafts', async () => {
  let call = null;
  const draft = {
    platform: 'bluesky',
    approved: true,
    draftReply: 'The distinction is observability vs enforcement.',
    reply: {
      root: { uri: 'at://did:plc:a/app.bsky.feed.post/root', cid: 'rootCid' },
      parent: { uri: 'at://did:plc:a/app.bsky.feed.post/parent', cid: 'parentCid' },
    },
  };
  const result = await publishReply(
    { did: 'did:plc:me', accessJwt: 'jwt', pdsHost: 'pds.example' },
    draft,
    {
      now: () => new Date('2026-05-04T13:00:00Z'),
      request: async (...args) => {
        call = args;
        return { status: 200, json: { uri: 'at://did:plc:me/app.bsky.feed.post/reply', cid: 'replyCid' } };
      },
    },
  );

  assert.equal(result.uri, 'at://did:plc:me/app.bsky.feed.post/reply');
  assert.equal(call[0], 'POST');
  assert.equal(call[1], 'pds.example');
  assert.equal(call[2], '/xrpc/com.atproto.repo.createRecord');
  assert.equal(call[3].body.collection, 'app.bsky.feed.post');
  assert.equal(call[3].body.record.text, draft.draftReply);
  assert.deepEqual(call[3].body.record.reply.parent, draft.reply.parent);
});

test('publishApprovedDrafts blocks live publishing without explicit confirm flag', async () => {
  const result = await publishApprovedDrafts({
    loadDrafts: () => [{
      platform: 'bluesky',
      approved: true,
      draftReply: 'ready',
      reply: {
        root: { uri: 'at://did:plc:a/app.bsky.feed.post/root', cid: 'rootCid' },
        parent: { uri: 'at://did:plc:a/app.bsky.feed.post/parent', cid: 'parentCid' },
      },
    }],
    confirmPublish: false,
    dryRun: false,
  });

  assert.equal(result.blocked, true);
  assert.equal(result.reason, 'missing_confirm_publish');
  assert.equal(result.published, 0);
});

test('publishApprovedDrafts records posted URI in reply monitor state after confirmed publish', async () => {
  let savedState = null;
  let savedDrafts = null;
  const drafts = [{
    platform: 'bluesky',
    approved: true,
    draftReply: 'ready',
    reply: {
      root: { uri: 'at://did:plc:a/app.bsky.feed.post/root', cid: 'rootCid' },
      parent: { uri: 'at://did:plc:a/app.bsky.feed.post/parent', cid: 'parentCid' },
    },
  }];
  const result = await publishApprovedDrafts({
    sessionFactory: async () => ({ did: 'did:plc:me', accessJwt: 'jwt', pdsHost: 'pds.example' }),
    loadDrafts: () => drafts,
    loadState: () => ({ repliedTo: { bluesky: {} }, lastCheck: {} }),
    saveDrafts: (nextDrafts) => { savedDrafts = nextDrafts.map((draft) => ({ ...draft })); },
    saveState: (state) => { savedState = state; },
    publishReply: async () => ({
      uri: 'at://did:plc:me/app.bsky.feed.post/reply',
      cid: 'replyCid',
      parentUri: 'at://did:plc:a/app.bsky.feed.post/parent',
    }),
    confirmPublish: true,
    dryRun: false,
  });

  assert.equal(result.published, 1);
  assert.equal(savedState.repliedTo.bluesky['at://did:plc:a/app.bsky.feed.post/parent'].postedUri, 'at://did:plc:me/app.bsky.feed.post/reply');
  assert.equal(savedDrafts.length, 1);
  assert.equal(savedDrafts[0].postedUri, 'at://did:plc:me/app.bsky.feed.post/reply');
  assert.equal(savedDrafts[0].postedCid, 'replyCid');
  assert.ok(savedDrafts[0].postedAt);
});

test('reconcileDraftsWithState backfills posted metadata from reply monitor state', () => {
  const drafts = [{
    platform: 'bluesky',
    approved: true,
    draftReply: 'ready',
    reply: {
      root: { uri: 'at://did:plc:a/app.bsky.feed.post/root', cid: 'rootCid' },
      parent: { uri: 'at://did:plc:a/app.bsky.feed.post/parent', cid: 'parentCid' },
    },
  }];
  const state = {
    repliedTo: {
      bluesky: {
        'at://did:plc:a/app.bsky.feed.post/parent': {
          postedUri: 'at://did:plc:me/app.bsky.feed.post/reply',
          postedCid: 'replyCid',
          postedAt: '2026-05-05T18:40:00.000Z',
        },
      },
    },
  };

  const changed = reconcileDraftsWithState(drafts, state);

  assert.equal(changed, true);
  assert.equal(drafts[0].postedUri, 'at://did:plc:me/app.bsky.feed.post/reply');
  assert.equal(drafts[0].postedCid, 'replyCid');
  assert.equal(drafts[0].postedAt, '2026-05-05T18:40:00.000Z');
});
