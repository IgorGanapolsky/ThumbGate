const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-session-report-test-'));
const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-session-report-proof-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
process.env.THUMBGATE_PROOF_DIR = tmpProofDir;
process.env.THUMBGATE_NO_RATE_LIMIT = '1';

const {
  buildSessionReport,
  normalizeWindowHours,
  topNegativeTags,
  topGates,
  summarizeProvenance,
  DEFAULT_WINDOW_HOURS,
  MIN_WINDOW_HOURS,
  MAX_WINDOW_HOURS,
} = require('../scripts/session-report');

test('buildSessionReport returns the expected top-level shape', () => {
  const report = buildSessionReport();
  assert.ok(report.generatedAt, 'generatedAt must be set');
  assert.ok(report.since, 'since timestamp must be set');
  assert.equal(report.windowHours, DEFAULT_WINDOW_HOURS);
  assert.ok(report.feedback, 'feedback section must exist');
  assert.ok(report.gates, 'gates section must exist');
  assert.ok(report.provenance, 'provenance section must exist');
  assert.equal(typeof report.feedback.totalPositive, 'number');
  assert.equal(typeof report.feedback.totalNegative, 'number');
  assert.equal(typeof report.gates.blocked, 'number');
  assert.equal(typeof report.gates.warned, 'number');
  assert.equal(typeof report.provenance.total, 'number');
  assert.ok(report.provenance.byType && typeof report.provenance.byType === 'object');
});

test('normalizeWindowHours clamps to [MIN_WINDOW_HOURS, MAX_WINDOW_HOURS]', () => {
  assert.equal(normalizeWindowHours(0), MIN_WINDOW_HOURS);
  assert.equal(normalizeWindowHours(-5), MIN_WINDOW_HOURS);
  assert.equal(normalizeWindowHours(10), 10);
  assert.equal(normalizeWindowHours(MAX_WINDOW_HOURS + 1), MAX_WINDOW_HOURS);
  assert.equal(normalizeWindowHours(99999), MAX_WINDOW_HOURS);
  assert.equal(normalizeWindowHours('bad'), DEFAULT_WINDOW_HOURS);
  assert.equal(normalizeWindowHours(null), DEFAULT_WINDOW_HOURS);
  assert.equal(normalizeWindowHours(undefined), DEFAULT_WINDOW_HOURS);
});

test('topNegativeTags sorts by negative count and caps at 5', () => {
  const tags = {
    alpha: { negative: 1, positive: 0, total: 1 },
    beta: { negative: 10, positive: 2, total: 12 },
    gamma: { negative: 5, positive: 0, total: 5 },
    delta: { negative: 0, positive: 3, total: 3 },
    epsilon: { negative: 8, positive: 0, total: 8 },
    zeta: { negative: 2, positive: 0, total: 2 },
    eta: { negative: 4, positive: 0, total: 4 },
  };
  const result = topNegativeTags(tags);
  assert.equal(result.length, 5);
  assert.equal(result[0].tag, 'beta');
  assert.equal(result[1].tag, 'epsilon');
  assert.equal(result[2].tag, 'gamma');
  assert.ok(!result.find((r) => r.tag === 'delta'), 'tags with zero negative must be filtered');
});

test('topGates sorts by blocked then warned and caps at 5', () => {
  const byGate = {
    alpha: { blocked: 0, warned: 10, pendingApproval: 0 },
    beta: { blocked: 5, warned: 0, pendingApproval: 1 },
    gamma: { blocked: 5, warned: 3, pendingApproval: 0 },
    delta: { blocked: 1, warned: 0, pendingApproval: 0 },
  };
  const result = topGates(byGate);
  assert.equal(result[0].gate, 'gamma');
  assert.equal(result[1].gate, 'beta');
  assert.equal(result[2].gate, 'delta');
  assert.equal(result[3].gate, 'alpha');
});

test('summarizeProvenance counts events only inside the window', () => {
  const now = Date.now();
  const events = [
    { type: 'context_pack_distributed', timestamp: new Date(now - 1000).toISOString() },
    { type: 'context_pack_distributed', timestamp: new Date(now - 5000).toISOString() },
    { type: 'context_pack_created', timestamp: new Date(now - 500).toISOString() },
    { type: 'context_pack_distributed', timestamp: new Date(now - 10 * 60 * 60 * 1000).toISOString() },
  ];
  const sinceMs = now - 10_000;
  const summary = summarizeProvenance(events, sinceMs);
  assert.equal(summary.total, 3);
  assert.equal(summary.byType.context_pack_distributed, 2);
  assert.equal(summary.byType.context_pack_created, 1);
});

test('buildSessionReport respects a custom window', () => {
  const report = buildSessionReport({ windowHours: 2 });
  assert.equal(report.windowHours, 2);
  const generated = Date.parse(report.generatedAt);
  const since = Date.parse(report.since);
  const deltaMs = generated - since;
  assert.ok(Math.abs(deltaMs - 2 * 60 * 60 * 1000) < 5000, 'since should be ~2h before generatedAt');
});
