'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { optimize } = require('../scripts/optimize-context');

describe('optimize-context', () => {
  it('optimize is a function', () => {
    assert.strictEqual(typeof optimize, 'function');
  });

  it('optimize does not throw when CLAUDE.md does not exist', () => {
    // When run from test dir, CLAUDE.md may not exist at cwd — should be a no-op
    const originalCwd = process.cwd;
    process.cwd = () => '/tmp/nonexistent-dir-for-test';
    try {
      assert.doesNotThrow(() => optimize());
    } finally {
      process.cwd = originalCwd;
    }
  });
});
