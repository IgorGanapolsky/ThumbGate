const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-dashboard-test-'));
process.env.RLHF_FEEDBACK_DIR = tmpDir;

const {
  generateDashboard,
  computeApprovalStats,
  computeSessionTrend,
  readJSONL,
  readJsonFile,
} = require('../scripts/dashboard');

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFeedbackLog(entries) {
  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  const lines = entries.map((e) => JSON.stringify(e)).join('\n');
  fs.writeFileSync(logPath, lines + '\n');
}

function writeMemoryLog(entries) {
  const memPath = path.join(tmpDir, 'memory-log.jsonl');
  const lines = entries.map((e) => JSON.stringify(e)).join('\n');
  fs.writeFileSync(memPath, lines + '\n');
}

function writeDiagnosticLog(entries) {
  const diagnosticPath = path.join(tmpDir, 'diagnostic-log.jsonl');
  const lines = entries.map((e) => JSON.stringify(e)).join('\n');
  fs.writeFileSync(diagnosticPath, lines + '\n');
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

test('generateDashboard handles empty state (no files)', () => {
  // Clear any existing files
  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);

  const data = generateDashboard(tmpDir);
  assert.equal(data.approval.total, 0);
  assert.equal(data.approval.approvalRate, 0);
  assert.equal(data.approval.positive, 0);
  assert.equal(data.approval.negative, 0);
  assert.equal(data.health.feedbackCount, 0);
  assert.equal(data.health.memoryCount, 0);
  assert.equal(data.diagnostics.totalDiagnosed, 0);
  assert.equal(data.secretGuard.blocked, 0);
});

// ---------------------------------------------------------------------------
// Approval stats
// ---------------------------------------------------------------------------

test('computeApprovalStats calculates correct rates', () => {
  const entries = [
    { signal: 'positive', timestamp: new Date().toISOString() },
    { signal: 'positive', timestamp: new Date().toISOString() },
    { signal: 'negative', timestamp: new Date().toISOString() },
    { signal: 'positive', timestamp: new Date().toISOString() },
  ];
  const stats = computeApprovalStats(entries);
  assert.equal(stats.total, 4);
  assert.equal(stats.positive, 3);
  assert.equal(stats.negative, 1);
  assert.equal(stats.approvalRate, 75);
});

test('computeApprovalStats handles all-negative entries', () => {
  const entries = [
    { signal: 'negative', timestamp: new Date().toISOString() },
    { signal: 'negative', timestamp: new Date().toISOString() },
  ];
  const stats = computeApprovalStats(entries);
  assert.equal(stats.approvalRate, 0);
  assert.equal(stats.negative, 2);
});

// ---------------------------------------------------------------------------
// 7-day trend detection
// ---------------------------------------------------------------------------

test('computeApprovalStats detects improving trend', () => {
  const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recentDate = new Date().toISOString();

  // Old entries: mostly negative
  const oldEntries = Array.from({ length: 20 }, () => ({ signal: 'negative', timestamp: oldDate }));
  // Recent entries: mostly positive
  const recentEntries = Array.from({ length: 20 }, () => ({ signal: 'positive', timestamp: recentDate }));

  const stats = computeApprovalStats([...oldEntries, ...recentEntries]);
  assert.equal(stats.trendDirection, 'improving');
});

// ---------------------------------------------------------------------------
// Session trend bars
// ---------------------------------------------------------------------------

test('computeSessionTrend generates bars for sufficient data', () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({
    signal: i % 2 === 0 ? 'positive' : 'negative',
    timestamp: new Date().toISOString(),
  }));
  const trend = computeSessionTrend(entries, 10);
  assert.ok(typeof trend.bars === 'string');
  assert.ok(trend.percentage >= 0 && trend.percentage <= 100);
});

test('computeSessionTrend returns empty for insufficient data', () => {
  const trend = computeSessionTrend([], 10);
  assert.equal(trend.percentage, 0);
});

