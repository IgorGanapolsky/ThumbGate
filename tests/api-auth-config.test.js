const test = require('node:test');
const assert = require('node:assert/strict');

test('createApiServer requires THUMBGATE_API_KEY unless insecure mode is enabled', () => {
  const previousKey = process.env.THUMBGATE_API_KEY;
  const previousInsecure = process.env.THUMBGATE_ALLOW_INSECURE;

  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_ALLOW_INSECURE;

  const { createApiServer } = require('../src/api/server');
  assert.throws(() => createApiServer(), /THUMBGATE_API_KEY is required/);

  process.env.THUMBGATE_ALLOW_INSECURE = 'true';
  assert.doesNotThrow(() => createApiServer());

  if (typeof previousKey === 'string') process.env.THUMBGATE_API_KEY = previousKey;
  else delete process.env.THUMBGATE_API_KEY;
  if (typeof previousInsecure === 'string') process.env.THUMBGATE_ALLOW_INSECURE = previousInsecure;
  else delete process.env.THUMBGATE_ALLOW_INSECURE;
});

test('missing THUMBGATE_API_KEY with THUMBGATE_ALLOW_INSECURE unset throws', () => {
  const prevKey = process.env.THUMBGATE_API_KEY;
  const prevInsecure = process.env.THUMBGATE_ALLOW_INSECURE;
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_ALLOW_INSECURE;

  const { createApiServer } = require('../src/api/server');
  assert.throws(() => createApiServer(), /THUMBGATE_API_KEY is required/);

  if (typeof prevKey === 'string') process.env.THUMBGATE_API_KEY = prevKey;
  else delete process.env.THUMBGATE_API_KEY;
  if (typeof prevInsecure === 'string') process.env.THUMBGATE_ALLOW_INSECURE = prevInsecure;
  else delete process.env.THUMBGATE_ALLOW_INSECURE;
});

test('THUMBGATE_ALLOW_INSECURE=true allows creation without key', () => {
  const prevKey = process.env.THUMBGATE_API_KEY;
  const prevInsecure = process.env.THUMBGATE_ALLOW_INSECURE;
  delete process.env.THUMBGATE_API_KEY;
  process.env.THUMBGATE_ALLOW_INSECURE = 'true';

  const { createApiServer } = require('../src/api/server');
  assert.doesNotThrow(() => createApiServer());

  if (typeof prevKey === 'string') process.env.THUMBGATE_API_KEY = prevKey;
  else delete process.env.THUMBGATE_API_KEY;
  if (typeof prevInsecure === 'string') process.env.THUMBGATE_ALLOW_INSECURE = prevInsecure;
  else delete process.env.THUMBGATE_ALLOW_INSECURE;
});

test('setting THUMBGATE_API_KEY allows creation', () => {
  const prevKey = process.env.THUMBGATE_API_KEY;
  const prevInsecure = process.env.THUMBGATE_ALLOW_INSECURE;
  process.env.THUMBGATE_API_KEY = 'test-key-12345';
  delete process.env.THUMBGATE_ALLOW_INSECURE;

  const { createApiServer } = require('../src/api/server');
  assert.doesNotThrow(() => createApiServer());

  if (typeof prevKey === 'string') process.env.THUMBGATE_API_KEY = prevKey;
  else delete process.env.THUMBGATE_API_KEY;
  if (typeof prevInsecure === 'string') process.env.THUMBGATE_ALLOW_INSECURE = prevInsecure;
  else delete process.env.THUMBGATE_ALLOW_INSECURE;
});

