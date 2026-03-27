'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { describeSemanticSchema, SemanticSchema } = require('../scripts/semantic-layer');

describe('semantic-layer', () => {
  it('SemanticSchema has required entity definitions', () => {
    assert.ok(SemanticSchema.entities.Customer);
    assert.ok(SemanticSchema.entities.Revenue);
    assert.ok(SemanticSchema.entities.Funnel);
  });

  it('SemanticSchema Customer has expected tiers', () => {
    assert.deepStrictEqual(SemanticSchema.entities.Customer.tiers, ['free', 'pro', 'enterprise-sprint']);
  });

  it('SemanticSchema Funnel has correct stages', () => {
    assert.deepStrictEqual(SemanticSchema.entities.Funnel.stages, ['visitor', 'checkout_start', 'acquisition', 'paid']);
  });

  it('describeSemanticSchema returns the full schema', () => {
    const schema = describeSemanticSchema();
    assert.strictEqual(schema, SemanticSchema);
    assert.ok(schema.metrics.ConversionRate);
    assert.ok(schema.metrics.BookedRevenue);
  });
});
