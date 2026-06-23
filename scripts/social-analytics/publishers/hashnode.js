'use strict';

/**
 * Hashnode publisher.
 *
 * Required env vars:
 *   HASHNODE_TOKEN          — Hashnode Personal Access Token
 *   HASHNODE_PUBLICATION_ID — Publication ID
 *
 * Note: Hashnode's public API is GraphQL. The default mutation targets the
 * current PublishPostInput shape; if Hashnode changes field names again, the
 * returned GraphQL error is surfaced verbatim instead of being swallowed.
 */

const HASHNODE_ENDPOINT = 'https://gql.hashnode.com';

function requireConfig(env = process.env) {
  const token = env.HASHNODE_TOKEN || env.HASHNODE_PAT;
  const publicationId = env.HASHNODE_PUBLICATION_ID;
  if (!token) throw new Error('HASHNODE_TOKEN env var is required');
  if (!publicationId) throw new Error('HASHNODE_PUBLICATION_ID env var is required');
  return { token, publicationId };
}

async function hashnodeGraphql(query, variables, env = process.env) {
  const { token } = requireConfig(env);
  const res = await fetch(HASHNODE_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    throw new Error(`Hashnode API ${res.status}: ${text}`);
  }
  if (json?.errors?.length) {
    throw new Error(`Hashnode GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json?.data || {};
}

async function publishArticle({
  title,
  contentMarkdown,
  tags = [],
  canonicalUrl,
  subtitle,
  env = process.env,
} = {}) {
  if (!title) throw new Error('title is required');
  if (!contentMarkdown) throw new Error('contentMarkdown is required');

  const { publicationId } = requireConfig(env);
  const mutation = `
    mutation PublishPost($input: PublishPostInput!) {
      publishPost(input: $input) {
        post {
          id
          slug
          url
        }
      }
    }
  `;

  const input = {
    publicationId,
    title,
    contentMarkdown,
  };
  if (subtitle) input.subtitle = subtitle;
  if (canonicalUrl) input.originalArticleURL = canonicalUrl;
  if (Array.isArray(tags) && tags.length > 0) {
    input.tags = tags.map((tag) => ({ slug: String(tag).trim().toLowerCase() })).filter((tag) => tag.slug);
  }

  console.log(`[hashnode:publisher] Publishing article: "${title}"`);
  const data = await hashnodeGraphql(mutation, { input }, env);
  const post = data?.publishPost?.post || data?.publishPost || {};
  console.log(`[hashnode:publisher] Article published. url=${post.url || post.slug || post.id || 'unknown'}`);
  return post;
}

module.exports = {
  hashnodeGraphql,
  publishArticle,
};
