const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  NEAR_MISS_THRESHOLD,
  computeNearMiss,
  extractLiteralTokens,
  formatTraceSummary,
  loadTraces,
  recordTrace,
  summarizeSessionTraces,
  traceEvaluation,
} = require('../scripts/decision-trace');
const { validateSpec } = require('../scripts/spec-gate');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-decision-trace-'));
}

const FULL_SPEC = {
  name: 'test-safety',
  constraints: [
    { id: 'no-force-push', scope: 'bash', deny: 'git\\s+push.*--force', reason: 'No force push.' },
    { id: 'no-secrets', scope: 'content', deny: 'AKIA[A-Z0-9]{16}', reason: 'No AWS keys.' },
    { id: 'no-drop', scope: 'any', deny: 'DROP\\s+TABLE', reason: 'No dropping tables.' },
  ],
  invariants: [
    { id: 'tests-before-commit', require: 'npm test', before: 'git commit', reason: 'Run tests first.' },
  ],
};

// ---------------------------------------------------------------------------
// extractLiteralTokens
// ---------------------------------------------------------------------------

test('extractLiteralTokens strips metacharacters and returns tokens', () => {
  const tokens = extractLiteralTokens('git\\s+push.*--force');
  assert.ok(tokens.includes('git'));
  assert.ok(tokens.includes('push'));
  assert.ok(tokens.includes('--force'));
});

test('extractLiteralTokens handles complex patterns', () => {
  const tokens = extractLiteralTokens('AKIA[A-Z0-9]{16}');
  assert.ok(tokens.includes('akia'));
});

test('extractLiteralTokens returns empty for pure metacharacter patterns', () => {
  const tokens = extractLiteralTokens('.*');
  assert.equal(tokens.length, 0);
});

// ---------------------------------------------------------------------------
// computeNearMiss
// ---------------------------------------------------------------------------

test('computeNearMiss detects near-miss when most tokens match', () => {
  const constraint = { deny: 'git\\s+push.*--force' };
  // "git push origin main" has 2/3 tokens (git, push) but not "force"
  const result = computeNearMiss(constraint, 'git push origin main');
  assert.ok(result.score >= NEAR_MISS_THRESHOLD);
  assert.equal(result.isNearMiss, true);
  assert.equal(result.matchedTokens, 2);
  assert.equal(result.totalTokens, 3);
});

test('computeNearMiss returns false when no tokens match', () => {
  const constraint = { deny: 'DROP\\s+TABLE' };
  const result = computeNearMiss(constraint, 'npm run lint');
  assert.equal(result.isNearMiss, false);
  assert.equal(result.score, 0);
});

test('computeNearMiss returns false for pure metacharacter patterns', () => {
  const constraint = { deny: '.*' };
  const result = computeNearMiss(constraint, 'anything');
  assert.equal(result.isNearMiss, false);
  assert.equal(result.totalTokens, 0);
});

test('computeNearMiss score=1 is not a near-miss (full match territory)', () => {
  const constraint = { deny: 'git\\s+push.*--force' };
  // All tokens present: git, push, force
  const result = computeNearMiss(constraint, 'git push --force');
  assert.equal(result.score, 1);
  // score=1 means full match, so isNearMiss is false (it's a real match, not near)
  assert.equal(result.isNearMiss, false);
});

// ---------------------------------------------------------------------------
// traceEvaluation
// ---------------------------------------------------------------------------

test('traceEvaluation returns full trace with blocks', () => {
  const specs = [validateSpec(FULL_SPEC)];
  const trace = traceEvaluation(specs, { command: 'git push origin main --force' });

  assert.equal(trace.allowed, false);
  assert.ok(trace.traceId.startsWith('trace_'));
  assert.ok(trace.timestamp);
  assert.ok(trace.counts.blocked >= 1);
  assert.ok(trace.counts.total >= 3);
  assert.ok(trace.blocked.length >= 1);
  assert.ok(trace.blocked.some((b) => b.constraintId === 'no-force-push'));
});

test('traceEvaluation detects near-misses on safe commands', () => {
  const specs = [validateSpec(FULL_SPEC)];
  // "git push origin main" has tokens matching "git push --force" pattern
  const trace = traceEvaluation(specs, { command: 'git push origin main' });

  assert.equal(trace.allowed, true);
  assert.ok(trace.nearMisses.length >= 1, 'expected at least one near-miss');
  assert.ok(trace.nearMisses.some((nm) => nm.constraintId === 'no-force-push'));
});

test('traceEvaluation returns clean trace for safe commands', () => {
  const specs = [validateSpec(FULL_SPEC)];
  const trace = traceEvaluation(specs, { command: 'npm run lint', content: 'const x = 1;' });

  assert.equal(trace.allowed, true);
  assert.equal(trace.counts.blocked, 0);
});

test('traceEvaluation includes invariant checks', () => {
  const specs = [validateSpec(FULL_SPEC)];
  const trace = traceEvaluation(specs, {
    command: 'git commit -m "untested"',
    action: 'git commit -m "untested"',
    sessionActions: ['git add .'],
  });

  assert.equal(trace.allowed, false);
  assert.ok(trace.blocked.some((b) => b.invariantId === 'tests-before-commit'));
});

test('traceEvaluation context is captured', () => {
  const specs = [validateSpec(FULL_SPEC)];
  const trace = traceEvaluation(specs, {
    tool: 'Bash',
    command: 'npm test',
    action: 'npm test',
  });

  assert.equal(trace.context.tool, 'Bash');
  assert.equal(trace.context.command, 'npm test');
});

