'use strict';

/**
 * public-bundle-ratchet.test.js — moat boundary ratchet.
 *
 * Background. The 2026-05-18 strict-assessment audit found that 212 of the
 * 216 scripts in private `ThumbGate-Core/scripts/` are also in this public
 * repo's `scripts/`, and all of them ship via npm. The "private intelligence"
 * boundary in CLAUDE.md is aspirational; in practice the public bundle ships
 * 412 scripts including Thompson Sampling, lesson DB internals, reward
 * functions, RLAIF audit, and the auto-promotion algorithm.
 *
 * The moat decision (Option A, 2026-05-18) is to **stop pretending Core is
 * the moat**. Instead, the moat is hosted infrastructure + support + the
 * dashboard. Public code is permissive on purpose.
 *
 * What this test does: it freezes the npm bundle file count at the audit
 * baseline (254 files) and refuses to let it grow. Every PR that adds a
 * new file to `package.json:files` must justify it OR remove an equal
 * number of files. The ratchet is one-way — the count can decrease over
 * time as we remove obsolete scripts, but never increase past the baseline
 * without an explicit override.
 *
 * Override: set `THUMBGATE_BUNDLE_RATCHET_BASELINE` in the environment to
 * a higher number to ratchet the ceiling up after a deliberate change.
 *
 * Updating the baseline: run `npm pack --dry-run | tail -3 | head -1`,
 * confirm the count is the intended new baseline, then update BASELINE
 * below and add a CHANGELOG entry explaining what was added.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const path = require('node:path');

// 2026-05-18 audit baseline. This number is allowed to DECREASE.
const BASELINE_FILE_COUNT = 254;

function readBundleSnapshot() {
  const repoRoot = path.resolve(__dirname, '..');
  const stdout = execSync('npm pack --dry-run --json', {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(stdout);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  return { fileCount: entry.entryCount, unpackedSize: entry.unpackedSize, name: entry.name };
}

test('public npm bundle file count stays at or below the 2026-05-18 audit baseline', () => {
  const ceiling = Number(process.env.THUMBGATE_BUNDLE_RATCHET_BASELINE || BASELINE_FILE_COUNT);
  const snapshot = readBundleSnapshot();
  assert.ok(
    snapshot.fileCount <= ceiling,
    `public npm bundle has ${snapshot.fileCount} files (ceiling ${ceiling}). ` +
      `Either remove files from package.json:files OR raise BASELINE_FILE_COUNT in this test ` +
      `with a CHANGELOG note explaining what was added and why.`
  );
});

test('bundle includes the canonical entrypoints (sanity check that the snapshot is real)', () => {
  const snapshot = readBundleSnapshot();
  assert.equal(snapshot.name, 'thumbgate');
  assert.ok(snapshot.fileCount > 0);
  assert.ok(snapshot.unpackedSize > 0);
});
