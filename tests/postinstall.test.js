'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const { PRO_MONTHLY_PAYMENT_LINK } = require('../scripts/commercial-offer');

const POSTINSTALL = path.join(__dirname, '..', 'bin', 'postinstall.js');

function runPostinstall(envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  // Delete CI vars unless explicitly set in overrides
  if (!('CI' in envOverrides)) delete env.CI;
  if (!('CONTINUOUS_INTEGRATION' in envOverrides)) delete env.CONTINUOUS_INTEGRATION;
  if (!('GITHUB_ACTIONS' in envOverrides)) delete env.GITHUB_ACTIONS;
  if (!('THUMBGATE_NO_NUDGE' in envOverrides)) delete env.THUMBGATE_NO_NUDGE;
  const result = spawnSync(process.execPath, [POSTINSTALL], {
    encoding: 'utf8',
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: Number.isInteger(result.status) ? result.status : 1,
  };
}

function extractHttpUrls(text) {
  return Array.from(String(text || '').matchAll(/https:\/\/[^\s)]+/g), (match) => match[0]);
}

describe('postinstall banner', () => {
  it('stdout is empty (no MCP contamination)', () => {
    const { stdout } = runPostinstall();
    assert.equal(stdout, '', 'stdout should be empty');
  });

  it('includes checkout URL in stderr output', () => {
    const { stderr, exitCode } = runPostinstall();
    assert.equal(exitCode, 0);
    const checkoutUrl = extractHttpUrls(stderr).find((candidate) => new URL(candidate).host === 'buy.stripe.com');
    assert.equal(checkoutUrl, PRO_MONTHLY_PAYMENT_LINK, 'should include checkout URL');
    assert.ok(stderr.includes('ThumbGate'), 'should mention ThumbGate');
    assert.ok(stderr.includes('npx thumbgate'), 'should include quick start');
    assert.match(stderr, /Free.*captures/i);
    assert.match(stderr, /Pro.*dashboard/i);
    assert.match(stderr, /\$19\/mo or \$149\/yr/i);
  });

  it('exits silently in CI', () => {
    const { stdout, stderr, exitCode } = runPostinstall({ CI: 'true' });
    assert.equal(exitCode, 0);
    assert.equal(stdout.trim(), '', 'should produce no stdout in CI');
    assert.equal(stderr.trim(), '', 'should produce no stderr in CI');
  });

  it('exits silently with THUMBGATE_NO_NUDGE=1', () => {
    const { stdout, stderr, exitCode } = runPostinstall({ THUMBGATE_NO_NUDGE: '1' });
    assert.equal(exitCode, 0);
    assert.equal(stdout.trim(), '', 'should produce no stdout when nudge disabled');
    assert.equal(stderr.trim(), '', 'should produce no stderr when nudge disabled');
  });
});
