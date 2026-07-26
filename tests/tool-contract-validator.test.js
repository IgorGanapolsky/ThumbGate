const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateStructuredOutput,
  validateToolContract,
} = require('../scripts/tool-contract-validator');

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

test('validateToolContract recursively enforces array items and unknown properties', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['calls'],
    properties: {
      calls: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['attempts'],
          properties: {
            attempts: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
  };
  const result = validateToolContract(schema, {
    calls: [{ attempts: 0, surprise: true }],
    extra: true,
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /calls\[0\]\.attempts.*>= 1/.test(error)));
  assert.ok(result.errors.includes("Unexpected parameter: 'calls[0].surprise'"));
  assert.ok(result.errors.includes("Unexpected parameter: 'extra'"));
});

test('validateStructuredOutput parses JSON and enforces format and oneOf', () => {
  const schema = {
    type: 'object',
    required: ['createdAt', 'result'],
    properties: {
      createdAt: { type: 'string', format: 'date-time' },
      result: {
        oneOf: [
          { type: 'string', const: 'ok' },
          { type: 'integer', minimum: 1 },
        ],
      },
    },
  };

  assert.equal(validateStructuredOutput('{"createdAt":"2026-07-26T12:00:00Z","result":"ok"}', schema).valid, true);
  assert.equal(validateStructuredOutput('{"createdAt":"yesterday","result":0}', schema).valid, false);
  assert.match(validateStructuredOutput('{broken', schema).errors[0], /valid JSON/);
});
