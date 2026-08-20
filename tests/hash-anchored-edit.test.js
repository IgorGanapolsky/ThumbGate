'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { computeChunkHash, evaluateHashAnchoredEdit } = require('../src/hash-anchored-edit.js');

test('HashAnchoredEdit: computes deterministic chunk hashes', () => {
  const hash1 = computeChunkHash('function test() { return 42; }');
  const hash2 = computeChunkHash('function test() { return 42; }');
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 16);
});

test('HashAnchoredEdit: verifies matching hash anchors and target content', () => {
  const tmpFile = path.join(os.tmpdir(), `hash-test-${Date.now()}.js`);
  fs.writeFileSync(tmpFile, 'const x = 1;\nconst y = 2;\nconst z = 3;\n');

  const targetContent = 'const y = 2;';
  const expectedHash = computeChunkHash(targetContent);

  const result = evaluateHashAnchoredEdit({
    filePath: tmpFile,
    targetContent,
    expectedHash,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'anchor_verified');
  assert.equal(result.chunkHash, expectedHash);
});

test('HashAnchoredEdit: detects drift when concurrent session modified lines', () => {
  const tmpFile = path.join(os.tmpdir(), `hash-drift-${Date.now()}.js`);
  fs.writeFileSync(tmpFile, 'const x = 1;\nconst y = 999;\nconst z = 3;\n');

  const oldTargetContent = 'const y = 2;';
  const expectedOldHash = computeChunkHash(oldTargetContent);

  const result = evaluateHashAnchoredEdit({
    filePath: tmpFile,
    targetContent: oldTargetContent,
    expectedHash: expectedOldHash,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'target_content_drift');
});
