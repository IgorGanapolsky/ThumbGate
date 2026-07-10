'use strict';

const path = require('node:path');

/**
 * Bounds the publish guard's "pending changeset" exemption.
 *
 * `publish-npm.yml` already errors when shipped content changed since the last release tag but
 * package.json was never bumped. It exempts that error whenever a pending changeset exists,
 * on the theory that "the next versioned publish will ship it."
 *
 * Nothing bounded *until*. On 2026-07-09 a merged security fix (PR #2807, the
 * deny-network-egress host-boundary bypass) sat on main while `Publish to NPM` reported
 * success, because a changeset for it existed. `npm install thumbgate` kept serving the
 * vulnerable pattern and no check anywhere went red.
 *
 * An exemption with no expiry is not an audit, it is a silence. This bounds it: once the last
 * release tag is older than `maxUnreleasedDays`, a pending changeset stops excusing the no-op
 * and the workflow fails loudly.
 */

const DEFAULT_MAX_UNRELEASED_DAYS = 7;
const SECONDS_PER_DAY = 86400;

/**
 * Decide whether a publish no-op is acceptable.
 *
 * Pure: takes numbers, returns a verdict. All I/O lives in main().
 *
 * @param {object} input
 * @param {number} input.shippedChanges  files under shipped surfaces changed since lastTag
 * @param {number} input.pendingChangesets  changeset files added since lastTag
 * @param {number} input.lastTagTimestamp  unix seconds of the last release tag
 * @param {number} input.nowTimestamp  unix seconds, now
 * @param {number} [input.maxUnreleasedDays]
 * @returns {{ok: boolean, reason: string, ageDays: number}}
 */
function evaluateReleaseWindow({
  shippedChanges,
  pendingChangesets,
  lastTagTimestamp,
  nowTimestamp,
  maxUnreleasedDays = DEFAULT_MAX_UNRELEASED_DAYS,
}) {
  const ageDays = Math.floor((nowTimestamp - lastTagTimestamp) / SECONDS_PER_DAY);

  if (shippedChanges <= 0) {
    return { ok: true, reason: 'No shipped content changed since the last release tag.', ageDays };
  }

  if (pendingChangesets <= 0) {
    return {
      ok: false,
      reason:
        `Silent no-op: ${shippedChanges} shipped file(s) changed since the last release tag ` +
        'and no changeset explains them. Bump the version or add a changeset.',
      ageDays,
    };
  }

  // A changeset exists. Excuse the no-op only while a release is plausibly imminent.
  if (ageDays > maxUnreleasedDays) {
    return {
      ok: false,
      reason:
        `Release overdue: ${pendingChangesets} pending changeset(s) and ${shippedChanges} shipped ` +
        `file(s) have waited ${ageDays} days since the last release tag (limit ${maxUnreleasedDays}). ` +
        'Merged fixes are not on npm. Cut a release PR — a pending changeset stops excusing this.',
      ageDays,
    };
  }

  return {
    ok: true,
    reason:
      `Shipped content changed, but ${pendingChangesets} pending changeset(s) were detected and the ` +
      `last release was ${ageDays} day(s) ago (limit ${maxUnreleasedDays}). Release-audited.`,
    ageDays,
  };
}

function readInt(name, fallback = null) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (fallback !== null) return fallback;
    throw new Error(`Missing required env ${name}`);
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} is not an integer: ${raw}`);
  return n;
}

function main() {
  const verdict = evaluateReleaseWindow({
    shippedChanges: readInt('SHIPPED_CHANGES'),
    pendingChangesets: readInt('PENDING_CHANGESETS'),
    lastTagTimestamp: readInt('LAST_TAG_TIMESTAMP'),
    nowTimestamp: readInt('NOW_TIMESTAMP'),
    maxUnreleasedDays: readInt('MAX_UNRELEASED_DAYS', DEFAULT_MAX_UNRELEASED_DAYS),
  });

  if (verdict.ok) {
    console.log(`::notice::${verdict.reason}`);
    return 0;
  }
  console.log(`::error::${verdict.reason}`);
  return 1;
}

// Path-based entrypoint check: SonarCloud S3403 flags `require.main === module` as an
// always-false equality under strict type inference (blocked PR #1115 on four scripts).
if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exit(main());
}

module.exports = { evaluateReleaseWindow, readInt, main, DEFAULT_MAX_UNRELEASED_DAYS };
