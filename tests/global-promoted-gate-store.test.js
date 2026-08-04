'use strict';

// A gate promoted from a failure in one repository must deny the same action in
// every repository. Before this cover, the promoted-gate store resolved to exactly
// ONE location — repo-local when present, otherwise a per-project directory under
// the home directory — so gates learned in repo A were invisible in repo B.
//
// Measured 2026-08-04 on one machine, same engine, same moment, only cwd differing:
//   cwd=ThumbGate -> 45 promoted gates
//   cwd=Resume    ->  4 promoted gates
// The 41 missing gates included every one promoted from an outbound-send failure,
// and an agent then sent outbound mail from the repository that could not see them.
//
// The subtle part, and the reason the first fix was a no-op: resolveFeedbackDir()
// is ITSELF cwd-dependent. A "global" path derived from it resolves to the same
// place as the repo-local one, so the union collapses to a single entry and nothing
// changes. The global path must be built from the home directory directly.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  getAutoGatesPath,
  getGlobalAutoGatesPath,
  getAutoGatesPaths,
} = require('../scripts/auto-promote-gates.js');

function inCwd(dir, fn) {
  const prev = process.cwd();
  try {
    process.chdir(dir);
    return fn();
  } finally {
    process.chdir(prev);
  }
}

test('the global store path does not depend on the working directory', () => {
  const a = inCwd(os.tmpdir(), getGlobalAutoGatesPath);
  const b = inCwd(path.join(__dirname, '..'), getGlobalAutoGatesPath);
  assert.equal(a, b, 'global store must resolve identically from any cwd');
  assert.ok(
    a.startsWith(os.homedir()),
    `global store must live under the home directory, got ${a}`,
  );
});

test('the global store is not merely the per-repo store under another name', () => {
  // The defect that made the first fix a no-op: if the "global" resolver is
  // cwd-sensitive it returns the repo-local path and the union has one entry.
  const repoRoot = path.join(__dirname, '..');
  const collapsed = inCwd(repoRoot, () => getGlobalAutoGatesPath() === getAutoGatesPath());
  assert.equal(collapsed, false, 'global and repo-local store paths must be distinct');
});

test('the union includes the global store from every working directory', () => {
  for (const dir of [os.tmpdir(), path.join(__dirname, '..'), __dirname]) {
    const paths = inCwd(dir, getAutoGatesPaths);
    const globalPath = inCwd(dir, getGlobalAutoGatesPath);
    assert.ok(
      paths.includes(globalPath),
      `union from ${dir} must include the global store`,
    );
  }
});

test('the union is deduplicated', () => {
  const paths = inCwd(path.join(__dirname, '..'), getAutoGatesPaths);
  assert.equal(new Set(paths).size, paths.length, 'union must not repeat a store path');
});

test('the union never shrinks below the single store it replaced', () => {
  for (const dir of [os.tmpdir(), path.join(__dirname, '..')]) {
    const union = inCwd(dir, getAutoGatesPaths);
    const single = inCwd(dir, getAutoGatesPath);
    assert.ok(union.length >= 1, `union from ${dir} must not be empty`);
    if (fs.existsSync(single)) {
      assert.ok(
        union.includes(path.resolve(single)),
        `union from ${dir} must still include the previously-resolved store`,
      );
    }
  }
});

test('promoted-gate reach does not vary by working directory', () => {
  // The end-to-end invariant. Gates carried by the shared stores must be present
  // regardless of cwd; a repository may add its own on top, never see fewer.
  const { loadGatesConfig } = require('../scripts/gates-engine.js');
  const promotedIds = (dir) => inCwd(dir, () => new Set(
    loadGatesConfig().gates
      .filter((g) => g.promotedAt || g.source === 'auto-promote' || g.source === 'force-promote')
      .map((g) => g.id),
  ));

  const fromTmp = promotedIds(os.tmpdir());
  const fromRepo = promotedIds(path.join(__dirname, '..'));

  const missing = [...fromTmp].filter((id) => !fromRepo.has(id));
  assert.deepEqual(
    missing,
    [],
    'a repository must never see FEWER shared promoted gates than an unrelated directory',
  );
});
