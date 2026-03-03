const test = require('node:test');
const assert = require('node:assert/strict');

test('createApiServer requires RLHF_API_KEY unless insecure mode is enabled', () => {
  const previousKey = process.env.RLHF_API_KEY;
  const previousInsecure = process.env.RLHF_ALLOW_INSECURE;

  delete process.env.RLHF_API_KEY;
  delete process.env.RLHF_ALLOW_INSECURE;

  const { createApiServer } = require('../src/api/server');
  assert.throws(() => createApiServer(), /RLHF_API_KEY is required/);

  process.env.RLHF_ALLOW_INSECURE = 'true';
  assert.doesNotThrow(() => createApiServer());

  if (typeof previousKey === 'string') process.env.RLHF_API_KEY = previousKey;
  else delete process.env.RLHF_API_KEY;
  if (typeof previousInsecure === 'string') process.env.RLHF_ALLOW_INSECURE = previousInsecure;
  else delete process.env.RLHF_ALLOW_INSECURE;
});
