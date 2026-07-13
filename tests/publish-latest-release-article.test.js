'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  ARTICLE_TITLE,
  isDirectRun: isArticleDirectRun,
  publishLatestReleaseArticle,
} = require('../scripts/social-analytics/publish-latest-release-article');
const {
  isDirectRun: isVerifierDirectRun,
} = require('../scripts/social-analytics/verify-latest-release-posts');

test('CLI entrypoint detection compares resolved paths', () => {
  const cases = [
    [
      isArticleDirectRun,
      require.resolve('../scripts/social-analytics/publish-latest-release-article'),
    ],
    [
      isVerifierDirectRun,
      require.resolve('../scripts/social-analytics/verify-latest-release-posts'),
    ],
  ];

  for (const [isDirectRun, sourcePath] of cases) {
    assert.equal(isDirectRun([process.execPath, sourcePath], sourcePath), true);
    assert.equal(
      isDirectRun([process.execPath, path.join(__dirname, 'other.js')], sourcePath),
      false,
    );
    assert.equal(isDirectRun([process.execPath], sourcePath), false);
  }
});

test('publishes the latest release article with technical tags', async () => {
  let received;
  const result = await publishLatestReleaseArticle({
    listMyArticles: async () => [],
    publishArticle: async (article) => {
      received = article;
      return { id: 1280, url: 'https://dev.to/example/thumbgate-1280' };
    },
  });

  assert.equal(result.published, true);
  assert.equal(result.url, 'https://dev.to/example/thumbgate-1280');
  assert.equal(received.title, ARTICLE_TITLE);
  assert.deepEqual(received.tags, ['ai', 'devtools', 'opensource', 'security']);
  assert.match(received.body_markdown, /npx thumbgate@1\.28\.0 quickstart/);
  assert.match(received.body_markdown, /does not automatically become a hard block/);
});

test('skips an article whose exact title is already published', async () => {
  let publishCalls = 0;
  const result = await publishLatestReleaseArticle({
    listMyArticles: async () => [{
      id: 1279,
      title: ARTICLE_TITLE,
      url: 'https://dev.to/example/existing',
    }],
    publishArticle: async () => {
      publishCalls += 1;
      return {};
    },
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'article_title_already_exists');
  assert.equal(result.url, 'https://dev.to/example/existing');
  assert.equal(publishCalls, 0);
});
