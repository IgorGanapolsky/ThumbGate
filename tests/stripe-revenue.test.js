'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'stripe-revenue.js');

test('stripe revenue key validation never logs provided key material', () => {
  const invalidKey = 'invalid_secret_key_prefix_1234567890';
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      STRIPE_READ_KEY: invalidKey,
      STRIPE_SECRET_KEY: '',
      STRIPE_API_KEY: '',
    },
    encoding: 'utf8',
  });

  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 2);
  assert.match(output, /Stripe key format is invalid/);
  assert.doesNotMatch(output, /invalid_secret_key_prefix/);
  assert.doesNotMatch(output, /1234567890/);
});
