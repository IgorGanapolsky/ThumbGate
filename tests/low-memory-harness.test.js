'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {
  measureMemoryFootprint,
  createZeroCopyBufferStream,
  fastStartHarness,
  getRamEfficiencyMetrics,
  MAX_TARGET_RAM_MB,
} = require('../scripts/low-memory-harness.js');

test('measureMemoryFootprint returns memory usage metrics and target limit', () => {
  const metrics = measureMemoryFootprint();

  assert.ok(typeof metrics.rssMb === 'number');
  assert.ok(typeof metrics.heapUsedMb === 'number');
  assert.ok(typeof metrics.heapTotalMb === 'number');
  assert.strictEqual(metrics.targetLimitMb, MAX_TARGET_RAM_MB);
  assert.ok(typeof metrics.isEfficient === 'boolean');
});

test('createZeroCopyBufferStream splits data into zero-copy subarray chunks', () => {
  const text = 'A'.repeat(150 * 1024); // 150 KB text
  const stream = createZeroCopyBufferStream(text);

  assert.strictEqual(stream.totalBytes, 150 * 1024);
  assert.strictEqual(stream.chunkCount, 3); // 64KB + 64KB + 22KB

  const chunk1 = stream.getChunk(0);
  const chunk2 = stream.getChunk(1);
  const chunk3 = stream.getChunk(2);
  const chunk4 = stream.getChunk(3);

  assert.strictEqual(chunk1.length, 64 * 1024);
  assert.strictEqual(chunk2.length, 64 * 1024);
  assert.strictEqual(chunk3.length, 22 * 1024);
  assert.strictEqual(chunk4, null);
});

test('fastStartHarness measures startup latency in milliseconds', () => {
  const result = fastStartHarness(() => {
    let sum = 0;
    for (let i = 0; i < 10000; i += 1) sum += i;
  });

  assert.strictEqual(result.status, 'initialized');
  assert.ok(typeof result.ttftMs === 'number');
  assert.ok(result.ttftMs >= 0);
  assert.ok(typeof result.isFast === 'boolean');
});

test('getRamEfficiencyMetrics calculates multi-session RAM scaling', () => {
  const scaling = getRamEfficiencyMetrics(10);

  assert.strictEqual(scaling.totalSessions, 10);
  assert.ok(typeof scaling.estimatedRamMb === 'number');
  assert.ok(typeof scaling.perSessionRamMb === 'number');
  assert.ok(typeof scaling.satisfiesJcodeParity === 'boolean');
});
