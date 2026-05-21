'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildReport, renderHuman, parseArgs, readGateStats } =
  require('../scripts/cost-cli');

function makeTempStatsFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cost-test-'));
  const filepath = path.join(dir, 'gate-stats.json');
  if (contents !== null) {
    fs.writeFileSync(filepath, JSON.stringify(contents));
  }
  return filepath;
}

test('parseArgs recognizes --json, --stats, --mix', () => {
  const a = parseArgs(['--json', '--stats', '/tmp/foo.json', '--mix', '{"x":1}']);
  assert.equal(a.json, true);
  assert.equal(a.statsPath, '/tmp/foo.json');
  assert.deepEqual(a.modelMix, { x: 1 });
});

test('parseArgs --mix with bad JSON falls back to undefined (does not throw)', () => {
  const a = parseArgs(['--mix', 'not-json']);
  assert.equal(a.modelMix, undefined);
});

test('readGateStats returns null when file missing', () => {
  const missing = path.join(os.tmpdir(), `tg-no-${Date.now()}.json`);
  assert.equal(readGateStats(missing), null);
});

test('readGateStats returns parsed object when file present', () => {
  const p = makeTempStatsFile({ blocked: 5, byGate: { 'no-mock': { blocked: 3 } } });
  const stats = readGateStats(p);
  assert.ok(stats);
  assert.equal(stats.blocked, 5);
});

test('buildReport returns zero-savings shape when no stats file exists', () => {
  const missing = path.join(os.tmpdir(), `tg-missing-${Date.now()}.json`);
  const r = buildReport({ statsPath: missing });
  assert.equal(r.statsExists, false);
  assert.equal(r.blocked, 0);
  assert.equal(r.savings.tokensSavedTotal, 0);
  assert.equal(r.savings.dollarsSaved, 0);
});

test('buildReport computes savings from real stats file', () => {
  const p = makeTempStatsFile({
    blocked: 100,
    warned: 5,
    passed: 200,
    byGate: { 'no-mocked-db': { blocked: 60 }, 'force-push-guard': { blocked: 40 } },
  });
  const r = buildReport({ statsPath: p });
  assert.equal(r.statsExists, true);
  assert.equal(r.blocked, 100);
  assert.equal(r.warned, 5);
  assert.equal(r.passed, 200);
  assert.deepEqual(r.topGate, { id: 'no-mocked-db', blocked: 60 });
  // 100 blocked × (2000 in + 600 out) = 260K tokens
  assert.ok(r.savings.tokensSavedTotal >= 250_000, 'should surface ~260K tokens saved');
  assert.ok(r.savings.dollarsSaved > 0, 'should compute a positive dollar amount');
});

test('renderHuman includes the dollar amount, real token counts, and the methodology footer', () => {
  const p = makeTempStatsFile({ blocked: 42, byGate: {} });
  const r = buildReport({ statsPath: p });
  const out = renderHuman(r);
  assert.match(out, /Tool calls blocked\s*:\s*42/);
  assert.match(out, /Input\s*:\s*\S+/);
  // 42 blocked × 600 out = 25.2K — must NOT render as "0"
  assert.doesNotMatch(out, /Total\s*:\s*0\b/, 'total tokens must not be zero when blocks > 0');
  assert.match(out, /\$[\d.]+/, 'output contains a dollar amount');
  assert.match(out, /Methodology/);
});

test('renderHuman shows a friendly no-stats message when gate-stats.json missing', () => {
  const missing = path.join(os.tmpdir(), `tg-render-missing-${Date.now()}.json`);
  const r = buildReport({ statsPath: missing });
  const out = renderHuman(r);
  assert.match(out, /No gate-stats\.json yet/);
  assert.doesNotMatch(out, /Estimated \$ saved/);
});

test('top blocker is null when byGate is empty', () => {
  const p = makeTempStatsFile({ blocked: 0, byGate: {} });
  const r = buildReport({ statsPath: p });
  assert.equal(r.topGate, null);
});

test('top blocker prefers the gate with the highest blocked count', () => {
  const p = makeTempStatsFile({
    blocked: 50,
    byGate: { 'a': { blocked: 10 }, 'b': { blocked: 30 }, 'c': { blocked: 5 } },
  });
  const r = buildReport({ statsPath: p });
  assert.equal(r.topGate.id, 'b');
  assert.equal(r.topGate.blocked, 30);
});
