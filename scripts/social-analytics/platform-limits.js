'use strict';

/**
 * platform-limits.js
 * Per-platform character limits for social posts.
 *
 * Zernio blasts identical content to every connected platform. Bluesky's
 * 300-char ceiling is silently exceeded otherwise, and the provider rejects
 * the scheduled post at publish time (see 2026-04-16 CEO-reported failure
 * for post 69d939ba88955f0579e44fa7, 315 chars).
 *
 * Canonical limits (as of 2026-04):
 *   bluesky   300
 *   twitter   280  (alias: x)
 *   threads   500
 *   mastodon  500  (default instance limit)
 *   instagram 2200
 *   facebook  63206
 *   linkedin  3000
 *   tiktok    2200  (caption)
 *   youtube   5000  (description); 100 (title)
 *   pinterest 500   (description)
 */

const PLATFORM_CHAR_LIMITS = Object.freeze({
  bluesky: 300,
  twitter: 280,
  x: 280,
  threads: 500,
  mastodon: 500,
  instagram: 2200,
  facebook: 63206,
  linkedin: 3000,
  tiktok: 2200,
  youtube: 5000,
  pinterest: 500,
});

function normalizePlatformKey(platform) {
  return String(platform || '').trim().toLowerCase();
}

function getLimit(platform) {
  const key = normalizePlatformKey(platform);
  return PLATFORM_CHAR_LIMITS[key] ?? null;
}

/**
 * Validates content length against each target platform's limit.
 *
 * @param {string} content
 * @param {Array<{platform: string, accountId: string}>} platforms
 * @returns {{
 *   valid: Array<{platform: string, accountId: string, limit: number|null, length: number}>,
 *   rejected: Array<{platform: string, accountId: string, limit: number, length: number, overBy: number}>,
 * }}
 */
function validateContentForPlatforms(content, platforms) {
  const text = String(content || '');
  const length = [...text].length; // codepoint-aware length
  const valid = [];
  const rejected = [];

  for (const entry of Array.isArray(platforms) ? platforms : []) {
    if (!entry || typeof entry !== 'object') continue;
    const platformName = entry.platform;
    const limit = getLimit(platformName);

    if (limit === null) {
      // Unknown platform — let Zernio be the arbiter rather than block.
      valid.push({ ...entry, limit: null, length });
      continue;
    }

    if (length > limit) {
      rejected.push({
        ...entry,
        limit,
        length,
        overBy: length - limit,
      });
      continue;
    }

    valid.push({ ...entry, limit, length });
  }

  return { valid, rejected };
}

/**
 * Truncates content to a platform's limit, preserving word boundaries when
 * possible and appending an ellipsis. Falls back to a hard slice if the
 * content has no whitespace in the tail segment.
 *
 * @param {string} content
 * @param {string} platform
 * @param {{ ellipsis?: string }} [options]
 * @returns {string}
 */
function truncateForPlatform(content, platform, options = {}) {
  const text = String(content || '');
  const limit = getLimit(platform);
  if (limit === null) return text;

  const chars = [...text];
  if (chars.length <= limit) return text;

  const ellipsis = options.ellipsis ?? '…';
  const ellipsisLen = [...ellipsis].length;
  const budget = Math.max(0, limit - ellipsisLen);
  const head = chars.slice(0, budget).join('');

  // Prefer last whitespace boundary to avoid mid-word cuts.
  const lastSpace = head.search(/\s\S*$/);
  const cleaned = lastSpace > Math.floor(budget * 0.6) ? head.slice(0, lastSpace) : head;

  return cleaned.replace(/[\s\p{P}]+$/u, '') + ellipsis;
}

module.exports = {
  PLATFORM_CHAR_LIMITS,
  getLimit,
  normalizePlatformKey,
  truncateForPlatform,
  validateContentForPlatforms,
};
