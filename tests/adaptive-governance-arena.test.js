'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  DEFAULT_ARENA_PATH,
  buildDpoCandidates,
  evaluatePolicy,
  loadArena,
  replayArena,
  runArenaPass,
  summarize,
  verifyReceiptChain,
} = require('../scripts/adaptive-governance-arena');

test('adaptive arena loads monotonically increasing difficulty and unique scenarios', () => {
  const arena = loadArena(DEFAULT_ARENA_PATH);
  const difficulties = arena.levels.map((level) => level.difficulty);
  const scenarioIds = arena.levels.flatMap((level) => level.scenarios.map((scenario) => scenario.id));

  assert.deepEqual(difficulties, [1, 2, 3, 4]);
  assert.equal(scenarioIds.length, 11);
  assert.equal(new Set(scenarioIds).size, 11);
});

test('default adaptive arena passes all progressive governance levels', () => {
  const arena = loadArena(DEFAULT_ARENA_PATH);
  const report = runArenaPass(arena);
  const metrics = summarize(report);

  assert.equal(report.passed, true);
  assert.equal(report.highestPassedDifficulty, 4);
  assert.equal(metrics.scenarioCount, 11);
  assert.equal(metrics.passedScenarioCount, 11);
  assert.equal(metrics.passRate, 1);
  assert.equal(metrics.receiptChainValid, true);
});

test('adaptive policy enforces highest-ROI governance boundaries', () => {
  const arena = loadArena(DEFAULT_ARENA_PATH);
  const scenarios = Object.fromEntries(
    arena.levels.flatMap((level) => level.scenarios).map((scenario) => [scenario.id, scenario]),
  );

  assert.equal(evaluatePolicy(scenarios['budget-overrun']).action, 'deny');
  assert.equal(evaluatePolicy(scenarios['unapproved-dynamic-tool']).action, 'deny');
  assert.equal(evaluatePolicy(scenarios['sensitive-cloud-route']).action, 'deny');
  assert.equal(evaluatePolicy(scenarios['unsupported-completion-claim']).action, 'deny');
  assert.equal(evaluatePolicy(scenarios['benchmark-without-holdout']).action, 'review');
  assert.equal(evaluatePolicy(scenarios['live-market-transition']).action, 'deny');
  assert.equal(evaluatePolicy(scenarios['credential-owner-separation']).action, 'deny');
  assert.equal(evaluatePolicy(scenarios['irreversible-without-receipt']).action, 'review');
  assert.equal(evaluatePolicy(scenarios['approved-local-tool']).action, 'allow');
});

test('arena replay is deterministic and receipt chain detects tampering', () => {
  const arena = loadArena(DEFAULT_ARENA_PATH);
  const replay = replayArena(arena);

  assert.equal(replay.stable, true);
  assert.equal(verifyReceiptChain(replay.first), true);

  const tampered = structuredClone(replay.first);
  tampered.receipts[0].actualAction = 'review';
  assert.equal(verifyReceiptChain(tampered), false);
});

test('curriculum locks harder levels after a failed level', () => {
  const arena = loadArena(DEFAULT_ARENA_PATH);
  arena.levels[0].scenarios[0].expectedAction = 'deny';
  const report = runArenaPass(arena);

  assert.equal(report.levels[0].status, 'failed');
  assert.ok(report.levels.slice(1).every((level) => level.status === 'locked'));
  assert.equal(report.highestPassedDifficulty, 0);
});

test('failed attempts produce receipt-linked DPO candidates', () => {
  const arena = loadArena(DEFAULT_ARENA_PATH);
  const scenario = arena.levels[0].scenarios[0];
  scenario.expectedAction = 'deny';
  scenario.preferredResponse = 'Deny until the synthetic-data evidence is attached.';
  scenario.rejectedResponse = 'Proceed without checking the evidence.';
  const report = runArenaPass(arena);
  const pairs = buildDpoCandidates(report, arena);

  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].chosen, scenario.preferredResponse);
  assert.equal(pairs[0].rejected, scenario.rejectedResponse);
  assert.match(pairs[0].metadata.receiptHash, /^[a-f0-9]{64}$/);
});

test('arena schema rejects non-monotonic difficulty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-arena-schema-'));
  const fixturePath = path.join(dir, 'arena.json');
  try {
    fs.writeFileSync(fixturePath, JSON.stringify({
      levels: [
        { id: 'one', difficulty: 2, scenarios: [{ id: 'a', expectedAction: 'allow', context: {} }] },
        { id: 'two', difficulty: 2, scenarios: [{ id: 'b', expectedAction: 'allow', context: {} }] },
      ],
    }));
    assert.throws(() => loadArena(fixturePath), /difficulty must increase monotonically/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('arena CLI emits machine-readable deterministic evidence', () => {
  const stdout = execFileSync(process.execPath, ['scripts/adaptive-governance-arena.js', '--json'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });
  const report = JSON.parse(stdout);

  assert.equal(report.passed, true);
  assert.equal(report.replayStable, true);
  assert.equal(report.metrics.receiptChainValid, true);
  assert.equal(report.metrics.highestPassedDifficulty, 4);
});
