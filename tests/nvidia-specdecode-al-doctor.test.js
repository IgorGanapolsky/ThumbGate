'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  optimalDraftLengthForAttention,
  isTileAligned,
  nearestTileAlignedDraftLength,
  draftOverhead,
  theoreticalSpeedup,
  shouldIncreaseDraftLength,
  recommendDraftMechanism,
  normalizeOptions,
  buildNvidiaSpecDecodeAlDoctorReport,
  formatNvidiaSpecDecodeAlDoctorReport,
} = require('../scripts/nvidia-specdecode-al-doctor');

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');
const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'nvidia-specdecode-al-doctor.js');

test('optimalDraftLengthForAttention follows D = 128/G - 1', () => {
  assert.equal(optimalDraftLengthForAttention(8), 15);
  assert.equal(optimalDraftLengthForAttention(32), 3);
  assert.equal(optimalDraftLengthForAttention(0), null);
});

test('tile alignment checks G × (1 + D) multiples of 128', () => {
  assert.equal(isTileAligned(8, 15), true); // 8*16 = 128
  assert.equal(isTileAligned(8, 14), false);
  assert.equal(nearestTileAlignedDraftLength(8, 14), 15);
});

test('theoreticalSpeedup uses AL/(1+ρD)', () => {
  assert.equal(theoreticalSpeedup(6, 9, 0), 6);
  // 6 / (1 + 0.1*9) = 6 / 1.9 ≈ 3.1579
  assert.equal(theoreticalSpeedup(6, 9, 0.1), 3.1579);
  assert.equal(theoreticalSpeedup(null, 9, 0), null);
});

test('draftOverhead is ρD', () => {
  assert.equal(draftOverhead(0.05, 11), 0.55);
});

test('shouldIncreaseDraftLength rejects AL gains that lose speedup', () => {
  const decision = shouldIncreaseDraftLength({
    acceptLength: 5,
    draftLength: 7,
    draftDepthRatio: 0.1,
    nextAcceptLength: 5.2,
    nextDraftLength: 14,
  });
  assert.equal(decision.increase, false);
  assert.ok(decision.nextSpeedup < decision.currentSpeedup);
});

test('recommendDraftMechanism prefers suffix-ngram for repetitive agent loops', () => {
  const rec = recommendDraftMechanism({ workload: 'tool-loop', repetitive: true });
  assert.equal(rec.mechanism, 'suffix-ngram');
  assert.equal(rec.draftDepthRatioHint, 0);
});

test('normalizeOptions derives G from query/kv heads', () => {
  const options = normalizeOptions({
    'query-heads': '32',
    'kv-heads': '8',
    'accept-length': '1.4',
    'draft-length': '7',
    'speculative-decoding': true,
  });
  assert.equal(options.queryHeadsPerKvHead, 4);
  assert.equal(options.acceptLength, 1.4);
  assert.equal(options.draftLength, 7);
  assert.equal(options.speculativeDecoding, true);
});

test('doctor fails closed when AL missing under speculation', () => {
  const report = buildNvidiaSpecDecodeAlDoctorReport({
    'speculative-decoding': true,
    'draft-length': '7',
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'accept_length_missing'));
  assert.ok(report.recommendedGates.includes('checkpoint-speculative-decoding-acceptance'));
});

test('doctor rejects claimed speedup above AL/(1+ρD)', () => {
  const report = buildNvidiaSpecDecodeAlDoctorReport({
    'speculative-decoding': true,
    'accept-length': '1.4',
    'draft-length': '7',
    'draft-depth-ratio': '0.05',
    'claimed-speedup': '5',
    'cache-coherence-eval': true,
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'claimed_speedup_over_theory'));
  assert.ok(report.metrics.theoreticalSpeedup < 5);
});

test('doctor is ready when AL evidence clears the floor and claim fits theory', () => {
  const report = buildNvidiaSpecDecodeAlDoctorReport({
    'speculative-decoding': true,
    'accept-length': '4',
    'draft-length': '7',
    'draft-depth-ratio': '0.05',
    'claimed-speedup': '2.5',
    'cache-coherence-eval': true,
    'query-heads-per-kv': '8',
    'attention-dominated': true,
  });
  assert.equal(report.status, 'ready');
  assert.equal(report.summary.failCount, 0);
  assert.match(formatNvidiaSpecDecodeAlDoctorReport(report), /AL\/\(1\+ρD\)/);
});

test('script CLI emits JSON and exits 1 on fail', () => {
  const fail = spawnSync(process.execPath, [
    SCRIPT,
    '--speculative-decoding',
    '--draft-length=7',
    '--json',
  ], { encoding: 'utf8' });
  assert.equal(fail.status, 1, fail.stderr);
  const payload = JSON.parse(fail.stdout);
  assert.equal(payload.name, 'thumbgate-nvidia-specdecode-al-doctor');
  assert.equal(payload.status, 'fail');
});

test('thumbgate CLI nvidia-specdecode-al-doctor is wired', () => {
  const result = spawnSync(process.execPath, [
    CLI,
    'nvidia-specdecode-al-doctor',
    '--speculative-decoding',
    '--accept-length=4',
    '--draft-length=7',
    '--draft-depth-ratio=0.05',
    '--claimed-speedup=2',
    '--cache-coherence-eval',
    '--json',
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-nvidia-specdecode-al-doctor');
  assert.equal(payload.status, 'ready');
});
