'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  publishInstagramThumbGate,
  IMAGE_PATH,
} = require('../scripts/social-analytics/publish-instagram-thumbgate');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEST_IMAGE_PATH = path.join(REPO_ROOT, '.thumbgate', 'test-publish-instagram.png');

let sharpAvailable = false;
try { require('sharp'); sharpAvailable = true; } catch {}

describe('Publish Instagram ThumbGate', { skip: !sharpAvailable ? 'sharp not installed' : false }, () => {
  afterEach(() => {
    // Clean up test images
    [TEST_IMAGE_PATH, IMAGE_PATH].forEach((p) => {
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch (e) {
          // ignore
        }
      }
    });
  });

  it('should generate image when called with default options', async (t) => {
    // Skip if Zernio not configured
    if (!process.env.ZERNIO_API_KEY) {
      t.skip('ZERNIO_API_KEY not set');
      return;
    }

    const result = await publishInstagramThumbGate({
      imageOnly: true,
      imagePath: TEST_IMAGE_PATH,
    });

    assert.ok(result.imagePath, 'Should return imagePath');
    assert.ok(fs.existsSync(TEST_IMAGE_PATH), 'Image file should be created');

    const stats = fs.statSync(TEST_IMAGE_PATH);
    assert.ok(stats.size > 1000, 'PNG should be larger than 1KB');
    console.log(`✅ Image generated: ${stats.size} bytes`);
  });

  it('should post to Instagram when fully configured', async (t) => {
    // Skip if Zernio not configured
    if (!process.env.ZERNIO_API_KEY) {
      t.skip('ZERNIO_API_KEY not set');
      return;
    }

    const result = await publishInstagramThumbGate({
      imagePath: TEST_IMAGE_PATH,
    });

    assert.ok(result.success === true, 'Should return success flag');
    assert.ok(result.postId, 'Should return postId');
    assert.ok(result.imagePath, 'Should return imagePath');

    console.log(`✅ Complete workflow succeeded`);
    console.log(`   Image: ${result.imagePath}`);
    console.log(`   Post ID: ${result.postId}`);
  });

  it('should support post-only mode', async (t) => {
    // Skip if Zernio not configured
    if (!process.env.ZERNIO_API_KEY) {
      t.skip('ZERNIO_API_KEY not set');
      return;
    }

    await publishInstagramThumbGate({
      imageOnly: true,
      imagePath: TEST_IMAGE_PATH,
    });

    const result = await publishInstagramThumbGate({
      postOnly: true,
      imagePath: TEST_IMAGE_PATH,
    });

    assert.ok(result.success === true, 'Should return success flag');
    assert.ok(result.postId, 'Should return postId');
    assert.equal(result.imagePath, undefined, 'Should not return imagePath in post-only mode');

    console.log(`✅ Post-only mode succeeded`);
    console.log(`   Post ID: ${result.postId}`);
  });
});
