'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verdict, cleanEnv, ENFORCEMENT_KEYS } = require('../scripts/paraphrase-test');

test('verdict reports a failed gate-check as error, not nothing', () => {
  assert.equal(verdict({ status: null, signal: 'SIGTERM', stdout: '' }), 'error');
  assert.equal(verdict({ error: new Error('spawnSync ETIMEDOUT'), status: null, stdout: '' }), 'error');
  assert.equal(verdict({ status: 1, stdout: '' }), 'error');
  assert.equal(verdict({ status: 0, stdout: '{"additionalContext":"[ThumbGate Error] boom"}' }), 'error');
});

test('verdict keeps deny and empty-success results', () => {
  assert.equal(verdict({ status: 0, stdout: '{"permissionDecision": "deny"}' }), 'blocked');
  assert.equal(verdict({ status: 0, stdout: '' }), 'nothing');
});

test('cleanEnv drops inherited enforcement and bypass settings', () => {
  const env = cleanEnv({
    PATH: '/bin',
    THUMBGATE_STRICT_ENFORCEMENT: '1',
    THUMBGATE_GOVERNANCE_MODE: 'live',
    THUMBGATE_HOTFIX_BYPASS: '1',
  });
  assert.equal(env.PATH, '/bin');
  for (const key of ENFORCEMENT_KEYS) assert.equal(key in env, false, key);
});
