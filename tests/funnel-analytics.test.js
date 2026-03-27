'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { generateFunnelReport } = require('../scripts/funnel-analytics');

describe('funnel-analytics', () => {
  it('generateFunnelReport is a function', () => {
    assert.strictEqual(typeof generateFunnelReport, 'function');
  });

  it('generateFunnelReport does not throw when called', () => {
    // It prints to stdout; just verify it doesn't crash
    assert.doesNotThrow(() => generateFunnelReport());
  });
});
