'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  PLATFORM_CHAR_LIMITS,
  getLimit,
  normalizePlatformKey,
  truncateForPlatform,
  validateContentForPlatforms,
} = require('../scripts/social-analytics/platform-limits');

describe('platform-limits', () => {
  describe('PLATFORM_CHAR_LIMITS', () => {
    it('exposes canonical limits used by Zernio publisher', () => {
      assert.equal(PLATFORM_CHAR_LIMITS.bluesky, 300);
      assert.equal(PLATFORM_CHAR_LIMITS.twitter, 280);
      assert.equal(PLATFORM_CHAR_LIMITS.x, 280);
      assert.equal(PLATFORM_CHAR_LIMITS.linkedin, 3000);
    });

    it('is frozen to prevent accidental mutation', () => {
      assert.throws(() => {
        PLATFORM_CHAR_LIMITS.bluesky = 9999;
      });
    });
  });

  describe('normalizePlatformKey', () => {
    it('lowercases and trims', () => {
      assert.equal(normalizePlatformKey('  Bluesky  '), 'bluesky');
    });

    it('returns empty string for nullish', () => {
      assert.equal(normalizePlatformKey(null), '');
      assert.equal(normalizePlatformKey(undefined), '');
    });
  });

  describe('getLimit', () => {
    it('returns the limit for a known platform', () => {
      assert.equal(getLimit('bluesky'), 300);
      assert.equal(getLimit('LinkedIn'), 3000);
    });

    it('returns null for unknown platform', () => {
      assert.equal(getLimit('myspace'), null);
    });
  });

  describe('validateContentForPlatforms', () => {
    it('accepts content within every platform limit', () => {
      const { valid, rejected } = validateContentForPlatforms('hello world', [
        { platform: 'bluesky', accountId: 'a1' },
        { platform: 'twitter', accountId: 'a2' },
      ]);

      assert.equal(valid.length, 2);
      assert.equal(rejected.length, 0);
    });

    it('rejects only the platforms whose limit is exceeded', () => {
      const content = 'x'.repeat(315); // the real 2026-04-16 failure length
      const { valid, rejected } = validateContentForPlatforms(content, [
        { platform: 'bluesky', accountId: 'a1' },   // 300 → rejected by 15
        { platform: 'twitter', accountId: 'a2' },   // 280 → rejected by 35
        { platform: 'linkedin', accountId: 'a3' },  // 3000 → valid
      ]);

      assert.equal(valid.length, 1);
      assert.equal(valid[0].platform, 'linkedin');

      assert.equal(rejected.length, 2);
      const bluesky = rejected.find((r) => r.platform === 'bluesky');
      assert.equal(bluesky.limit, 300);
      assert.equal(bluesky.length, 315);
      assert.equal(bluesky.overBy, 15);

      const twitter = rejected.find((r) => r.platform === 'twitter');
      assert.equal(twitter.overBy, 35);
    });

    it('counts codepoints, not UTF-16 code units, for emoji content', () => {
      // Each 👍 is one codepoint but two UTF-16 units. Bluesky counts graphemes
      // roughly by codepoint; this keeps us conservative and consistent.
      const content = '👍'.repeat(150); // 150 codepoints, 300 UTF-16 units
      const { valid, rejected } = validateContentForPlatforms(content, [
        { platform: 'bluesky', accountId: 'a1' },
      ]);
      assert.equal(valid.length, 1);
      assert.equal(rejected.length, 0);
    });

    it('passes unknown platforms through as valid (Zernio is the arbiter)', () => {
      const { valid, rejected } = validateContentForPlatforms('hi', [
        { platform: 'myspace', accountId: 'a1' },
      ]);
      assert.equal(valid.length, 1);
      assert.equal(valid[0].limit, null);
      assert.equal(rejected.length, 0);
    });

    it('handles empty or missing platform list', () => {
      const { valid, rejected } = validateContentForPlatforms('hi', []);
      assert.equal(valid.length, 0);
      assert.equal(rejected.length, 0);
    });

    it('ignores non-object platform entries', () => {
      const { valid, rejected } = validateContentForPlatforms('hi', [null, undefined, 'bluesky']);
      assert.equal(valid.length, 0);
      assert.equal(rejected.length, 0);
    });
  });

  describe('truncateForPlatform', () => {
    it('returns original content when within limit', () => {
      assert.equal(truncateForPlatform('hello', 'bluesky'), 'hello');
    });

    it('truncates and appends ellipsis for over-limit content', () => {
      const content = 'word '.repeat(100); // 500 chars
      const truncated = truncateForPlatform(content, 'bluesky');
      assert.ok([...truncated].length <= 300);
      assert.ok(truncated.endsWith('…'));
    });

    it('prefers word boundary when truncating', () => {
      const content = 'alpha beta gamma delta '.repeat(20);
      const truncated = truncateForPlatform(content, 'bluesky');
      // Body (without ellipsis) must be a prefix of the original after
      // stripping the trailing space — i.e. we cut at a word boundary,
      // never mid-word.
      const body = truncated.replace(/…$/, '');
      assert.ok(
        content.trimEnd().startsWith(body),
        `truncated body "${body.slice(-30)}" must be a prefix of original`,
      );
      // And the last char of the body must be the end of a whole word.
      const words = content.trim().split(/\s+/);
      const endsOnWord = words.some((w) => body.endsWith(w));
      assert.ok(endsOnWord, `truncated body must end on a full word: "${body.slice(-30)}"`);
    });

    it('returns content unchanged for unknown platform', () => {
      const content = 'x'.repeat(10_000);
      assert.equal(truncateForPlatform(content, 'myspace'), content);
    });

    it('uses a custom ellipsis when provided', () => {
      const content = 'x'.repeat(400);
      const truncated = truncateForPlatform(content, 'bluesky', { ellipsis: ' [cont]' });
      assert.ok(truncated.endsWith(' [cont]'));
      assert.ok([...truncated].length <= 300);
    });
  });
});
