'use strict';

/**
 * tests/post-everywhere-zernio-default.test.js
 *
 * Pins the Zernio-preferred dispatcher routing introduced to honor the
 * CLAUDE.md rule: "Zernio-backed dispatchers are the preferred path where
 * ZERNIO_API_KEY is present." Keeps the set of Zernio-eligible channels
 * explicit and ensures the THUMBGATE_USE_DIRECT_PUBLISHERS=1 fallback
 * still forces the legacy direct-API path.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldUseZernio,
  ZERNIO_ELIGIBLE_PLATFORMS,
} = require('../scripts/post-everywhere');

function withEnv(overrides, fn) {
  const snapshot = {};
  for (const key of Object.keys(overrides)) snapshot[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('ZERNIO_ELIGIBLE_PLATFORMS pins the Zernio-capable channels', () => {
  assert.deepEqual(
    Array.from(ZERNIO_ELIGIBLE_PLATFORMS).sort(),
    ['bluesky', 'linkedin', 'threads'],
    'Zernio-eligible set must be exactly linkedin+threads+bluesky. ' +
      'Reddit, Instagram, YouTube, Dev.to, TikTok stay on direct-API ' +
      'because Zernio cannot match their content shape (subreddit+title, ' +
      'media, video, articles).'
  );
});

test('shouldUseZernio returns false when ZERNIO_API_KEY is absent', () => {
  withEnv({ ZERNIO_API_KEY: undefined, THUMBGATE_USE_DIRECT_PUBLISHERS: undefined }, () => {
    for (const platform of ZERNIO_ELIGIBLE_PLATFORMS) {
      assert.equal(shouldUseZernio(platform), false);
    }
  });
});

test('shouldUseZernio returns true for eligible platforms when ZERNIO_API_KEY is set', () => {
  withEnv({ ZERNIO_API_KEY: 'test-key', THUMBGATE_USE_DIRECT_PUBLISHERS: undefined }, () => {
    assert.equal(shouldUseZernio('linkedin'), true);
    assert.equal(shouldUseZernio('threads'), true);
    assert.equal(shouldUseZernio('bluesky'), true);
  });
});

test('shouldUseZernio returns false for ineligible platforms even when key is set', () => {
  withEnv({ ZERNIO_API_KEY: 'test-key', THUMBGATE_USE_DIRECT_PUBLISHERS: undefined }, () => {
    for (const platform of ['reddit', 'instagram', 'youtube', 'devto', 'tiktok']) {
      assert.equal(
        shouldUseZernio(platform),
        false,
        `${platform} must stay on direct-API — Zernio cannot handle its content shape`
      );
    }
  });
});

test('THUMBGATE_USE_DIRECT_PUBLISHERS=1 forces direct-API even when key is set', () => {
  withEnv({ ZERNIO_API_KEY: 'test-key', THUMBGATE_USE_DIRECT_PUBLISHERS: '1' }, () => {
    for (const platform of ZERNIO_ELIGIBLE_PLATFORMS) {
      assert.equal(
        shouldUseZernio(platform),
        false,
        `${platform} must fall back to direct-API when escape flag is set`
      );
    }
  });
});

test('THUMBGATE_USE_DIRECT_PUBLISHERS with any value other than "1" does not trigger escape', () => {
  withEnv({ ZERNIO_API_KEY: 'test-key', THUMBGATE_USE_DIRECT_PUBLISHERS: 'true' }, () => {
    assert.equal(shouldUseZernio('linkedin'), true);
  });
});

test('DISPATCHERS.linkedin and DISPATCHERS.threads route through zernio.publishToAllPlatforms', async () => {
  // Dispatchers now unconditionally route through publishToAllPlatforms (single
  // code path, account discovery handled by Zernio). The prior stub targeted a
  // broken publishPost({text, platform}) contract that never existed.
  const zernioPath = require.resolve('../scripts/social-analytics/publishers/zernio');
  const peModulePath = require.resolve('../scripts/post-everywhere');
  const calls = [];
  const previousZernio = require.cache[zernioPath];
  const prevKey = process.env.ZERNIO_API_KEY;
  const prevEscape = process.env.THUMBGATE_USE_DIRECT_PUBLISHERS;
  require.cache[zernioPath] = {
    id: zernioPath,
    filename: zernioPath,
    loaded: true,
    exports: {
      publishToAllPlatforms: async (content, options) => {
        calls.push({ content, options });
        return { via: 'zernio-stub', content, options };
      },
      isDuplicate: () => false,
      recordPost: () => {},
    },
  };
  delete require.cache[peModulePath];
  process.env.ZERNIO_API_KEY = 'test-key';
  delete process.env.THUMBGATE_USE_DIRECT_PUBLISHERS;
  try {
    const { DISPATCHERS } = require('../scripts/post-everywhere');
    const linkedinResult = await DISPATCHERS.linkedin({ body: 'hello-linkedin' }, false);
    const threadsResult = await DISPATCHERS.threads({ body: 'hello-threads' }, false);
    assert.equal(linkedinResult.via, 'zernio-stub');
    assert.equal(threadsResult.via, 'zernio-stub');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].options, {
      platforms: ['linkedin'],
      campaign: 'organic',
      medium: 'social',
    });
    assert.deepEqual(calls[1].options, {
      platforms: ['threads'],
      campaign: 'organic',
      medium: 'social',
    });
    assert.equal(calls[0].content, 'hello-linkedin');
    assert.ok(calls[1].content.includes('hello-threads'));
  } finally {
    if (prevKey === undefined) delete process.env.ZERNIO_API_KEY;
    else process.env.ZERNIO_API_KEY = prevKey;
    if (prevEscape === undefined) delete process.env.THUMBGATE_USE_DIRECT_PUBLISHERS;
    else process.env.THUMBGATE_USE_DIRECT_PUBLISHERS = prevEscape;
    if (previousZernio) require.cache[zernioPath] = previousZernio;
    else delete require.cache[zernioPath];
    delete require.cache[peModulePath];
  }
});
