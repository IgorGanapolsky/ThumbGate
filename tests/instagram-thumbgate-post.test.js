'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  postThumbGateToInstagram,
  THUMBGATE_CAPTION,
} = require('../scripts/social-analytics/instagram-thumbgate-post');
const { generateInstagramCard } = require('../scripts/social-analytics/generate-instagram-card');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEST_IMAGE_PATH = path.join(REPO_ROOT, '.rlhf', 'test-instagram-thumbgate-post.png');

let sharpAvailable = false;
try { require('sharp'); sharpAvailable = true; } catch {}

describe('Instagram ThumbGate Post', () => {
  let tmpDedupPath;
  beforeEach(() => {
    tmpDedupPath = path.join(os.tmpdir(), `dedup-ig-test-${Date.now()}.json`);
    process.env.THUMBGATE_DEDUP_LOG_PATH = tmpDedupPath;
  });
  afterEach(() => {
    try { fs.unlinkSync(tmpDedupPath); } catch {}
    delete process.env.THUMBGATE_DEDUP_LOG_PATH;
  });

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

  it('should post to Instagram when ZERNIO_API_KEY is set', { skip: !sharpAvailable ? 'sharp not installed' : false }, async (t) => {
    // Skip if no API key configured
    if (!process.env.ZERNIO_API_KEY) {
      t.skip('ZERNIO_API_KEY not set');
      return;
    }

    await generateInstagramCard(TEST_IMAGE_PATH);
    const result = await postThumbGateToInstagram({ imagePath: TEST_IMAGE_PATH });
    assert.ok(result, 'Post should return a result object');
    assert.ok(result.id || result.data?.id, 'Post should have an ID');
    console.log(`✅ Instagram post created with ID: ${result.id || result.data?.id}`);
    fs.rmSync(TEST_IMAGE_PATH, { force: true });
  });
});
