'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  BUILD_GENERATED_AT_ENV_KEY,
  BUILD_SHA_ENV_KEY,
  resolveBuildMetadata,
  writeBuildMetadataFile,
} = require('../scripts/build-metadata');

describe('build-metadata', () => {
  it('resolveBuildMetadata returns nulls when file does not exist', () => {
    const result = resolveBuildMetadata({ filePath: '/tmp/nonexistent-build-meta.json' });
    assert.strictEqual(result.buildSha, null);
    assert.strictEqual(result.generatedAt, null);
  });

  it('writeBuildMetadataFile creates a valid JSON file', () => {
    const tmpFile = path.join(os.tmpdir(), `build-meta-test-${Date.now()}.json`);
    try {
      const result = writeBuildMetadataFile({ sha: 'abc123', outputPath: tmpFile });
      assert.strictEqual(result.buildSha, 'abc123');
      const content = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
      assert.strictEqual(content.buildSha, 'abc123');
      assert.ok(content.generatedAt);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('writeBuildMetadataFile throws on empty SHA', () => {
    assert.throws(() => writeBuildMetadataFile({ sha: '' }), /non-empty build SHA/);
    assert.throws(() => writeBuildMetadataFile({ sha: '   ' }), /non-empty build SHA/);
  });

  it('resolveBuildMetadata reads back written metadata', () => {
    const tmpFile = path.join(os.tmpdir(), `build-meta-roundtrip-${Date.now()}.json`);
    try {
      writeBuildMetadataFile({ sha: 'def456', outputPath: tmpFile, generatedAt: '2026-01-01T00:00:00Z' });
      const result = resolveBuildMetadata({ filePath: tmpFile });
      assert.strictEqual(result.buildSha, 'def456');
      assert.strictEqual(result.generatedAt, '2026-01-01T00:00:00Z');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('resolveBuildMetadata prefers deployment env metadata over file metadata', () => {
    const tmpFile = path.join(os.tmpdir(), `build-meta-env-priority-${Date.now()}.json`);
    try {
      writeBuildMetadataFile({ sha: 'file-sha', outputPath: tmpFile, generatedAt: '2026-01-01T00:00:00Z' });
      const result = resolveBuildMetadata({
        filePath: tmpFile,
        env: {
          [BUILD_SHA_ENV_KEY]: 'env-sha',
          [BUILD_GENERATED_AT_ENV_KEY]: '2026-04-08T14:20:00Z',
        },
      });
      assert.strictEqual(result.buildSha, 'env-sha');
      assert.strictEqual(result.generatedAt, '2026-04-08T14:20:00Z');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
