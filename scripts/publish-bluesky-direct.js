'use strict';

const fs = require('fs');
const path = require('path');
const {
  createSession,
  atprotoRequest,
  DEFAULT_PDS_HOST,
  buildImagesEmbed,
  buildRichTextFacets,
} = require('./lib/bluesky-atproto');
const { parsePostFile } = require('./post-everywhere');

const DEFAULT_MEDIA = [
  {
    path: path.resolve(__dirname, '../docs/media/meme-agent-destroys-prod.png'),
    alt: 'AI Coding Agents: Expectation vs ThumbGate PreToolUse Reality meme card',
    aspectRatio: { width: 1600, height: 800 },
  },
  {
    path: path.resolve(__dirname, '../docs/media/meme-prompt-vs-hook.png'),
    alt: 'Prompt Engineering vs ThumbGate PreToolUse Infrastructure Firewall meme card',
    aspectRatio: { width: 1600, height: 720 },
  },
];

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

  const facets = buildRichTextFacets(text);
  const embed = await buildImagesEmbed(session, parsed.images || DEFAULT_MEDIA);
  const record = {
    $type: 'app.bsky.feed.post',
    text: text,
    createdAt: new Date().toISOString(),
    ...(facets.length ? { facets } : {}),
    ...(embed ? { embed } : {}),
  };

  console.log(`[bluesky-direct] Publishing post (images=${embed ? embed.images.length : 0}, facets=${facets.length})...`);
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
