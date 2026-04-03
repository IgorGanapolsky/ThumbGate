const test = require('node:test');
const assert = require('node:assert/strict');
const { generateLoraConfig } = require('../scripts/generate-lora-config');

test('generateLoraConfig returns valid object', () => {
  const config = generateLoraConfig('llama-3');
  assert.equal(config.base_model, 'llama-3');
  assert.equal(config.adapter, 'lora');
});
