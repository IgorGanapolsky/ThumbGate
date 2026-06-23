'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const medium = require('../scripts/social-analytics/publishers/medium');
const hashnode = require('../scripts/social-analytics/publishers/hashnode');
const x = require('../scripts/social-analytics/publishers/x');

test('Medium publisher fails loudly when token is missing', async () => {
  await assert.rejects(
    () => medium.publishArticle({
      title: 'T',
      content: 'Body',
      env: {},
    }),
    /MEDIUM_INTEGRATION_TOKEN env var is required/
  );
});

test('Hashnode publisher fails loudly when token or publication id is missing', async () => {
  await assert.rejects(
    () => hashnode.publishArticle({
      title: 'T',
      contentMarkdown: 'Body',
      env: {},
    }),
    /HASHNODE_TOKEN env var is required/
  );

  await assert.rejects(
    () => hashnode.publishArticle({
      title: 'T',
      contentMarkdown: 'Body',
      env: { HASHNODE_TOKEN: 'test-token' },
    }),
    /HASHNODE_PUBLICATION_ID env var is required/
  );
});

test('X publisher fails loudly when user-context token is missing', async () => {
  await assert.rejects(
    () => x.publishPost({
      text: 'ThumbGate gates the tool call before it executes.',
      env: {},
    }),
    /X_OAUTH2_USER_TOKEN env var is required/
  );
});

test('X publisher requires text', async () => {
  await assert.rejects(
    () => x.publishPost({ env: { X_OAUTH2_USER_TOKEN: 'test-token' } }),
    /text is required/
  );
});

test('Hashnode publishes successfully when credentials and mock response are present', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://gql.hashnode.com');
      assert.equal(options.headers.Authorization, 'mock-token');
      return {
        ok: true,
        text: async () => JSON.stringify({
          data: {
            publishPost: {
              post: {
                id: '123',
                slug: 'my-post',
                url: 'https://hashnode.com/my-post'
              }
            }
          }
        })
      };
    };

    const post = await hashnode.publishArticle({
      title: 'Hello',
      contentMarkdown: 'World',
      env: {
        HASHNODE_TOKEN: 'mock-token',
        HASHNODE_PUBLICATION_ID: 'mock-pub-id'
      }
    });

    assert.equal(post.id, '123');
    assert.equal(post.url, 'https://hashnode.com/my-post');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
