const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'feedback_quality_eval.py');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-feedback-quality-eval-'));
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function runScript(args, options = {}) {
  return spawnSync('python3', [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    ...options,
  });
}

function createLessonDb(dbPath) {
  const probe = `
import sqlite3
db = sqlite3.connect(${JSON.stringify(dbPath)})
db.executescript("""
CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  signal TEXT NOT NULL,
  context TEXT,
  whatWentWrong TEXT,
  whatToChange TEXT,
  whatWorked TEXT,
  domain TEXT,
  tags TEXT,
  rootCause TEXT,
  importance TEXT DEFAULT 'medium',
  skill TEXT,
  timestamp TEXT NOT NULL,
  sourceFeedbackId TEXT,
  pruned INTEGER DEFAULT 0
);
INSERT INTO lessons (id, signal, context, domain, tags, timestamp, sourceFeedbackId, pruned)
VALUES
  ('lesson_1', 'negative', 'git force push failed', 'git', '["git"]', '2026-05-12T12:00:00Z', 'fb_1', 0),
  ('lesson_2', 'positive', 'tests verified', 'testing', '["testing"]', '2026-05-12T12:03:00Z', 'fb_2', 0);
""")
db.commit()
db.close()
`;
  const result = spawnSync('python3', ['-c', probe], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('feedback_quality_eval.py compiles under python3', () => {
  const result = spawnSync('python3', ['-m', 'py_compile', SCRIPT], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout || 'python3 -m py_compile failed');
});

test('feedback quality eval reports JSONL quality without pretending missing gate labels are classifier metrics', () => {
  const dir = tempDir();
  const feedbackLog = path.join(dir, 'feedback-log.jsonl');
  writeJsonl(feedbackLog, [
    {
      id: 'fb_1',
      signal: 'negative',
      context: 'Agent ran git push without checking branch',
      whatWentWrong: 'Skipped git status before push',
      tags: ['git'],
      timestamp: '2026-05-12T12:00:00Z',
    },
    {
      id: 'fb_2',
      signal: 'positive',
      context: 'Ran tests and pasted output before final',
      whatWorked: 'Verification-first testing flow',
      tags: ['testing'],
      timestamp: '2026-05-12T12:05:00Z',
    },
  ]);

  const result = runScript(['--feedback-log', feedbackLog, '--json', '--min-support', '1']);
  assert.equal(result.status, 0, result.stderr);

  const report = JSON.parse(result.stdout);
  assert.equal(report.totalEntries, 2);
  assert.equal(report.usableEntries, 2);
  assert.equal(report.positiveRate, 0.5);
  assert.equal(report.gateMetrics.available, false);
  assert.match(report.gateMetrics.note, /No explicit gate decision labels/);
  assert.ok(report.categoryMetrics.some((row) => row.category === 'git' && row.negative === 1));
});

test('feedback quality eval computes gate precision and recall when blocked/allowed labels exist', () => {
  const dir = tempDir();
  const feedbackLog = path.join(dir, 'feedback-log.jsonl');
  writeJsonl(feedbackLog, [
    { id: 'tp', signal: 'negative', context: 'dangerous git push', blocked: true, tags: ['git'] },
    { id: 'tn', signal: 'positive', context: 'safe test run', allowed: true, tags: ['testing'] },
    { id: 'fp', signal: 'positive', context: 'safe docs edit was blocked', blocked: true, tags: ['documentation'] },
    { id: 'fn', signal: 'negative', context: 'unsafe rm command allowed', allowed: true, tags: ['security'] },
  ]);

  const result = runScript(['--feedback-log', feedbackLog, '--json', '--min-support', '1']);
  assert.equal(result.status, 0, result.stderr);

  const report = JSON.parse(result.stdout);
  assert.equal(report.gateMetrics.available, true);
  assert.equal(report.gateMetrics.truePositiveBlocks, 1);
  assert.equal(report.gateMetrics.trueNegativeAllows, 1);
  assert.equal(report.gateMetrics.falsePositiveBlocks, 1);
  assert.equal(report.gateMetrics.falseNegativeAllows, 1);
  assert.equal(report.gateMetrics.precision, 0.5);
  assert.equal(report.gateMetrics.recall, 0.5);
});

test('feedback quality eval e2e joins JSONL feedback, SQLite lessons, and LanceDB-style retrieval export', () => {
  const dir = tempDir();
  const feedbackLog = path.join(dir, 'feedback-log.jsonl');
  const lessonDb = path.join(dir, 'lessons.sqlite');
  const retrievalLog = path.join(dir, 'retrieval.jsonl');
  const reportPath = path.join(dir, 'report.md');

  writeJsonl(feedbackLog, [
    {
      id: 'fb_1',
      signal: 'negative',
      context: 'Agent repeated a git failure',
      whatWentWrong: 'Skipped branch check',
      blocked: true,
      tags: ['git'],
      timestamp: '2026-05-12T12:00:00Z',
    },
    {
      id: 'fb_2',
      signal: 'positive',
      context: 'Agent verified tests before final',
      allowed: true,
      tags: ['testing'],
      timestamp: '2026-05-12T12:03:00Z',
    },
    {
      id: 'fb_3',
      signal: 'negative',
      context: 'Agent skipped repro test',
      allowed: true,
      tags: ['testing'],
      timestamp: '2026-05-12T12:06:00Z',
    },
  ]);
  createLessonDb(lessonDb);
  writeJsonl(retrievalLog, [
    { queryFeedbackId: 'fb_1', matchedFeedbackId: 'fb_old_1', score: 0.92, matchedSignal: 'negative' },
    { queryFeedbackId: 'fb_1', matchedFeedbackId: 'fb_old_2', score: 0.71, matchedSignal: 'negative' },
    { queryFeedbackId: 'fb_2', matchedFeedbackId: 'fb_old_3', score: 0.64, matchedSignal: 'positive' },
  ]);

  const result = runScript([
    '--feedback-log', feedbackLog,
    '--lesson-db', lessonDb,
    '--retrieval-log', retrievalLog,
    '--write-report', reportPath,
    '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);

  const report = JSON.parse(result.stdout);
  assert.equal(report.sqliteLessonMetrics.available, true);
  assert.equal(report.sqliteLessonMetrics.totalLessons, 2);
  assert.equal(report.sqliteLessonMetrics.feedbackLessonCoverage, 0.6667);
  assert.equal(report.sqliteLessonMetrics.negativeLessonCoverage, 0.5);
  assert.equal(report.retrievalMetrics.available, true);
  assert.equal(report.retrievalMetrics.rows, 3);
  assert.equal(report.retrievalMetrics.queries, 2);
  assert.equal(report.retrievalMetrics.averageTopScore, 0.78);
  assert.equal(report.retrievalMetrics.negativeNeighborRate, 0.6667);
  assert.ok(report.recommendations.some((item) => /Backfill SQLite lesson rows/.test(item)));
  assert.ok(fs.existsSync(reportPath));
});

test('feedback quality eval writes a Markdown report with SQL and retrieval sections', () => {
  const dir = tempDir();
  const feedbackLog = path.join(dir, 'feedback-log.jsonl');
  const reportPath = path.join(dir, 'report.md');
  writeJsonl(feedbackLog, [
    { id: 'fb_1', signal: 'negative', context: 'debug error was not reproduced', tags: ['debugging'] },
    { id: 'fb_2', signal: 'negative', context: 'debug error repeated again', tags: ['debugging'] },
  ]);

  const result = runScript(['--feedback-log', feedbackLog, '--write-report', reportPath]);
  assert.equal(result.status, 0, result.stderr);

  const markdown = fs.readFileSync(reportPath, 'utf8');
  assert.match(markdown, /# Feedback Quality Eval/);
  assert.match(markdown, /## SQLite Lesson Coverage/);
  assert.match(markdown, /## LanceDB Retrieval Export/);
  assert.match(markdown, /debugging/);
});
