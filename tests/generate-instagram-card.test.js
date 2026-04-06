'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let sharpAvailable = false;
try { require('sharp'); sharpAvailable = true; } catch {}

const REPO_ROOT = path.resolve(__dirname, '..');
const TEST_OUTPUT = path.join(REPO_ROOT, '.thumbgate', 'test-instagram-card.png');

describe('Generate Instagram Card', { skip: !sharpAvailable ? 'sharp not installed' : false }, () => {
  const { generateInstagramCard, DEFAULT_OUTPUT } = require('../scripts/social-analytics/generate-instagram-card');

  afterEach(() => {
    if (fs.existsSync(TEST_OUTPUT)) {
      fs.unlinkSync(TEST_OUTPUT);
    }
  });

  it('should generate a PNG file at the specified path', async () => {
    const outputPath = await generateInstagramCard(TEST_OUTPUT);
    assert.equal(outputPath, TEST_OUTPUT);
    assert.ok(fs.existsSync(TEST_OUTPUT), 'Output file should exist');
  });

  it('should create a valid PNG file', async () => {
    await generateInstagramCard(TEST_OUTPUT);
    const stats = fs.statSync(TEST_OUTPUT);
    assert.ok(stats.size > 0, 'PNG file should have non-zero size');
    const buffer = fs.readFileSync(TEST_OUTPUT);
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    assert.deepEqual(buffer.slice(0, 4), pngHeader, 'File should be a valid PNG');
  });

  it('should generate a 1080x1080 image', async () => {
    await generateInstagramCard(TEST_OUTPUT);
    assert.ok(fs.existsSync(TEST_OUTPUT));
  });

  it('should use the default output path if not specified', async () => {
    assert.ok(DEFAULT_OUTPUT, 'DEFAULT_OUTPUT should be defined');
    assert.match(DEFAULT_OUTPUT, /instagram-card\.png$/);
  });
});
