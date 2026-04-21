'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { deleteRecord } = require('../scripts/bluesky-delete-replies');

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
