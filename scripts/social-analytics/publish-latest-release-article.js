#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadLocalEnv } = require('./load-env');
const { listMyArticles, publishArticle } = require('./publishers/devto');

const ARTICLE_TITLE = 'ThumbGate 1.28.0: A Safer Path from Agent Feedback to Enforcement';
const ARTICLE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'public',
  'release-notes',
  'thumbgate-1-28-0.md'
);

async function publishLatestReleaseArticle(deps = {}) {
  const listArticles = deps.listMyArticles || listMyArticles;
  const publish = deps.publishArticle || publishArticle;
  const body = fs.readFileSync(deps.articlePath || ARTICLE_PATH, 'utf8').trim();
  const existingArticles = await listArticles({ page: 1, per_page: 100 });
  const existing = existingArticles.find((article) => article.title === ARTICLE_TITLE);

  if (existing) {
    return {
      published: false,
      skipped: true,
      reason: 'article_title_already_exists',
      id: existing.id,
      url: existing.url,
    };
  }

  const result = await publish({
    title: ARTICLE_TITLE,
    body_markdown: body,
    tags: ['ai', 'devtools', 'opensource', 'security'],
    published: true,
  });

  return {
    published: true,
    skipped: false,
    id: result.id,
    url: result.url,
  };
}

async function main() {
  loadLocalEnv();
  const result = await publishLatestReleaseArticle();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  ARTICLE_PATH,
  ARTICLE_TITLE,
  publishLatestReleaseArticle,
};
