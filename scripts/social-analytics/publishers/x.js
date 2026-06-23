'use strict';

/**
 * X publisher for API v2 POST /2/tweets.
 *
 * Required env vars:
 *   X_OAUTH2_USER_TOKEN or X_BEARER_TOKEN
 *
 * The token must be a user-context token with tweet.write, users.read, and
 * tweet.read scope. App-only bearer tokens cannot create posts.
 */

const X_API_BASE = 'https://api.x.com/2';

function requireUserToken(env = process.env) {
  const token = env.X_OAUTH2_USER_TOKEN || env.X_ACCESS_TOKEN || env.X_BEARER_TOKEN;
  if (!token) {
    throw new Error('X_OAUTH2_USER_TOKEN env var is required for POST /2/tweets');
  }
  return token;
}

async function publishPost({ text, env = process.env } = {}) {
  if (!text) throw new Error('text is required');
  const token = requireUserToken(env);
  const trimmed = [...String(text)].slice(0, 280).join('');

  console.log(`[x:publisher] Publishing post (${[...trimmed].length} chars)`);
  const res = await fetch(`${X_API_BASE}/tweets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: trimmed }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`X API ${res.status}: ${body}`);
  }

  const json = await res.json();
  const id = json?.data?.id;
  const url = id ? `https://x.com/i/web/status/${id}` : null;
  console.log(`[x:publisher] Post published. id=${id || 'unknown'}`);
  return { ...json, id, url };
}

module.exports = {
  publishPost,
};
