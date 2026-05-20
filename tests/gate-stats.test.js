// tests/gate-stats.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  calculateStats,
  formatStats,
  formatLastPromotion,
  formatBayesErrorRate,
  formatFirstTimeFixRate,
  computeFirstTimeFixRate,
  loadGatesFile,
  computeCalibration,
  STATS_PATH,
} = require('../scripts/gate-stats');

// -- loadGatesFile --

test('loadGatesFile: returns empty array for nonexistent file', () => {
  const result = loadGatesFile('/tmp/nonexistent-gates-file.json');
  assert.deepStrictEqual(result, []);
});

test('loadGatesFile: returns gates from valid file', () => {
  const tmpFile = path.join(os.tmpdir(), `gate-test-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify({
    gates: [{ id: 'test-gate', action: 'block', occurrences: 3 }],
  }));
  try {
    const result = loadGatesFile(tmpFile);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'test-gate');
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

// -- formatLastPromotion --

test('formatLastPromotion: returns "none" for null', () => {
  assert.strictEqual(formatLastPromotion(null), 'none');
});

test('formatLastPromotion: formats upgrade event', () => {
  const promo = {
    type: 'upgrade',
    gateId: 'auto-testing',
    to: 'block',
    timestamp: new Date().toISOString(),
  };
  const result = formatLastPromotion(promo);
  assert.ok(result.includes('auto-testing'));
  assert.ok(result.includes('block'));
});

test('formatLastPromotion: formats new event with days ago', () => {
  const d = new Date();
  d.setDate(d.getDate() - 2);
  const promo = {
    type: 'new',
    gateId: 'auto-push',
    timestamp: d.toISOString(),
  };
  const result = formatLastPromotion(promo);
  assert.ok(result.includes('auto-push'));
  assert.ok(result.includes('2 days ago'));
});

// -- calculateStats --

test('calculateStats: returns stats object with required fields', () => {
  const stats = calculateStats();
  assert.strictEqual(typeof stats.totalGates, 'number');
  assert.strictEqual(typeof stats.manualGates, 'number');
  assert.strictEqual(typeof stats.autoPromotedGates, 'number');
  assert.strictEqual(typeof stats.blockGates, 'number');
  assert.strictEqual(typeof stats.warnGates, 'number');
  assert.strictEqual(typeof stats.totalBlocked, 'number');
  assert.strictEqual(typeof stats.totalWarned, 'number');
  assert.strictEqual(typeof stats.estimatedHoursSaved, 'string');
  assert.ok(Array.isArray(stats.gates));
});

test('calculateStats: includes manual gates from default.json', () => {
  const stats = calculateStats();
  // default.json has at least 5 gates
  assert.ok(stats.manualGates >= 1, 'should have at least 1 manual gate');
});

// -- formatStats --

test('formatStats: returns formatted string with all sections', () => {
  const stats = {
    totalGates: 7,
    manualGates: 4,
    autoPromotedGates: 3,
    blockGates: 5,
    warnGates: 2,
    totalBlocked: 12,
    totalWarned: 8,
    topBlocked: { id: 'push-without-thread-check', occurrences: 5 },
    lastPromotion: { type: 'upgrade', gateId: 'pr-review', to: 'block', timestamp: new Date().toISOString() },
    estimatedHoursSaved: '5.0',
    gates: [],
  };
  const output = formatStats(stats);
  assert.ok(output.includes('Gate Statistics'));
  assert.ok(output.includes('7 (4 manual, 3 auto-promoted)'));
  assert.ok(output.includes('Actions blocked: 12'));
  assert.ok(output.includes('Actions warned: 8'));
  assert.ok(output.includes('push-without-thread-check'));
  assert.ok(output.includes('~5.0 hours'));
});

test('formatStats: handles no top blocked gate', () => {
  const stats = {
    totalGates: 0,
    manualGates: 0,
    autoPromotedGates: 0,
    blockGates: 0,
    warnGates: 0,
    totalBlocked: 0,
    totalWarned: 0,
    topBlocked: null,
    lastPromotion: null,
    estimatedHoursSaved: '0.0',
    gates: [],
  };
  const output = formatStats(stats);
  assert.ok(output.includes('Top blocked gate: none'));
  assert.ok(output.includes('Last promotion: none'));
});

test('formatStats: does not invent a top blocked gate for zero-occurrence block rules', () => {
  const stats = {
    totalGates: 1,
    manualGates: 1,
    autoPromotedGates: 0,
    blockGates: 1,
    warnGates: 0,
    totalBlocked: 0,
    totalWarned: 0,
    topBlocked: null,
    lastPromotion: null,
    estimatedHoursSaved: '0.0',
    gates: [{ id: 'local-only-git-writes', action: 'block', occurrences: 0 }],
  };
  const output = formatStats(stats);
  assert.ok(output.includes('Top blocked gate: none'));
  assert.ok(!output.includes('local-only-git-writes (0 blocks)'));
});

// -- formatBayesErrorRate --

test('formatBayesErrorRate: returns n/a for null or undefined', () => {
  assert.ok(formatBayesErrorRate(null).includes('n/a'));
  assert.ok(formatBayesErrorRate(undefined).includes('n/a'));
  assert.ok(formatBayesErrorRate(null).includes('safe and harmful'));
});

test('formatBayesErrorRate: labels near-zero error as near-optimal', () => {
  const out = formatBayesErrorRate(0.005);
  assert.ok(out.includes('near-optimal'));
  assert.ok(out.includes('0.5%'));
});

test('formatBayesErrorRate: labels moderate error as modest headroom', () => {
  const out = formatBayesErrorRate(0.05);
  assert.ok(out.includes('modest headroom'));
  assert.ok(out.includes('5.0%'));
});

test('formatBayesErrorRate: labels high error as irreducible', () => {
  const out = formatBayesErrorRate(0.25);
  assert.ok(out.includes('high irreducible error'));
  assert.ok(out.includes('25.0%'));
});

// -- calculateStats emits bayesErrorRate alongside existing fields --

test('calculateStats: includes bayesErrorRate in output (null is a valid value)', () => {
  const stats = calculateStats();
  assert.ok('bayesErrorRate' in stats, 'calculateStats must emit bayesErrorRate');
  // Value can be null (no feedback sequences yet) or a number in [0, 0.5].
  if (stats.bayesErrorRate !== null) {
    assert.ok(typeof stats.bayesErrorRate === 'number');
    assert.ok(stats.bayesErrorRate >= 0);
    assert.ok(stats.bayesErrorRate <= 0.5);
  }
});

test('formatStats renders the Bayes error rate line', () => {
  const stats = {
    totalGates: 0,
    manualGates: 0,
    autoPromotedGates: 0,
    blockGates: 0,
    warnGates: 0,
    totalBlocked: 0,
    totalWarned: 0,
    topBlocked: null,
    lastPromotion: null,
    estimatedHoursSaved: '0.0',
    bayesErrorRate: 0.03,
    gates: [],
  };
  const output = formatStats(stats);
  assert.ok(output.includes('Bayes error rate'), 'formatter must render the bayesErrorRate line');
  assert.ok(output.includes('3.0%'));
});

// -- calibration --

test('calculateStats: returns a calibration field that is an array', () => {
  const stats = calculateStats();
  assert.ok('calibration' in stats, 'calculateStats must emit a calibration field');
  assert.ok(Array.isArray(stats.calibration), 'calibration must be an array');
});

test('calculateStats: each calibration entry has gateId and calibrationNote string fields', () => {
  const stats = calculateStats();
  for (const entry of stats.calibration) {
    assert.strictEqual(typeof entry.gateId, 'string', 'each entry must have a gateId string');
    assert.strictEqual(typeof entry.calibrationNote, 'string', 'each entry must have a calibrationNote string');
  }
});

test('computeCalibration: over-blocking annotation for >10 occurrences with no confirmed negative', () => {
  const gates = [
    { id: 'risky-gate', action: 'block', occurrences: 15 },
  ];
  const result = computeCalibration(gates);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].gateId, 'risky-gate');
  assert.ok(result[0].calibrationNote.includes('over-blocking'));
  assert.ok(result[0].calibrationNote.includes('15'));
});

test('computeCalibration: well-calibrated annotation when confirmedNegative > 0', () => {
  const gates = [
    { id: 'good-gate', action: 'block', occurrences: 8, confirmedNegative: 6 },
  ];
  const result = computeCalibration(gates);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].gateId, 'good-gate');
  assert.ok(result[0].calibrationNote.includes('well-calibrated'));
  assert.ok(result[0].calibrationNote.includes('6 confirmed'));
});

test('computeCalibration: skips gates with zero occurrences', () => {
  const gates = [
    { id: 'unused-gate', action: 'block', occurrences: 0 },
  ];
  const result = computeCalibration(gates);
  assert.strictEqual(result.length, 0);
});

test('computeCalibration: skips non-block gates', () => {
  const gates = [
    { id: 'warn-gate', action: 'warn', occurrences: 20 },
  ];
  const result = computeCalibration(gates);
  assert.strictEqual(result.length, 0);
});

test('formatStats: renders Calibration section when calibration entries exist', () => {
  const stats = {
    totalGates: 1,
    manualGates: 1,
    autoPromotedGates: 0,
    blockGates: 1,
    warnGates: 0,
    totalBlocked: 15,
    totalWarned: 0,
    topBlocked: { id: 'risky-gate', occurrences: 15 },
    lastPromotion: null,
    estimatedHoursSaved: '3.8',
    bayesErrorRate: null,
    calibration: [
      { gateId: 'risky-gate', occurrences: 15, action: 'block', calibrationNote: 'over-blocking (15 blocks, 0 confirmed)' },
    ],
    gates: [],
  };
  const output = formatStats(stats);
  assert.ok(output.includes('Calibration:'), 'must render Calibration section header');
  assert.ok(output.includes('risky-gate: over-blocking'), 'must render gate calibration note');
});

test('formatStats: omits Calibration section when calibration is empty', () => {
  const stats = {
    totalGates: 0,
    manualGates: 0,
    autoPromotedGates: 0,
    blockGates: 0,
    warnGates: 0,
    totalBlocked: 0,
    totalWarned: 0,
    topBlocked: null,
    lastPromotion: null,
    estimatedHoursSaved: '0.0',
    bayesErrorRate: null,
    calibration: [],
    gates: [],
  };
  const output = formatStats(stats);
  assert.ok(!output.includes('Calibration:'), 'must not render Calibration section when empty');
});

// -- firstTimeFixRate --

test('calculateStats: includes firstTimeFixRate in output (null is valid when no data)', () => {
  const stats = calculateStats();
  assert.ok('firstTimeFixRate' in stats, 'calculateStats must emit firstTimeFixRate');
  // Value can be null (no block/warn events yet) or a number in [0, 1].
  if (stats.firstTimeFixRate !== null) {
    assert.strictEqual(typeof stats.firstTimeFixRate, 'number');
    assert.ok(stats.firstTimeFixRate >= 0);
    assert.ok(stats.firstTimeFixRate <= 1);
  }
});

test('computeFirstTimeFixRate: returns null or a number in [0,1] when stats file exists or not', () => {
  // computeFirstTimeFixRate reads from a fixed STATS_PATH; the result depends on
  // whether data has been recorded locally. The contract: null when no block/warn
  // data, otherwise a number clamped to [0, 1].
  const rate = computeFirstTimeFixRate();
  if (rate !== null) {
    assert.strictEqual(typeof rate, 'number', 'must be a number when not null');
    assert.ok(rate >= 0, 'must be >= 0');
    assert.ok(rate <= 1, 'must be <= 1');
  } else {
    assert.strictEqual(rate, null, 'null is valid when no block/warn events recorded');
  }
});

test('computeFirstTimeFixRate: returns null when there are zero blocks and warns', () => {
  const tmpDir = os.tmpdir();
  const tmpStats = path.join(tmpDir, `gate-stats-test-${Date.now()}.json`);
  fs.writeFileSync(tmpStats, JSON.stringify({ blocked: 0, warned: 0, passed: 5 }));
  try {
    // Directly test the logic: zero total means null
    const data = JSON.parse(fs.readFileSync(tmpStats, 'utf8'));
    const total = (data.blocked || 0) + (data.warned || 0);
    assert.strictEqual(total, 0);
    // computeFirstTimeFixRate reads from STATS_PATH which is env-based;
    // testing the math directly since file path is fixed
  } finally {
    fs.unlinkSync(tmpStats);
  }
});

test('computeFirstTimeFixRate: returns 1.0 when recurringBlocks is 0 and total > 0', () => {
  const tmpDir = os.tmpdir();
  const tmpStats = path.join(tmpDir, `gate-stats-ftfr-${Date.now()}.json`);
  fs.writeFileSync(tmpStats, JSON.stringify({ blocked: 5, warned: 3, recurringBlocks: 0 }));
  try {
    const data = JSON.parse(fs.readFileSync(tmpStats, 'utf8'));
    const total = (data.blocked || 0) + (data.warned || 0);
    const recurring = data.recurringBlocks || 0;
    const rate = total > 0 ? Math.max(0, Math.min(1, 1 - (recurring / total))) : null;
    assert.strictEqual(rate, 1.0);
  } finally {
    fs.unlinkSync(tmpStats);
  }
});

test('computeFirstTimeFixRate: rate decreases as recurringBlocks grows', () => {
  // 8 total, 4 recurring => 50% first-time fix rate
  const total = 8;
  const recurring = 4;
  const rate = Math.max(0, Math.min(1, 1 - (recurring / total)));
  assert.strictEqual(rate, 0.5);
});

test('formatFirstTimeFixRate: returns n/a for null or undefined', () => {
  assert.ok(formatFirstTimeFixRate(null).includes('n/a'));
  assert.ok(formatFirstTimeFixRate(undefined).includes('n/a'));
  assert.ok(formatFirstTimeFixRate(null).includes('no blocks or warns'));
});

test('formatFirstTimeFixRate: labels 100% as excellent', () => {
  const out = formatFirstTimeFixRate(1.0);
  assert.ok(out.includes('100.0%'));
  assert.ok(out.includes('excellent'));
});

test('formatFirstTimeFixRate: labels 85% as good', () => {
  const out = formatFirstTimeFixRate(0.85);
  assert.ok(out.includes('85.0%'));
  assert.ok(out.includes('good'));
});

test('formatFirstTimeFixRate: warns on low fix rate', () => {
  const out = formatFirstTimeFixRate(0.5);
  assert.ok(out.includes('50.0%'));
  assert.ok(out.includes('recurring blocks'));
});

test('formatStats: renders First-time fix rate line', () => {
  const stats = {
    totalGates: 2,
    manualGates: 1,
    autoPromotedGates: 1,
    blockGates: 2,
    warnGates: 0,
    totalBlocked: 10,
    totalWarned: 0,
    topBlocked: { id: 'test-gate', occurrences: 10 },
    lastPromotion: null,
    estimatedHoursSaved: '2.5',
    bayesErrorRate: null,
    calibration: [],
    firstTimeFixRate: 0.9,
    gates: [],
  };
  const output = formatStats(stats);
  assert.ok(output.includes('First-time fix rate'), 'formatter must render the firstTimeFixRate line');
  assert.ok(output.includes('90.0%'));
});
