'use strict';

// Double-blind holdout seal tests (scripts/eval-holdout.js).
//
// Pattern stolen from Google DeepMind's first double-blind evaluation (2026):
// holdout questions are sealed as hashes so the tuning loop never sees them, and
// only aggregate ("permitted") results leave verification. These tests defend the
// three properties that make the seal real: deterministic partitioning, zero
// question leakage into the manifest, and tamper detection.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let workDir;
let holdout;

test.before(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-holdout-test-'));
  const goldenPath = path.join(workDir, 'golden.jsonl');
  const rows = [];
  for (let i = 0; i < 30; i += 1) {
    rows.push(JSON.stringify({
      toolName: 'Bash',
      command: `git push origin feature/holdout-case-${i} --no-verify && echo sentinel-${i}`,
      expect: { gateId: `gate-${i % 6}`, decision: 'deny' },
      source: 'holdout-test-fixture',
      observed: 1,
    }));
  }
  fs.writeFileSync(goldenPath, `${rows.join('\n')}\n`);

  process.env.THUMBGATE_EVAL_GOLDEN = goldenPath;
  process.env.THUMBGATE_EVAL_HOLDOUT = path.join(workDir, 'holdout.json');
  // The script resolves paths at load time, so require it fresh under the env above.
  delete require.cache[require.resolve('../scripts/eval-holdout.js')];
  holdout = require('../scripts/eval-holdout.js');
});

test.after(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
  delete process.env.THUMBGATE_EVAL_GOLDEN;
  delete process.env.THUMBGATE_EVAL_HOLDOUT;
});

test('partition is deterministic: same cases, same holdout, every time', () => {
  const cases = holdout.loadGolden();
  const first = holdout.partition(cases).holdout.map((c) => c.caseHash).sort();
  const second = holdout.partition(holdout.loadGolden()).holdout.map((c) => c.caseHash).sort();
  assert.deepEqual(second, first, 'partition must be reproducible across runs');
  assert.ok(first.length > 0, 'fixture must produce a non-empty holdout');
  assert.ok(first.length < cases.length, 'holdout must not consume the whole set');

  // The hash is a pure function of the case identity — no RNG, no clock.
  const c = cases[0];
  assert.equal(holdout.caseHash(c.toolName, c.command), holdout.caseHash(c.toolName, c.command));
  assert.notEqual(
    holdout.caseHash(c.toolName, c.command),
    holdout.caseHash(c.toolName, `${c.command} `),
    'distinct commands must hash apart',
  );
});

test('freeze writes a manifest that leaks no question text', async () => {
  const exit = await holdout.freeze();
  assert.equal(exit, 0);

  const raw = fs.readFileSync(holdout.HOLDOUT_MANIFEST, 'utf8');
  const manifest = JSON.parse(raw);
  assert.equal(manifest.goldenCases, 30);
  assert.equal(manifest.holdoutCases, manifest.holdout.length);
  assert.ok(manifest.contentHash, 'manifest must carry its content hash');

  // Blind 1: the sealed slice is hashes + verdicts only.
  for (const entry of manifest.holdout) {
    assert.match(entry.caseHash, /^[0-9a-f]{64}$/, 'holdout entries carry sha256 hashes only');
    assert.ok(typeof entry.sealedVerdict === 'string');
  }
  // No raw command survives into the manifest (probe the first 40 chars of each).
  for (const c of holdout.loadGolden()) {
    const probe = c.command.slice(0, 40);
    assert.ok(!raw.includes(probe), `raw question leaked into manifest: ${probe}`);
  }
});

test('check passes on an intact seal', () => {
  assert.equal(holdout.check(), 0);
});

test('check breaks when the manifest is edited after sealing', () => {
  const original = fs.readFileSync(holdout.HOLDOUT_MANIFEST, 'utf8');
  try {
    const manifest = JSON.parse(original);
    manifest.holdout[0].sealedVerdict = manifest.holdout[0].sealedVerdict === 'deny' ? 'approve' : 'deny';
    fs.writeFileSync(holdout.HOLDOUT_MANIFEST, JSON.stringify(manifest, null, 2));
    assert.equal(holdout.check(), 1, 'tampered verdict must break the seal');
  } finally {
    fs.writeFileSync(holdout.HOLDOUT_MANIFEST, original);
  }
});

test('check breaks when a case is smuggled out of the golden set', () => {
  const originalGolden = fs.readFileSync(holdout.GOLDEN, 'utf8');
  try {
    const lines = originalGolden.split('\n').filter(Boolean);
    fs.writeFileSync(holdout.GOLDEN, `${lines.slice(1).join('\n')}\n`);
    assert.equal(holdout.check(), 1, 'removing a golden case must break the seal');
  } finally {
    fs.writeFileSync(holdout.GOLDEN, originalGolden);
  }
});

test('verify replays the holdout and reports only the aggregate', async () => {
  const exit = await holdout.verify();
  assert.equal(exit, 0, 'freshly sealed holdout must verify clean');
});

test('verify fails when sealed verdicts are forged', async () => {
  const original = fs.readFileSync(holdout.HOLDOUT_MANIFEST, 'utf8');
  try {
    const manifest = JSON.parse(original);
    manifest.holdout[0].sealedVerdict = manifest.holdout[0].sealedVerdict === 'deny' ? 'approve' : 'deny';
    fs.writeFileSync(holdout.HOLDOUT_MANIFEST, JSON.stringify(manifest, null, 2));
    assert.equal(await holdout.verify(), 1, 'forged sealed verdict must fail verification');
  } finally {
    fs.writeFileSync(holdout.HOLDOUT_MANIFEST, original);
  }
});
