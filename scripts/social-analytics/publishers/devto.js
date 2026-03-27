'use strict';

/**
 * devto.js
 * Publishes articles to Dev.to via their REST API.
 *
 * Required env vars:
 *   DEVTO_API_KEY — API key from Settings > Extensions > API Keys
 *
 * Dev.to API reference:
 *   POST https://dev.to/api/articles — create/update an article
 *   GET  https://dev.to/api/articles/me — list my articles
 */

const DEVTO_API_BASE = 'https://dev.to/api';

// ---------------------------------------------------------------------------
// Article creation
// ---------------------------------------------------------------------------

/**
 * Create and publish an article on Dev.to.
 *
 * @param {{ title: string, body_markdown: string, tags?: string[], published?: boolean, series?: string, canonical_url?: string }} options
 * @returns {Promise<object>} Dev.to API response (includes id, url, slug)
 */
async function publishArticle({ title, body_markdown, tags, published = true, series, canonical_url }) {
  const apiKey = process.env.DEVTO_API_KEY;
  if (!apiKey) throw new Error('DEVTO_API_KEY env var is required');
  if (!title) throw new Error('title is required');
  if (!body_markdown) throw new Error('body_markdown is required');

  const article = { title, body_markdown, published };
  if (tags && tags.length > 0) article.tags = tags;
  if (series) article.series = series;
  if (canonical_url) article.canonical_url = canonical_url;

  console.log(`[devto:publisher] Publishing article: "${title}"`);

  const res = await fetch(`${DEVTO_API_BASE}/articles`, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ article }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Dev.to API ${res.status}: ${text}`);
  }

  const data = await res.json();
  console.log(`[devto:publisher] Article published. url=${data.url || data.slug || 'unknown'}`);
  return data;
}

/**
 * List my published articles.
 *
 * @param {{ page?: number, per_page?: number }} options
 * @returns {Promise<object[]>}
 */
async function listMyArticles({ page = 1, per_page = 30 } = {}) {
  const apiKey = process.env.DEVTO_API_KEY;
  if (!apiKey) throw new Error('DEVTO_API_KEY env var is required');

  const url = `${DEVTO_API_BASE}/articles/me?page=${page}&per_page=${per_page}`;
  const res = await fetch(url, {
    headers: { 'api-key': apiKey },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Dev.to API ${res.status}: ${text}`);
  }

  return res.json();
}

module.exports = {
  publishArticle,
  listMyArticles,
};

// ---------------------------------------------------------------------------
// Stand-alone execution
// ---------------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);

  function getArg(flag) {
    const prefix = `${flag}=`;
    const entry = args.find((a) => a.startsWith(prefix));
    return entry ? entry.slice(prefix.length) : null;
  }

  const title = getArg('--title');
  const body = getArg('--body');
  const tags = getArg('--tags');
  const draft = args.includes('--draft');

  if (!title || !body) {
    console.error('Usage: node devto.js --title=<title> --body=<markdown> [--tags=js,automation] [--draft]');
    process.exit(1);
  }

  publishArticle({
    title,
    body_markdown: body,
    tags: tags ? tags.split(',').map((t) => t.trim()) : [],
    published: !draft,
  })
    .then((data) => {
      console.log(`[devto:publisher] Done. url=${data.url}`);
    })
    .catch((err) => {
      console.error('[devto:publisher] Publish failed:', err.message);
      process.exit(1);
    });
}
