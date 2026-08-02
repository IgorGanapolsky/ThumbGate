'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  parseArgs,
  validateRuntimeProof,
} = require('../scripts/prove-transformers-runtime');

describe('Transformers.js runtime proof', () => {
  it('parses an optional machine-readable output path', () => {
    assert.deepEqual(parseArgs(['--output', '/tmp/proof.json']), {
      output: '/tmp/proof.json',
    });
  });

  it('accepts only a normalized MiniLM production embedding', () => {
    const vector = new Array(384).fill(0);
    vector[0] = 1;
    const norm = validateRuntimeProof({
      vector,
      status: { available: true },
      profile: {
        source: 'local-transformers',
        activeProfile: {
          model: 'Xenova/all-MiniLM-L6-v2',
          qualityTier: 'production',
        },
      },
    });
    assert.equal(norm, 1);
  });

  it('rejects a provider availability claim without runtime capability', () => {
    assert.throws(
      () => validateRuntimeProof({
        vector: [],
        status: { available: false, reason: 'missing_optional_dependency' },
      }),
      /provider unavailable: missing_optional_dependency/,
    );
  });
});
