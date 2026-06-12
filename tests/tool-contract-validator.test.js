const test = require('node:test');
const assert = require('node:assert/strict');
const { validateToolContract } = require('../scripts/tool-contract-validator');

test('validateToolContract allows valid arguments', () => {
  const schema = {
    type: 'object',
    required: ['signal'],
    properties: {
      signal: { type: 'string', enum: ['up', 'down'] },
      context: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      recent: { type: 'number' },
      enabled: { type: 'boolean' }
    }
  };

  const args = {
    signal: 'up',
    context: 'Working as expected',
    tags: ['test', 'development'],
    recent: 10,
    enabled: true
  };

  const result = validateToolContract(schema, args);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('validateToolContract rejects missing required properties', () => {
  const schema = {
    type: 'object',
    required: ['signal', 'context'],
    properties: {
      signal: { type: 'string' },
      context: { type: 'string' }
    }
  };

  const args = {
    signal: 'down'
  };

  const result = validateToolContract(schema, args);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ["Missing required parameter: 'context'"]);
});

test('validateToolContract rejects invalid parameter types', () => {
  const schema = {
    type: 'object',
    properties: {
      recent: { type: 'number' },
      tags: { type: 'array' },
      enabled: { type: 'boolean' }
    }
  };

  const args = {
    recent: 'not-a-number',
    tags: 'not-an-array',
    enabled: 'not-a-boolean'
  };

  const result = validateToolContract(schema, args);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("Parameter 'recent' must be a number (got string)"));
  assert.ok(result.errors.includes("Parameter 'tags' must be an array (got string)"));
  assert.ok(result.errors.includes("Parameter 'enabled' must be a boolean (got string)"));
});

test('validateToolContract rejects invalid enum values', () => {
  const schema = {
    type: 'object',
    properties: {
      signal: { type: 'string', enum: ['up', 'down'] }
    }
  };

  const args = {
    signal: 'maybe'
  };

  const result = validateToolContract(schema, args);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ["Parameter 'signal' must be one of [up, down] (got 'maybe')"]);
});
