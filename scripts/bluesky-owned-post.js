#!/usr/bin/env node
'use strict';

const {
  DEFAULT_PDS_HOST,
  atprotoRequest,
  createSession,
} = require('./lib/bluesky-atproto');

const MAX_POST_CHARS = 300;

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    text: '',
    confirmPost: '',
  };
  for (const arg of argv) {
    if (arg.startsWith('--text=')) options.text = arg.slice('--text='.length);
    if (arg.startsWith('--confirm-post=')) options.confirmPost = arg.slice('--confirm-post='.length);
  }
  return options;
}

function assertPostable({ text, confirmPost }) {
  if (confirmPost !== 'POST') {
    throw new Error('Refusing to post without --confirm-post=POST');
  }
  if (!text || !text.trim()) {
    throw new Error('Post text is required');
  }
  if ([...text].length > MAX_POST_CHARS) {
    throw new Error(`Bluesky post exceeds ${MAX_POST_CHARS} characters`);
  }
}

async function publishOwnedPost(text, {
  sessionFactory = createSession,
  request = atprotoRequest,
  now = () => new Date(),
} = {}) {
  const session = await sessionFactory();
  const record = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: now().toISOString(),
  };

  const { status, json } = await request(
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
    },
  );

  if (status !== 200 || !json.uri) {
    throw new Error(`createRecord failed: ${status} ${json.error || ''}`);
  }

  return {
    uri: json.uri,
    cid: json.cid || null,
    handle: session.handle,
  };
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  assertPostable(options);
  const result = await publishOwnedPost(options.text, deps);
  console.log(JSON.stringify({ posted: true, ...result }, null, 2));
  return result;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}

module.exports = {
  MAX_POST_CHARS,
  assertPostable,
  main,
  parseArgs,
  publishOwnedPost,
};

