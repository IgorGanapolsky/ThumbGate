'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveBuildMetadata, writeBuildMetadataFile } = require('../scripts/build-metadata');

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
});
