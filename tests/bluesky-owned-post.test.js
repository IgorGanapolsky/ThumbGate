'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_POST_CHARS,
  assertPostable,
  main,
  parseArgs,
} = require('../scripts/bluesky-owned-post');

test('parseArgs reads text and confirmation', () => {
  assert.deepEqual(parseArgs(['--text=hello', '--confirm-post=POST']), {
    text: 'hello',
    confirmPost: 'POST',
  });
});

test('assertPostable requires explicit confirmation', () => {
  assert.throws(() => assertPostable({ text: 'hello', confirmPost: '' }), /confirm-post=POST/);
});

test('assertPostable enforces Bluesky character limit', () => {
  assert.throws(
    () => assertPostable({ text: 'x'.repeat(MAX_POST_CHARS + 1), confirmPost: 'POST' }),
    /exceeds 300/
  );
});

test('main posts through injected AT Protocol transport', async () => {
  const result = await main(['--text=hello', '--confirm-post=POST'], {
    sessionFactory: async () => ({
      accessJwt: 'jwt',
      did: 'did:plc:test',
      handle: 'example.bsky.social',
      pdsHost: 'pds.example',
    }),
    request: async (method, host, path, options) => {
      assert.equal(method, 'POST');
      assert.equal(host, 'pds.example');
      assert.equal(path, '/xrpc/com.atproto.repo.createRecord');
      assert.equal(options.body.record.text, 'hello');
      return { status: 200, json: { uri: 'at://did/app.bsky.feed.post/abc', cid: 'cid' } };
    },
  });
  assert.equal(result.uri, 'at://did/app.bsky.feed.post/abc');
});

