'use strict';

/**
 * tests/post-everywhere-channels.test.js
 *
 * Pins the distribution channel focus set. On 2026-04-20 ThumbGate dropped
 * X/Twitter from the active posting loop and consolidated on six channels:
 * Reddit, LinkedIn, Threads, Bluesky, Instagram, YouTube.
 *
 * These tests keep the default list honest so that a drive-by refactor
 * cannot silently re-introduce X or drop one of the six focus channels
 * without a corresponding test update.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_PLATFORMS, DISPATCHERS } = require('../scripts/post-everywhere');

const FOCUS_CHANNELS = Object.freeze([
  'reddit',
  'linkedin',
  'threads',
  'bluesky',
  'instagram',
  'youtube',
]);

test('DEFAULT_PLATFORMS pins the six focus channels (no X, no drift)', () => {
  assert.deepEqual(
    Array.from(DEFAULT_PLATFORMS),
    Array.from(FOCUS_CHANNELS),
    'DEFAULT_PLATFORMS must exactly match the CEO-approved focus channel list. ' +
      'See CLAUDE.md § Distribution Channel Focus before changing.'
  );
});

test('DEFAULT_PLATFORMS does not contain X/Twitter aliases', () => {
  for (const banned of ['x', 'twitter', 'X', 'Twitter']) {
    assert.equal(
      DEFAULT_PLATFORMS.includes(banned),
      false,
      `DEFAULT_PLATFORMS must not include "${banned}" — X was retired 2026-04-20`
    );
  }
});

test('DISPATCHERS has a handler for every focus channel', () => {
  for (const platform of FOCUS_CHANNELS) {
    assert.equal(
      typeof DISPATCHERS[platform],
      'function',
      `missing dispatcher for focus channel: ${platform}`
    );
  }
});

test('DISPATCHERS does not expose an X/Twitter dispatcher', () => {
  assert.equal(
    DISPATCHERS.x,
    undefined,
    'DISPATCHERS.x must be absent — X/Twitter was retired from active distribution 2026-04-20'
  );
  assert.equal(
    DISPATCHERS.twitter,
    undefined,
    'DISPATCHERS.twitter must be absent'
  );
});

test('marketing-autopilot workflow default platforms match focus channels', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'marketing-autopilot.yml'),
    'utf8'
  );

  // The default platform list must contain all six focus channels.
  for (const platform of FOCUS_CHANNELS) {
    // Reddit goes through a dedicated OAuth step, so it doesn't need to be
    // in the Zernio-side default list. The other five must be.
    if (platform === 'reddit') continue;
    assert.match(
      workflow,
      new RegExp(`default:\\s*['"][^'"]*${platform}`),
      `marketing-autopilot workflow must include ${platform} in its default platform list`
    );
  }

  // Must NOT default to twitter/X.
  assert.doesNotMatch(
    workflow,
    /default:\s*['"][^'"]*twitter/,
    'marketing-autopilot workflow must not default to twitter — X retired 2026-04-20'
  );
});