// ---------------------------------------------------------------------------
// Full dashboard with sample data
// ---------------------------------------------------------------------------

test('generateDashboard returns complete structure with data', () => {
  const now = new Date();
  const entries = [];
  for (let i = 0; i < 30; i++) {
    entries.push({
      signal: i < 20 ? 'positive' : 'negative',
      timestamp: new Date(now.getTime() - i * 60000).toISOString(),
      tags: i >= 20 ? ['testing'] : [],
      diagnosis: i >= 20 ? {
        rootCauseCategory: 'tool_output_misread',
        criticalFailureStep: 'verification',
        violations: [{ constraintId: 'workflow:proof_commands' }],
      } : null,
    });
  }
  writeFeedbackLog(entries);
  writeMemoryLog([{ id: 'mem-1' }, { id: 'mem-2' }]);

  const data = generateDashboard(tmpDir);

  // Structure checks
  assert.ok(data.approval);
  assert.ok(data.gateStats);
  assert.ok(data.prevention);
  assert.ok(data.trend);
  assert.ok(data.health);
  assert.ok(data.diagnostics);
  assert.ok(data.secretGuard);

  // Values
  assert.equal(data.approval.total, 30);
  assert.equal(data.approval.positive, 20);
  assert.equal(data.approval.negative, 10);
  assert.equal(data.health.feedbackCount, 30);
  assert.equal(data.health.memoryCount, 2);
  assert.equal(data.diagnostics.totalDiagnosed, 10);
  assert.equal(data.diagnostics.categories[0].key, 'tool_output_misread');
  assert.equal(data.secretGuard.blocked, 0);
});

test('generateDashboard aggregates persisted diagnostics beyond feedback capture', () => {
  writeFeedbackLog([
    { signal: 'positive', timestamp: new Date().toISOString() },
  ]);
  writeDiagnosticLog([
    {
      source: 'verification_loop',
      diagnosis: {
        rootCauseCategory: 'intent_plan_misalignment',
        criticalFailureStep: 'verification',
        violations: [{ constraintId: 'intent:publish_dpo_training_data' }],
      },
    },
  ]);

  const data = generateDashboard(tmpDir);
  assert.equal(data.diagnostics.totalDiagnosed, 1);
  assert.equal(data.diagnostics.categories[0].key, 'intent_plan_misalignment');
});

test('generateDashboard reports secret guard violations separately', () => {
  writeFeedbackLog([
    { signal: 'positive', timestamp: new Date().toISOString() },
  ]);
  writeDiagnosticLog([
    {
      source: 'secret_guard',
      step: 'pre_tool_use',
      timestamp: new Date().toISOString(),
      diagnosis: {
        rootCauseCategory: 'guardrail_triggered',
        criticalFailureStep: 'pre_tool_use',
        violations: [{ constraintId: 'security:stripe_live_secret' }],
      },
    },
  ]);

  const data = generateDashboard(tmpDir);
  assert.equal(data.secretGuard.blocked, 1);
  assert.equal(data.secretGuard.topConstraint.key, 'security:stripe_live_secret');
  assert.equal(data.secretGuard.recent[0].step, 'pre_tool_use');
});

// ---------------------------------------------------------------------------
// readJSONL / readJsonFile helpers
// ---------------------------------------------------------------------------

test('readJSONL returns empty array for missing file', () => {
  const result = readJSONL(path.join(tmpDir, 'nonexistent.jsonl'));
  assert.deepEqual(result, []);
});

test('readJsonFile returns null for missing file', () => {
  const result = readJsonFile(path.join(tmpDir, 'nonexistent.json'));
  assert.equal(result, null);
});

test('readJsonFile returns null for invalid JSON', () => {
  const badPath = path.join(tmpDir, 'bad.json');
  fs.writeFileSync(badPath, 'not json');
  const result = readJsonFile(badPath);
  assert.equal(result, null);
});