// ---------------------------------------------------------------------------
// recordTrace / loadTraces
// ---------------------------------------------------------------------------

test('recordTrace persists and loadTraces retrieves', () => {
  const tempDir = makeTempDir();
  const specs = [validateSpec(FULL_SPEC)];
  const trace = traceEvaluation(specs, { command: 'git push --force' });

  recordTrace(trace, { feedbackDir: tempDir });
  const loaded = loadTraces({ feedbackDir: tempDir });

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].traceId, trace.traceId);
  assert.equal(loaded[0].allowed, false);
  assert.ok(loaded[0].counts.blocked >= 1);
});

test('recordTrace stores near-misses', () => {
  const tempDir = makeTempDir();
  const specs = [validateSpec(FULL_SPEC)];
  const trace = traceEvaluation(specs, { command: 'git push origin main' });

  recordTrace(trace, { feedbackDir: tempDir });
  const loaded = loadTraces({ feedbackDir: tempDir });

  assert.equal(loaded.length, 1);
  assert.ok(loaded[0].nearMisses.length >= 1);
});

// ---------------------------------------------------------------------------
// summarizeSessionTraces
// ---------------------------------------------------------------------------

test('summarizeSessionTraces computes posture and rates', () => {
  const traces = [
    { counts: { total: 5, blocked: 2, nearMiss: 1, passed: 2 }, blocked: [{ specName: 'safety', id: 'no-force' }, { specName: 'safety', id: 'no-drop' }], nearMisses: [{ id: 'no-secrets', nearMissScore: 0.67 }] },
    { counts: { total: 3, blocked: 0, nearMiss: 1, passed: 2 }, blocked: [], nearMisses: [{ id: 'no-force', nearMissScore: 0.75 }] },
    { counts: { total: 4, blocked: 0, nearMiss: 0, passed: 4 }, blocked: [], nearMisses: [] },
  ];

  const summary = summarizeSessionTraces(traces);
  assert.equal(summary.totalEvaluations, 3);
  assert.equal(summary.totalChecks, 12);
  assert.equal(summary.totalBlocked, 2);
  assert.equal(summary.totalNearMisses, 2);
  assert.equal(summary.totalPassed, 8);
  assert.equal(summary.safetyPosture, 'critical');
  assert.ok(summary.blockRate > 0);
  assert.ok(summary.nearMissRate > 0);
  assert.ok(summary.topBlockedSpecs.length > 0);
  assert.ok(summary.topNearMisses.length > 0);
});

test('summarizeSessionTraces returns clean for no blocks or near-misses', () => {
  const traces = [
    { counts: { total: 3, blocked: 0, nearMiss: 0, passed: 3 }, blocked: [], nearMisses: [] },
  ];

  const summary = summarizeSessionTraces(traces);
  assert.equal(summary.safetyPosture, 'clean');
  assert.equal(summary.blockRate, 0);
  assert.equal(summary.nearMissRate, 0);
});

test('summarizeSessionTraces returns cautious for near-misses only', () => {
  const traces = [
    { counts: { total: 3, blocked: 0, nearMiss: 2, passed: 1 }, blocked: [], nearMisses: [{ id: 'no-force', nearMissScore: 0.67 }, { id: 'no-drop', nearMissScore: 0.5 }] },
  ];

  const summary = summarizeSessionTraces(traces);
  assert.equal(summary.safetyPosture, 'cautious');
});

test('summarizeSessionTraces returns unknown for empty traces', () => {
  const summary = summarizeSessionTraces([]);
  assert.equal(summary.safetyPosture, 'unknown');
  assert.equal(summary.totalEvaluations, 0);
});

// ---------------------------------------------------------------------------
// formatTraceSummary
// ---------------------------------------------------------------------------

test('formatTraceSummary produces readable output', () => {
  const summary = {
    safetyPosture: 'critical',
    totalEvaluations: 5,
    totalChecks: 20,
    totalBlocked: 3,
    totalNearMisses: 2,
    totalPassed: 15,
    blockRate: 15,
    nearMissRate: 10,
    topBlockedSpecs: [{ name: 'safety', count: 3 }],
    topBlockedConstraints: [{ id: 'no-force-push', count: 2 }],
    topNearMisses: [{ id: 'no-drop', count: 1, maxScore: 0.67 }],
  };

  const output = formatTraceSummary(summary);
  assert.ok(output.includes('CRITICAL'));
  assert.ok(output.includes('Evaluations: 5'));
  assert.ok(output.includes('Blocked: 3'));
  assert.ok(output.includes('Near-Misses: 2'));
  assert.ok(output.includes('no-force-push'));
  assert.ok(output.includes('no-drop'));
});

// ---------------------------------------------------------------------------
// Integration: built-in agent-safety spec
// ---------------------------------------------------------------------------

test('traceEvaluation works with built-in agent-safety spec', () => {
  const { loadSpecDir } = require('../scripts/spec-gate');
  const specs = loadSpecDir(path.join(__dirname, '..', 'config', 'specs'));
  assert.ok(specs.length >= 1);

  // Blocked action
  const blocked = traceEvaluation(specs, { command: 'git push --force origin main' });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.blocked.some((b) => b.constraintId === 'no-force-push'));

  // Near-miss action
  const nearMiss = traceEvaluation(specs, { command: 'git push origin main' });
  assert.equal(nearMiss.allowed, true);
  assert.ok(nearMiss.nearMisses.length >= 1);

  // Clean action
  const clean = traceEvaluation(specs, { command: 'npm run lint' });
  assert.equal(clean.allowed, true);
  assert.equal(clean.counts.blocked, 0);
});
