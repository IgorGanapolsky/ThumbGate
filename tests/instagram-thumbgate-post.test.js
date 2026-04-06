'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  postThumbGateToInstagram,
  THUMBGATE_CAPTION,
} = require('../scripts/social-analytics/instagram-thumbgate-post');

describe('Instagram ThumbGate Post', () => {
  it('should have a valid caption with required hashtags and messaging', () => {
    assert.match(THUMBGATE_CAPTION, /Your AI.*agent.*forgets/i);
    assert.match(THUMBGATE_CAPTION, /ThumbGate/);
    assert.match(THUMBGATE_CAPTION, /amnesia/i);
    assert.match(THUMBGATE_CAPTION, /memory.*survives/i);
    assert.match(THUMBGATE_CAPTION, /#AIAgents/);
    assert.match(THUMBGATE_CAPTION, /#DeveloperTools/);
    assert.match(THUMBGATE_CAPTION, /#ThumbGate/);
    assert.match(THUMBGATE_CAPTION, /npx thumbgate init/);
  });

  it('should post to Instagram when ZERNIO_API_KEY is set', async (t) => {
    // Skip if no API key configured
    if (!process.env.ZERNIO_API_KEY) {
      t.skip('ZERNIO_API_KEY not set');
      return;
    }

    const result = await postThumbGateToInstagram();
    assert.ok(result, 'Post should return a result object');
    assert.ok(result.id || result.data?.id, 'Post should have an ID');
    console.log(`✅ Instagram post created with ID: ${result.id || result.data?.id}`);
  });
});
