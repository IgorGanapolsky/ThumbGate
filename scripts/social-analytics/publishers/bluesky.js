'use strict';

const { atprotoRequest, createSession, DEFAULT_PDS_HOST, parseAtUri } = require('../../lib/bluesky-atproto');

function truncateGraphemes(text, max) {
  return [...String(text || '')].slice(0, max).join('');
}

async function publishPost({
  text,
  env = process.env,
  request,
  createdAt = new Date().toISOString(),
} = {}) {
  const trimmed = truncateGraphemes(text, 300);
  if (!trimmed) throw new Error('text is required');

  const session = await createSession({ env, request });
  const record = {
    $type: 'app.bsky.feed.post',
    text: trimmed,
    createdAt,
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
