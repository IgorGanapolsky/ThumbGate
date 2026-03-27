'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { extractPrinciple } = require('../scripts/principle-extractor');

describe('principle-extractor', () => {
  it('extracts NEVER principle from negative feedback with whatWentWrong', () => {
    const principle = extractPrinciple({
      signal: 'down',
      whatWentWrong: 'pushed to main without PR',
      tags: ['git-workflow'],
    });
    assert.ok(principle);
    assert.strictEqual(principle.type, 'constraint');
    assert.strictEqual(principle.polarity, 'negative');
    assert.ok(principle.text.startsWith('NEVER:'));
  });

  it('extracts ALWAYS principle from positive feedback with whatWorked', () => {
    const principle = extractPrinciple({
      signal: 'up',
      whatWorked: 'ran tests before pushing',
      tags: ['testing'],
    });
    assert.ok(principle);
    assert.strictEqual(principle.type, 'heuristic');
    assert.strictEqual(principle.polarity, 'positive');
    assert.ok(principle.text.startsWith('ALWAYS:'));
  });

  it('returns null for unknown signal', () => {
    assert.strictEqual(extractPrinciple({ signal: 'neutral' }), null);
  });

  it('returns null for negative feedback without detail', () => {
    assert.strictEqual(extractPrinciple({ signal: 'down' }), null);
  });

  it('includes correction in NEVER/INSTEAD format', () => {
    const principle = extractPrinciple({
      signal: 'down',
      whatWentWrong: 'skipped tests',
      whatToChange: 'always run tests first',
    });
    assert.ok(principle.text.includes('INSTEAD:'));
    assert.ok(principle.correction === 'always run tests first');
  });
});