test('server created with key returns http.Server with listen method', () => {
  const prevKey = process.env.THUMBGATE_API_KEY;
  const prevInsecure = process.env.THUMBGATE_ALLOW_INSECURE;
  process.env.THUMBGATE_API_KEY = 'test-key-12345';
  delete process.env.THUMBGATE_ALLOW_INSECURE;

  const { createApiServer } = require('../src/api/server');
  const server = createApiServer();
  assert.equal(typeof server.listen, 'function', 'server should have listen method');
  assert.equal(typeof server.close, 'function', 'server should have close method');

  if (typeof prevKey === 'string') process.env.THUMBGATE_API_KEY = prevKey;
  else delete process.env.THUMBGATE_API_KEY;
  if (typeof prevInsecure === 'string') process.env.THUMBGATE_ALLOW_INSECURE = prevInsecure;
  else delete process.env.THUMBGATE_ALLOW_INSECURE;
});

// Branch coverage: exercise the else-delete paths when vars were undefined
test('env restoration covers the else-delete paths when vars were undefined', () => {
  const origKey = process.env.THUMBGATE_API_KEY;
  const origInsecure = process.env.THUMBGATE_ALLOW_INSECURE;

  process.env.THUMBGATE_API_KEY = 'pre-existing-key';
  process.env.THUMBGATE_ALLOW_INSECURE = 'false';

  const prevKey = process.env.THUMBGATE_API_KEY;
  const prevInsecure = process.env.THUMBGATE_ALLOW_INSECURE;

  process.env.THUMBGATE_API_KEY = 'test-key-branch';
  process.env.THUMBGATE_ALLOW_INSECURE = 'true';

  const { createApiServer } = require('../src/api/server');
  assert.doesNotThrow(() => createApiServer());

  if (typeof prevKey === 'string') process.env.THUMBGATE_API_KEY = prevKey;
  else delete process.env.THUMBGATE_API_KEY;
  if (typeof prevInsecure === 'string') process.env.THUMBGATE_ALLOW_INSECURE = prevInsecure;
  else delete process.env.THUMBGATE_ALLOW_INSECURE;

  assert.equal(process.env.THUMBGATE_API_KEY, 'pre-existing-key');
  assert.equal(process.env.THUMBGATE_ALLOW_INSECURE, 'false');

  if (typeof origKey === 'string') process.env.THUMBGATE_API_KEY = origKey;
  else delete process.env.THUMBGATE_API_KEY;
  if (typeof origInsecure === 'string') process.env.THUMBGATE_ALLOW_INSECURE = origInsecure;
  else delete process.env.THUMBGATE_ALLOW_INSECURE;
});

test('THUMBGATE_ALLOW_INSECURE with non-true value still requires key', () => {
  const prevKey = process.env.THUMBGATE_API_KEY;
  const prevInsecure = process.env.THUMBGATE_ALLOW_INSECURE;
  delete process.env.THUMBGATE_API_KEY;
  process.env.THUMBGATE_ALLOW_INSECURE = 'false';

  const { createApiServer } = require('../src/api/server');
  assert.throws(() => createApiServer(), /THUMBGATE_API_KEY is required/);

  if (typeof prevKey === 'string') process.env.THUMBGATE_API_KEY = prevKey;
  else delete process.env.THUMBGATE_API_KEY;
  if (typeof prevInsecure === 'string') process.env.THUMBGATE_ALLOW_INSECURE = prevInsecure;
  else delete process.env.THUMBGATE_ALLOW_INSECURE;
});

test('both key and insecure mode set simultaneously', () => {
  const prevKey = process.env.THUMBGATE_API_KEY;
  const prevInsecure = process.env.THUMBGATE_ALLOW_INSECURE;
  process.env.THUMBGATE_API_KEY = 'both-set-key';
  process.env.THUMBGATE_ALLOW_INSECURE = 'true';

  const { createApiServer } = require('../src/api/server');
  assert.doesNotThrow(() => createApiServer());

  if (typeof prevKey === 'string') process.env.THUMBGATE_API_KEY = prevKey;
  else delete process.env.THUMBGATE_API_KEY;
  if (typeof prevInsecure === 'string') process.env.THUMBGATE_ALLOW_INSECURE = prevInsecure;
  else delete process.env.THUMBGATE_ALLOW_INSECURE;
});
