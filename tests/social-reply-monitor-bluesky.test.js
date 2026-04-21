'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractPostText,
  buildReplyContext,
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
