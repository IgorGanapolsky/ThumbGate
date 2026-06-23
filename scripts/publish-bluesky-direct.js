'use strict';

const fs = require('fs');
const path = require('path');
const { createSession, atprotoRequest, DEFAULT_PDS_HOST } = require('./lib/bluesky-atproto');
const { parsePostFile } = require('./post-everywhere');

async function main() {
  const postPath = process.argv[2];
  if (!postPath) {
    console.error('Usage: node scripts/publish-bluesky-direct.js <post-file-path> [--dry-run]');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const parsed = parsePostFile(postPath);
  
  const text = [parsed.title, parsed.body].filter(Boolean).join('\n\n').slice(0, 300);
  console.log(`[bluesky-direct] Text to post (${text.length} chars):\n---\n${text}\n---`);
  
  if (dryRun) {
    console.log('[dry-run] Dry run — not posting to Bluesky.');
    return;
  }
  
  console.log('[bluesky-direct] Creating session...');
  const session = await createSession();
  console.log(`[bluesky-direct] Authenticated as ${session.handle} (${session.did})`);
  
  const record = {
    $type: 'app.bsky.feed.post',
    text: text,
    createdAt: new Date().toISOString(),
  };
  
  console.log('[bluesky-direct] Publishing post...');
  const { status, json } = await atprotoRequest(
    'POST',
    session.pdsHost || DEFAULT_PDS_HOST,
    '/xrpc/com.atproto.repo.createRecord',
    {
      headers: { Authorization: `Bearer ${session.accessJwt}` },
      body: {
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record,
      },
    }
  );
  
  if (status !== 200 || !json.uri) {
    throw new Error(`createRecord failed: ${status} ${json.error || ''}`);
  }
  console.log(`[bluesky-direct] Successfully posted! URI: ${json.uri}, CID: ${json.cid}`);
}

main().catch(err => {
  console.error('[bluesky-direct] ERROR:', err);
  process.exit(1);
});
