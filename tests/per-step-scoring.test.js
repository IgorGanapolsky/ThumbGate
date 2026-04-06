const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-step-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const pss = require('../scripts/per-step-scoring');

test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// === Score Conversion ===
test('decisionToScore maps allow/warn/deny correctly', () => {
  assert.equal(pss.decisionToScore('allow'), 1);
  assert.equal(pss.decisionToScore('warn'), -0.5);
  assert.equal(pss.decisionToScore('deny'), -1);
  assert.equal(pss.decisionToScore('unknown'), 0);
});

// === Score Step ===
test('scoreStep converts audit entry to scored step', () => {
  const s = pss.scoreStep({ toolName: 'Bash', decision: 'deny', gateId: 'force-push', message: 'blocked force push', timestamp: new Date().toISOString() });
  assert.ok(s.id.startsWith('step_'));
  assert.equal(s.score, -1);
  assert.equal(s.toolName, 'Bash');
  assert.equal(s.gateId, 'force-push');
});

test('scoreStep handles allow decision', () => {
  assert.equal(pss.scoreStep({ decision: 'allow' }).score, 1);
});

test('scoreStep defaults missing fields', () => {
  const s = pss.scoreStep({});
  assert.equal(s.toolName, 'unknown');
  assert.equal(s.score, 0); // no decision = neutral
});

// === Score Audit Trail ===
test('scoreAuditTrail processes multiple entries', () => {
  const entries = [
    { toolName: 'Bash', decision: 'allow', timestamp: new Date().toISOString() },
    { toolName: 'Bash', decision: 'deny', gateId: 'force-push', message: 'blocked', timestamp: new Date().toISOString() },
    { toolName: 'Edit', decision: 'warn', gateId: 'env-file', message: 'warned', timestamp: new Date().toISOString() },
    { toolName: 'Write', decision: 'allow', timestamp: new Date().toISOString() },
    { toolName: 'Bash', decision: 'deny', gateId: 'rm-rf', message: 'blocked delete', timestamp: new Date().toISOString() },
  ];
  const result = pss.scoreAuditTrail(entries);
  assert.equal(result.scored, 5);
  assert.equal(result.scores[0].score, 1);
  assert.equal(result.scores[1].score, -1);
  assert.equal(result.scores[2].score, -0.5);
  assert.ok(fs.existsSync(pss.getScoresPath()));
});

// === DPO Pairs from Steps ===
test('generateStepDpoPairs creates pairs from +1/-1 scores', () => {
  const result = pss.generateStepDpoPairs({ periodHours: 1 });
  assert.ok(result.pairCount >= 2); // 2 allows + 2 denies = 2 pairs
  assert.ok(result.pairs[0].chosenScore > 0);
  assert.ok(result.pairs[0].rejectedScore < 0);
  assert.ok(result.pairs[0].prompt.includes('Tool call'));
});

test('generateStepDpoPairs limits pairs to min of pos/neg', () => {
  const result = pss.generateStepDpoPairs({ periodHours: 1 });
  assert.ok(result.pairCount <= Math.min(result.totalPositive, result.totalNegative));
});

test('generateStepDpoPairs returns empty for no data period', () => {
  const result = pss.generateStepDpoPairs({ periodHours: 0 });
  assert.equal(result.pairCount, 0);
});

// === KTO Export ===
test('exportStepKto exports individual scored entries', () => {
  const result = pss.exportStepKto({ periodHours: 1 });
  assert.ok(result.count >= 5);
  const allowed = result.entries.filter((e) => e.label === true);
  const denied = result.entries.filter((e) => e.label === false);
  assert.ok(allowed.length >= 2);
  assert.ok(denied.length >= 2);
  assert.ok(result.entries[0].prompt.includes('Tool call'));
});

test('exportStepKto returns empty for no data period', () => {
  assert.equal(pss.exportStepKto({ periodHours: 0 }).count, 0);
});

// === Stats ===
test('getStepScoringStats returns per-tool breakdown', () => {
  const stats = pss.getStepScoringStats({ periodHours: 1 });
  assert.ok(stats.total >= 5);
  assert.ok(stats.positive >= 2);
  assert.ok(stats.negative >= 2);
  assert.ok(stats.byTool['Bash']);
  assert.ok(stats.byTool['Bash'].total >= 3);
});

test('getStepScoringStats returns zero for empty period', () => {
  const stats = pss.getStepScoringStats({ periodHours: 0 });
  assert.equal(stats.total, 0);
});

// === Path ===
test('getScoresPath returns correct path', () => {
  assert.ok(pss.getScoresPath().endsWith('step-scores.jsonl'));
});
