'use strict';

const path = require('node:path');
const {
  atprotoRequest,
  createSession,
  DEFAULT_PDS_HOST,
  parseAtUri,
  buildImagesEmbed,
  buildRichTextFacets,
} = require('../../lib/bluesky-atproto');

const DEFAULT_THUMBGATE_MEDIA = [
  {
    path: path.resolve(__dirname, '../../../docs/media/meme-agent-destroys-prod.png'),
    alt: 'ThumbGate PreToolUse Interdiction vs AI Coding Agent Destroying Production meme card',
    aspectRatio: { width: 1600, height: 800 },
  },
  {
    path: path.resolve(__dirname, '../../../docs/media/meme-prompt-vs-hook.png'),
    alt: 'Prompt Engineering vs ThumbGate PreToolUse Infrastructure Firewall comparison card',
    aspectRatio: { width: 1600, height: 720 },
  },
];

function truncateGraphemes(text, max) {
  return [...String(text || '')].slice(0, max).join('');
}

async function publishPost({
  text,
  images,
  env = process.env,
  request,
  createdAt = new Date().toISOString(),
} = {}) {
  const trimmed = truncateGraphemes(text, 300);
  if (!trimmed) throw new Error('text is required');

  const session = await createSession({ env, request });
  const facets = buildRichTextFacets(trimmed);
  const candidateImages = images !== undefined ? images : (request ? [] : DEFAULT_THUMBGATE_MEDIA);
  const embed = await buildImagesEmbed(session, candidateImages, { request });
  const record = {
    $type: 'app.bsky.feed.post',
    text: trimmed,
    createdAt,
    ...(facets.length ? { facets } : {}),
    ...(embed ? { embed } : {}),
  };
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
      request,
    }
  );

  if (status !== 200 || !json?.uri) {
    throw new Error(`Bluesky createRecord failed: ${status} ${json?.error || ''}`.trim());
  }

  const parsed = parseAtUri(json.uri);
  const url = parsed
    ? `https://bsky.app/profile/${session.handle}/post/${parsed.rkey}`
    : null;
  return {
    uri: json.uri,
    cid: json.cid,
    url,
    handle: session.handle,
  };
}

module.exports = {
  publishPost,
  truncateGraphemes,
};
