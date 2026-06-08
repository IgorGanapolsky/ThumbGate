'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  BUILD_GENERATED_AT_ENV_KEY,
  BUILD_SHA_ENV_KEY,
  RAILWAY_GIT_COMMIT_SHA_ENV_KEY,
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

  // Precedence inversion (2026-05-20): the immutable JSON file (baked into the
  // Docker image at build time, so it ALWAYS matches the deployed code) MUST
  // win over runtime env vars. Env vars are mutable Railway/host config that
  // can drift — a stale THUMBGATE_BUILD_SHA env var on Railway shadowed the
  // freshly-stamped JSON file in prod and made /health lie about the deployed
  // commit. Env vars now only fill in when the file has no SHA at all.
  it('resolveBuildMetadata prefers immutable file metadata over runtime env vars (anti-drift)', () => {
    const tmpFile = path.join(os.tmpdir(), `build-meta-file-priority-${Date.now()}.json`);
    try {
      writeBuildMetadataFile({ sha: 'file-sha', outputPath: tmpFile, generatedAt: '2026-01-01T00:00:00Z' });
      const result = resolveBuildMetadata({
        filePath: tmpFile,
        env: {
          [BUILD_SHA_ENV_KEY]: 'stale-env-sha',
          [BUILD_GENERATED_AT_ENV_KEY]: '2026-04-08T14:20:00Z',
        },
      });
      assert.strictEqual(result.buildSha, 'file-sha', 'file-baked SHA wins (immutable image artifact)');
      assert.strictEqual(result.generatedAt, '2026-01-01T00:00:00Z', 'file-baked generatedAt wins too');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('resolveBuildMetadata falls back to env SHA only when file has no SHA', () => {
    const result = resolveBuildMetadata({
      filePath: '/tmp/nonexistent-build-meta.json',
      env: {
        [BUILD_SHA_ENV_KEY]: 'env-only-sha',
        [BUILD_GENERATED_AT_ENV_KEY]: '2026-04-08T14:20:00Z',
      },
    });
    assert.strictEqual(result.buildSha, 'env-only-sha');
    assert.strictEqual(result.generatedAt, '2026-04-08T14:20:00Z');
  });

  // Railway drift fix (2026-06-08): on the GitHub-connected service the baked
  // file is the committed null placeholder and RAILWAY_SYNC_VARIABLES is off, so
  // THUMBGATE_BUILD_SHA never updates and /health reported an old commit while
  // newer code was live. RAILWAY_GIT_COMMIT_SHA is injected by Railway per deploy
  // and is the ground truth, so it must beat the drift-prone THUMBGATE_BUILD_SHA.
  it('resolveBuildMetadata prefers RAILWAY_GIT_COMMIT_SHA over the drift-prone THUMBGATE_BUILD_SHA', () => {
    const result = resolveBuildMetadata({
      filePath: '/tmp/nonexistent-build-meta.json',
      env: {
        [RAILWAY_GIT_COMMIT_SHA_ENV_KEY]: 'railway-live-sha',
        [BUILD_SHA_ENV_KEY]: 'stale-workflow-sha',
        [BUILD_GENERATED_AT_ENV_KEY]: '2026-04-08T14:20:00Z',
      },
    });
    assert.strictEqual(result.buildSha, 'railway-live-sha', 'Railway per-deploy SHA is ground truth');
  });

  it('resolveBuildMetadata still lets a baked file SHA win over RAILWAY_GIT_COMMIT_SHA', () => {
    const tmpFile = path.join(os.tmpdir(), `build-meta-railway-vs-file-${Date.now()}.json`);
    try {
      writeBuildMetadataFile({ sha: 'file-sha', outputPath: tmpFile, generatedAt: '2026-01-01T00:00:00Z' });
      const result = resolveBuildMetadata({
        filePath: tmpFile,
        env: { [RAILWAY_GIT_COMMIT_SHA_ENV_KEY]: 'railway-live-sha' },
      });
      assert.strictEqual(result.buildSha, 'file-sha', 'baked image artifact still wins when present');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('resolveBuildMetadata uses RAILWAY_GIT_COMMIT_SHA when it is the only source', () => {
    const result = resolveBuildMetadata({
      filePath: '/tmp/nonexistent-build-meta.json',
      env: { [RAILWAY_GIT_COMMIT_SHA_ENV_KEY]: 'railway-only-sha' },
    });
    assert.strictEqual(result.buildSha, 'railway-only-sha');
  });

  it('resolveBuildMetadata does NOT short-circuit to a null SHA when only generatedAt env is set', () => {
    // Regression for the secondary bug: previously `envBuildSha || envGeneratedAt`
    // returned { buildSha: null } when only GENERATED_AT was set, losing the
    // chance to read the file. Now the env branch requires an explicit SHA.
    const tmpFile = path.join(os.tmpdir(), `build-meta-stray-${Date.now()}.json`);
    try {
      writeBuildMetadataFile({ sha: 'file-sha', outputPath: tmpFile, generatedAt: '2026-01-01T00:00:00Z' });
      const result = resolveBuildMetadata({
        filePath: tmpFile,
        env: {
          [BUILD_GENERATED_AT_ENV_KEY]: '2026-04-08T14:20:00Z',
          // intentionally no BUILD_SHA env
        },
      });
      assert.strictEqual(result.buildSha, 'file-sha', 'stray generatedAt env must not lose the SHA');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
