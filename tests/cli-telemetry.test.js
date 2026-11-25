'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getInstallId, classifyInstall, trackEvent } = require('../scripts/cli-telemetry');

test('getInstallId returns a stable string', () => {
  const id1 = getInstallId();
  const id2 = getInstallId();
  assert.equal(typeof id1, 'string');
  assert.ok(id1.length >= 16);
  assert.equal(id1, id2, 'Should return same ID on repeated calls');
});

test('classifyInstall detects CI environment', () => {
  const origCI = process.env.CI;
  process.env.CI = 'true';
  assert.equal(classifyInstall(), 'ci');
  if (origCI) process.env.CI = origCI; else delete process.env.CI;
});

test('classifyInstall detects GitHub Actions', () => {
  const orig = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = 'true';
  assert.equal(classifyInstall(), 'ci');
  if (orig) process.env.GITHUB_ACTIONS = orig; else delete process.env.GITHUB_ACTIONS;
});

test('classifyInstall returns real_user when not CI or owner', () => {
  const origCI = process.env.CI;
  const origGH = process.env.GITHUB_ACTIONS;
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  const result = classifyInstall();
  // On a dev machine this might be 'owner' if username is igor, otherwise 'real_user'
  assert.ok(['real_user', 'owner'].includes(result));
  if (origCI) process.env.CI = origCI;
  if (origGH) process.env.GITHUB_ACTIONS = origGH;
});

test('trackEvent does not throw with telemetry disabled', () => {
  const orig = process.env.THUMBGATE_NO_TELEMETRY;
  process.env.THUMBGATE_NO_TELEMETRY = '1';
  assert.doesNotThrow(() => trackEvent('test_event', { foo: 'bar' }));
  if (orig) process.env.THUMBGATE_NO_TELEMETRY = orig; else delete process.env.THUMBGATE_NO_TELEMETRY;
});

test('trackEvent does not throw with DO_NOT_TRACK', () => {
  const orig = process.env.DO_NOT_TRACK;
  process.env.DO_NOT_TRACK = '1';
  assert.doesNotThrow(() => trackEvent('test_event'));
  if (orig) process.env.DO_NOT_TRACK = orig; else delete process.env.DO_NOT_TRACK;
});

test('isOwnerAgentSession: only the owner account hash marks a session as owner; a clone of the public repo does not', () => {
  const crypto = require('node:crypto');
  const { isOwnerAgentSession } = require('../scripts/cli-telemetry');
  const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
  assert.equal(isOwnerAgentSession({}), false, 'no Claude account at all');
  assert.equal(isOwnerAgentSession({ CLAUDE_CODE_USER_EMAIL: 'someone@example.test' }), false, 'any other account is a real user');
  assert.equal(isOwnerAgentSession({ CLAUDE_CODE_USER_EMAIL: ' Agent@Example.Test ', THUMBGATE_OWNER_ACCOUNT_HASHES: 'x, ' + hash('agent@example.test') }), true, 'trimmed, lower-cased, extra hashes honoured');
});

test('trackEventDetached hands the built payload to one detached child with ignored stdio', () => {
  const { trackEventDetached } = require('../scripts/cli-telemetry');
  const saved = { a: process.env.THUMBGATE_NO_TELEMETRY, b: process.env.DO_NOT_TRACK };
  delete process.env.THUMBGATE_NO_TELEMETRY;
  delete process.env.DO_NOT_TRACK;
  try {
    const calls = [];
    const spawnFn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { on() {}, unref() {} }; };
    assert.equal(trackEventDetached('first_block_upsell_shown', { gateId: 'force-push' }, { spawnFn }), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, process.execPath);
    assert.match(calls[0].args[0], /cli-telemetry\.js$/);
    assert.equal(calls[0].args[1], '--deliver');
    assert.equal(calls[0].opts.detached, true);
    assert.equal(calls[0].opts.stdio, 'ignore');
    const payload = JSON.parse(calls[0].opts.env.THUMBGATE_TELEMETRY_PAYLOAD);
    assert.equal(payload.eventType, 'first_block_upsell_shown');
    assert.equal(payload.gateId, 'force-push');
    assert.equal(payload.clientType, 'cli');
    assert.ok(payload.installId);

    process.env.THUMBGATE_NO_TELEMETRY = '1';
    assert.equal(trackEventDetached('x', {}, { spawnFn: () => { throw new Error('must not spawn'); } }), false);
  } finally {
    if (saved.a === undefined) delete process.env.THUMBGATE_NO_TELEMETRY; else process.env.THUMBGATE_NO_TELEMETRY = saved.a;
    if (saved.b === undefined) delete process.env.DO_NOT_TRACK; else process.env.DO_NOT_TRACK = saved.b;
  }
});

test('trackEvent with awaitDelivery returns a promise, and false when telemetry is off', async () => {
  const saved = process.env.THUMBGATE_NO_TELEMETRY;
  process.env.THUMBGATE_NO_TELEMETRY = '1';
  try {
    const p = trackEvent('x', {}, { awaitDelivery: true });
    assert.ok(p && typeof p.then === 'function');
    assert.equal(await p, false);
    assert.equal(trackEvent('x'), undefined);
  } finally {
    if (saved === undefined) delete process.env.THUMBGATE_NO_TELEMETRY; else process.env.THUMBGATE_NO_TELEMETRY = saved;
  }
});
