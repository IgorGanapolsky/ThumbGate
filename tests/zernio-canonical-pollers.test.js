'use strict';

/**
 * tests/zernio-canonical-pollers.test.js
 *
 * Pins the "Zernio for everything" contract:
 *   - The default POLLERS list contains only github + plausible + zernio
 *   - LEGACY_POLLERS holds the 7 retired direct-API pollers
 *   - activePollers() returns the narrow list by default, and the union only
 *     when THUMBGATE_USE_DIRECT_POLLERS=1 explicitly opts in.
 *
 * Regression guard: if someone re-adds a per-platform poller to the active
 * list, this test fails loudly and forces a CLAUDE.md update.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { POLLERS, LEGACY_POLLERS, activePollers } = require('../scripts/social-analytics/poll-all');

test('POLLERS is the Zernio-canonical narrow list', () => {
  const names = POLLERS.map((p) => p.name);
  assert.deepEqual(names, ['github', 'plausible', 'zernio']);
});

test('LEGACY_POLLERS contains the retired direct-API pollers', () => {
  const names = LEGACY_POLLERS.map((p) => p.name).sort();
  assert.deepEqual(names, [
    'instagram',
    'linkedin',
    'reddit',
    'threads',
    'tiktok',
    'x',
    'youtube',
  ]);
});

test('every POLLERS entry declares required env keys', () => {
  for (const p of POLLERS) {
    assert.ok(Array.isArray(p.envRequired) && p.envRequired.length > 0,
      `poller ${p.name} must declare at least one required env var`);
  }
});

test('activePollers defaults to the Zernio-canonical list', () => {
  const prev = process.env.THUMBGATE_USE_DIRECT_POLLERS;
  delete process.env.THUMBGATE_USE_DIRECT_POLLERS;
  try {
    const active = activePollers().map((p) => p.name);
    assert.deepEqual(active, ['github', 'plausible', 'zernio']);
  } finally {
    if (prev !== undefined) process.env.THUMBGATE_USE_DIRECT_POLLERS = prev;
  }
});

test('activePollers includes legacy list when THUMBGATE_USE_DIRECT_POLLERS=1', () => {
  const prev = process.env.THUMBGATE_USE_DIRECT_POLLERS;
  process.env.THUMBGATE_USE_DIRECT_POLLERS = '1';
  try {
    const active = activePollers().map((p) => p.name);
    // canonical list first, then legacy list
    assert.deepEqual(active.slice(0, 3), ['github', 'plausible', 'zernio']);
    for (const legacyName of LEGACY_POLLERS.map((p) => p.name)) {
      assert.ok(active.includes(legacyName), `expected ${legacyName} in legacy-enabled list`);
    }
  } finally {
    if (prev === undefined) delete process.env.THUMBGATE_USE_DIRECT_POLLERS;
    else process.env.THUMBGATE_USE_DIRECT_POLLERS = prev;
  }
});

test('no legacy poller has leaked back into the default POLLERS', () => {
  const defaultNames = new Set(POLLERS.map((p) => p.name));
  for (const legacy of LEGACY_POLLERS) {
    assert.equal(
      defaultNames.has(legacy.name),
      false,
      `legacy poller "${legacy.name}" must not appear in the default POLLERS list — ` +
        'see CLAUDE.md § Social stack: Zernio canonical'
    );
  }
});
