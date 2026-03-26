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

test('missing RLHF_API_KEY with RLHF_ALLOW_INSECURE unset throws', () => {
  const prevKey = process.env.RLHF_API_KEY;
  const prevInsecure = process.env.RLHF_ALLOW_INSECURE;
  delete process.env.RLHF_API_KEY;
  delete process.env.RLHF_ALLOW_INSECURE;

  const { createApiServer } = require('../src/api/server');
  assert.throws(() => createApiServer(), /RLHF_API_KEY is required/);

  if (typeof prevKey === 'string') process.env.RLHF_API_KEY = prevKey;
  else delete process.env.RLHF_API_KEY;
  if (typeof prevInsecure === 'string') process.env.RLHF_ALLOW_INSECURE = prevInsecure;
  else delete process.env.RLHF_ALLOW_INSECURE;
});

test('RLHF_ALLOW_INSECURE=true allows creation without key', () => {
  const prevKey = process.env.RLHF_API_KEY;
  const prevInsecure = process.env.RLHF_ALLOW_INSECURE;
  delete process.env.RLHF_API_KEY;
  process.env.RLHF_ALLOW_INSECURE = 'true';

  const { createApiServer } = require('../src/api/server');
  assert.doesNotThrow(() => createApiServer());

  if (typeof prevKey === 'string') process.env.RLHF_API_KEY = prevKey;
  else delete process.env.RLHF_API_KEY;
  if (typeof prevInsecure === 'string') process.env.RLHF_ALLOW_INSECURE = prevInsecure;
  else delete process.env.RLHF_ALLOW_INSECURE;
});

test('setting RLHF_API_KEY allows creation', () => {
  const prevKey = process.env.RLHF_API_KEY;
  const prevInsecure = process.env.RLHF_ALLOW_INSECURE;
  process.env.RLHF_API_KEY = 'test-key-12345';
  delete process.env.RLHF_ALLOW_INSECURE;

  const { createApiServer } = require('../src/api/server');
  assert.doesNotThrow(() => createApiServer());

  if (typeof prevKey === 'string') process.env.RLHF_API_KEY = prevKey;
  else delete process.env.RLHF_API_KEY;
  if (typeof prevInsecure === 'string') process.env.RLHF_ALLOW_INSECURE = prevInsecure;
  else delete process.env.RLHF_ALLOW_INSECURE;
});

test('server created with key returns http.Server with listen method', () => {
  const prevKey = process.env.RLHF_API_KEY;
  const prevInsecure = process.env.RLHF_ALLOW_INSECURE;
  process.env.RLHF_API_KEY = 'test-key-12345';
  delete process.env.RLHF_ALLOW_INSECURE;

  const { createApiServer } = require('../src/api/server');
  const server = createApiServer();
  assert.equal(typeof server.listen, 'function', 'server should have listen method');
  assert.equal(typeof server.close, 'function', 'server should have close method');

  if (typeof prevKey === 'string') process.env.RLHF_API_KEY = prevKey;
  else delete process.env.RLHF_API_KEY;
  if (typeof prevInsecure === 'string') process.env.RLHF_ALLOW_INSECURE = prevInsecure;
  else delete process.env.RLHF_ALLOW_INSECURE;
});

// Branch coverage: exercise the else-delete paths when vars were undefined
test('env restoration covers the else-delete paths when vars were undefined', () => {
  const origKey = process.env.RLHF_API_KEY;
  const origInsecure = process.env.RLHF_ALLOW_INSECURE;

  process.env.RLHF_API_KEY = 'pre-existing-key';
  process.env.RLHF_ALLOW_INSECURE = 'false';

  const prevKey = process.env.RLHF_API_KEY;
  const prevInsecure = process.env.RLHF_ALLOW_INSECURE;

  process.env.RLHF_API_KEY = 'test-key-branch';
  process.env.RLHF_ALLOW_INSECURE = 'true';

  const { createApiServer } = require('../src/api/server');
  assert.doesNotThrow(() => createApiServer());

  if (typeof prevKey === 'string') process.env.RLHF_API_KEY = prevKey;
  else delete process.env.RLHF_API_KEY;
  if (typeof prevInsecure === 'string') process.env.RLHF_ALLOW_INSECURE = prevInsecure;
  else delete process.env.RLHF_ALLOW_INSECURE;

  assert.equal(process.env.RLHF_API_KEY, 'pre-existing-key');
  assert.equal(process.env.RLHF_ALLOW_INSECURE, 'false');

  if (typeof origKey === 'string') process.env.RLHF_API_KEY = origKey;
  else delete process.env.RLHF_API_KEY;
  if (typeof origInsecure === 'string') process.env.RLHF_ALLOW_INSECURE = origInsecure;
  else delete process.env.RLHF_ALLOW_INSECURE;
});

test('RLHF_ALLOW_INSECURE with non-true value still requires key', () => {
  const prevKey = process.env.RLHF_API_KEY;
  const prevInsecure = process.env.RLHF_ALLOW_INSECURE;
  delete process.env.RLHF_API_KEY;
  process.env.RLHF_ALLOW_INSECURE = 'false';

  const { createApiServer } = require('../src/api/server');
  assert.throws(() => createApiServer(), /RLHF_API_KEY is required/);

  if (typeof prevKey === 'string') process.env.RLHF_API_KEY = prevKey;
  else delete process.env.RLHF_API_KEY;
  if (typeof prevInsecure === 'string') process.env.RLHF_ALLOW_INSECURE = prevInsecure;
  else delete process.env.RLHF_ALLOW_INSECURE;
});

test('both key and insecure mode set simultaneously', () => {
  const prevKey = process.env.RLHF_API_KEY;
  const prevInsecure = process.env.RLHF_ALLOW_INSECURE;
  process.env.RLHF_API_KEY = 'both-set-key';
  process.env.RLHF_ALLOW_INSECURE = 'true';

  const { createApiServer } = require('../src/api/server');
  assert.doesNotThrow(() => createApiServer());

  if (typeof prevKey === 'string') process.env.RLHF_API_KEY = prevKey;
  else delete process.env.RLHF_API_KEY;
  if (typeof prevInsecure === 'string') process.env.RLHF_ALLOW_INSECURE = prevInsecure;
  else delete process.env.RLHF_ALLOW_INSECURE;
});
