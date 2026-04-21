'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { deleteRecord, run } = require('../scripts/bluesky-delete-replies');

test('deleteRecord refuses URIs owned by a different DID', async () => {
  // Defense-in-depth: even if a caller passes a URI from the wrong repo,
  // deleteRecord should never send a destructive call to someone else's PDS.
  const session = { did: 'did:plc:me', pdsHost: 'pds.example', accessJwt: 'jwt' };
  await assert.rejects(
    deleteRecord(session, 'at://did:plc:not-me/app.bsky.feed.post/3mjzh'),
    /refuse to delete record owned by did:plc:not-me/,
  );
});

test('deleteRecord throws on malformed at:// URIs', async () => {
  const session = { did: 'did:plc:me', pdsHost: 'pds.example', accessJwt: 'jwt' };
  await assert.rejects(deleteRecord(session, 'not-an-at-uri'), /bad uri/);
  await assert.rejects(deleteRecord(session, ''), /bad uri/);
});

test('deleteRecord posts deleteRecord XRPC to session PDS on success', async () => {
  const session = { did: 'did:plc:me', pdsHost: 'pds.example', accessJwt: 'jwt' };
  const calls = [];
  const fakeRequest = (opts, cb) => {
    calls.push({ host: opts.host, path: opts.path, method: opts.method });
    const res = {
      statusCode: 200,
      on(evt, handler) {
        if (evt === 'data') handler(Buffer.from('{}'));
        if (evt === 'end') queueMicrotask(() => handler());
      },
    };
    queueMicrotask(() => cb(res));
    return { on() {}, write() {}, end() {} };
  };
  const ok = await deleteRecord(
    session,
    'at://did:plc:me/app.bsky.feed.post/3mjzhr',
    { request: fakeRequest },
  );
  assert.equal(ok, true);
  assert.equal(calls[0].host, 'pds.example');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].path, '/xrpc/com.atproto.repo.deleteRecord');
});

test('deleteRecord surfaces non-200 status as error', async () => {
  const session = { did: 'did:plc:me', pdsHost: 'pds.example', accessJwt: 'jwt' };
  const fakeRequest = (_opts, cb) => {
    const res = {
      statusCode: 400,
      on(evt, handler) {
        if (evt === 'data') handler(Buffer.from('{"error":"nope"}'));
        if (evt === 'end') queueMicrotask(() => handler());
      },
    };
    queueMicrotask(() => cb(res));
    return { on() {}, write() {}, end() {} };
  };
  await assert.rejects(
    deleteRecord(
      session,
      'at://did:plc:me/app.bsky.feed.post/3mjzhr',
      { request: fakeRequest },
    ),
    /deleteRecord failed: 400/,
  );
});

test('run() returns early when no posted replies are tracked in state', async () => {
  const result = await run({
    sessionFactory: async () => ({
      did: 'did:plc:me', handle: 'me.test', pdsHost: 'pds.example', accessJwt: 'jwt',
    }),
    loadState: () => ({ repliedTo: { bluesky: {} }, lastCheck: {} }),
    saveState: () => { throw new Error('saveState should not be called when nothing to delete'); },
    deleteRecord: async () => { throw new Error('deleteRecord should not be called'); },
  });
  assert.deepEqual(result, { deleted: 0, failed: 0 });
});

test('run() dry-run does not call deleteRecord or saveState', async () => {
  const state = {
    repliedTo: {
      bluesky: {
        'at://did:plc:other/app.bsky.feed.post/parent': {
          postedUri: 'at://did:plc:me/app.bsky.feed.post/reply',
        },
      },
    },
    lastCheck: {},
  };
  let deleteCalled = false;
  let saveCalled = false;
  const result = await run({
    sessionFactory: async () => ({
      did: 'did:plc:me', handle: 'me.test', pdsHost: 'pds.example', accessJwt: 'jwt',
    }),
    loadState: () => state,
    saveState: () => { saveCalled = true; },
    deleteRecord: async () => { deleteCalled = true; },
    dryRun: true,
  });
  assert.deepEqual(result, { deleted: 0, failed: 0 });
  assert.equal(deleteCalled, false);
  assert.equal(saveCalled, false);
});

test('run() deletes tracked URIs and clears them from state', async () => {
  const state = {
    repliedTo: {
      bluesky: {
        'at://did:plc:a/app.bsky.feed.post/p1': {
          postedUri: 'at://did:plc:me/app.bsky.feed.post/r1',
        },
        'at://did:plc:b/app.bsky.feed.post/p2': {
          postedUri: 'at://did:plc:me/app.bsky.feed.post/r2',
        },
      },
    },
    lastCheck: {},
  };
  const deleted = [];
  let savedState = null;
  const result = await run({
    sessionFactory: async () => ({
      did: 'did:plc:me', handle: 'me.test', pdsHost: 'pds.example', accessJwt: 'jwt',
    }),
    loadState: () => state,
    saveState: (s) => { savedState = s; },
    deleteRecord: async (_session, uri) => { deleted.push(uri); return true; },
    dryRun: false,
  });
  assert.deepEqual(result, { deleted: 2, failed: 0 });
  assert.deepEqual(
    deleted.sort(),
    ['at://did:plc:me/app.bsky.feed.post/r1', 'at://did:plc:me/app.bsky.feed.post/r2'],
  );
  // Both entries cleared from state once their postedUri was deleted.
  assert.deepEqual(savedState.repliedTo.bluesky, {});
});

test('run() counts failures without propagating, leaving entry in state', async () => {
  const state = {
    repliedTo: {
      bluesky: {
        'at://did:plc:a/app.bsky.feed.post/p1': {
          postedUri: 'at://did:plc:me/app.bsky.feed.post/r1',
        },
      },
    },
    lastCheck: {},
  };
  let savedState = null;
  const result = await run({
    sessionFactory: async () => ({
      did: 'did:plc:me', handle: 'me.test', pdsHost: 'pds.example', accessJwt: 'jwt',
    }),
    loadState: () => state,
    saveState: (s) => { savedState = s; },
    deleteRecord: async () => { throw new Error('simulated atproto failure'); },
    dryRun: false,
  });
  assert.deepEqual(result, { deleted: 0, failed: 1 });
  // Entry NOT cleared on failure so a retry can pick it up next run.
  assert.ok(savedState.repliedTo.bluesky['at://did:plc:a/app.bsky.feed.post/p1']);
});
