'use strict';

/**
 * Medium publisher.
 *
 * Required env vars:
 *   MEDIUM_INTEGRATION_TOKEN — Medium integration token / OAuth bearer token
 *
 * Optional env vars:
 *   MEDIUM_USER_ID           — skips the /me lookup when set
 *   MEDIUM_PUBLICATION_ID    — publishes under a publication instead of user profile
 */

const MEDIUM_API_BASE = 'https://api.medium.com/v1';

function requireToken(env = process.env) {
  const token = env.MEDIUM_INTEGRATION_TOKEN || env.MEDIUM_ACCESS_TOKEN;
  if (!token) throw new Error('MEDIUM_INTEGRATION_TOKEN env var is required');
  return token;
}

async function mediumFetch(endpoint, options = {}) {
  const token = requireToken(options.env);
  const res = await fetch(`${MEDIUM_API_BASE}${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Medium API ${res.status}: ${text}`);
  }

  return res.json();
}

async function getUserId(env = process.env) {
  if (env.MEDIUM_USER_ID) return env.MEDIUM_USER_ID;
  const json = await mediumFetch('/me', { env });
  const userId = json?.data?.id;
  if (!userId) throw new Error('Medium /me response missing data.id');
  return userId;
}

async function publishArticle({
  title,
  content,
  tags = [],
  canonicalUrl,
  publishStatus = 'public',
  env = process.env,
} = {}) {
  if (!title) throw new Error('title is required');
  if (!content) throw new Error('content is required');

  const body = {
    title,
    contentFormat: 'markdown',
    content,
    publishStatus,
  };
  if (Array.isArray(tags) && tags.length > 0) body.tags = tags.slice(0, 5);
  if (canonicalUrl) body.canonicalUrl = canonicalUrl;

  const publicationId = env.MEDIUM_PUBLICATION_ID;
  const endpoint = publicationId
    ? `/publications/${encodeURIComponent(publicationId)}/posts`
    : `/users/${encodeURIComponent(await getUserId(env))}/posts`;

  console.log(`[medium:publisher] Publishing article: "${title}"`);
  const json = await mediumFetch(endpoint, {
    method: 'POST',
    body,
    env,
  });
  const data = json.data || json;
  console.log(`[medium:publisher] Article published. url=${data.url || data.id || 'unknown'}`);
  return data;
}

module.exports = {
  getUserId,
  publishArticle,
};
