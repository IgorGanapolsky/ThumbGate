'use strict';

// AGENT-3667, 25 Nov 2026: two rows a test script wrote through capture_feedback sat inside a person's real
// thumbs-down count. A row id listed in not-counted-feedback.jsonl is left out of every count; the log is untouched.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { collectHumanRows, computeHumanCounts, applyHumanCounts } = require('../scripts/statusline-human-counts');
const { markNotCounted } = require('../scripts/not-a-thumb');

function makeProject() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-not-a-thumb-'));
  const project = path.join(home, 'demo-project');
  fs.mkdirSync(path.join(project, '.thumbgate'), { recursive: true });
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, TMPDIR: os.tmpdir() };
  const options = { cwd: project, projectDir: project, env };
  const { projectKey } = collectHumanRows(options);
  const logFile = path.join(project, '.thumbgate', 'feedback-log.jsonl');
  const at = (i) => new Date(Date.UTC(2026, 10, 24, 12, i)).toISOString();
  const down = (id, i) => ({ id, signal: 'negative', reviewOrigin: 'human', projectKey, tags: [], context: `Igor: thumbs down ${id}`, timestamp: at(i) });
  fs.writeFileSync(logFile, [down('real_1', 1), down('probe_1', 2), down('probe_2', 3)].map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { home, project, options, logFile };
}

test('REQ-01: a row id in the not-counted file is left out of the count and the log is byte-for-byte unchanged', () => {
  const p = makeProject();
  try {
    assert.equal(computeHumanCounts(p.options).down, 3);
    const before = fs.readFileSync(p.logFile, 'utf8');
    markNotCounted(['probe_1', 'probe_2'], 'written by a probe script', p.options);
    const counts = computeHumanCounts(p.options);
    assert.equal(counts.down, 1);
    assert.equal(collectHumanRows(p.options).excluded.markedNotThumb, 2);
    assert.equal(fs.readFileSync(p.logFile, 'utf8'), before, 'no row deleted or rewritten');
  } finally {
    fs.rmSync(p.home, { recursive: true, force: true });
  }
});

test('REQ-02: applyHumanCounts replaces only the thumb totals of a stats payload', () => {
  const p = makeProject();
  try {
    markNotCounted(['probe_1', 'probe_2'], 'probe', p.options);
    const out = applyHumanCounts({ totalPositive: 9, totalNegative: 9, total: 18, approvalRate: 0.5, trend: 'up', rubric: { samples: 4 } }, p.options);
    assert.deepEqual([out.totalPositive, out.totalNegative, out.total, out.approvalRate], [0, 1, 1, 0]);
    assert.equal(out.trend, 'up');
    assert.deepEqual(out.rubric, { samples: 4 });
  } finally {
    fs.rmSync(p.home, { recursive: true, force: true });
  }
});

test('REQ-04: an unterminated ledger line does not swallow the next record, and the lifetime window follows the totals', () => {
  const p = makeProject();
  try {
    const ledger = path.join(p.project, '.thumbgate', 'not-counted-feedback.jsonl');
    fs.writeFileSync(ledger, JSON.stringify({ id: 'probe_1', reason: 'old' }));
    markNotCounted(['probe_2'], 'new', p.options);
    assert.equal(computeHumanCounts(p.options).down, 1, 'both marked rows are left out');
    const out = applyHumanCounts({ windows: { lifetime: { total: 3, rate: 0.1 }, last7: { total: 3 } } }, p.options);
    assert.deepEqual(out.windows.lifetime, { total: 1, rate: 0 });
    assert.deepEqual(out.windows.last7, { total: 3 });
  } finally {
    fs.rmSync(p.home, { recursive: true, force: true });
  }
});

test('REQ-05: the aggregate stats path leaves marked rows out too', () => {
  const { computeAggregateFeedbackStats } = require('../scripts/feedback-aggregate');
  const p = makeProject();
  try {
    markNotCounted(['probe_1', 'probe_2'], 'probe', p.options);
    const stats = computeAggregateFeedbackStats({ feedbackDir: path.join(p.project, '.thumbgate') });
    assert.equal(stats.totalNegative, 1);
  } finally {
    fs.rmSync(p.home, { recursive: true, force: true });
  }
});

test('REQ-03: the status line names the project next to the counts and keeps the version', () => {
  const json = JSON.stringify({ up: 2, down: 5, label: 'this project', project: 'orchestrator' });
  const out = execFileSync('bash', [path.join(__dirname, '..', 'scripts', 'statusline.sh')], {
    input: '{}', encoding: 'utf8', env: { ...process.env, _TEST_THUMBGATE_STATUSLINE_HUMAN_JSON: json, NO_COLOR: '1' },
  }).replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(out, /5\s*👎\s*this project \(orchestrator\)/);
  assert.match(out, /v\d+\.\d+\.\d+/, 'the version stays visible');
});
