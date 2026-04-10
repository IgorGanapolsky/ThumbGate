'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  syncClaudeHistoryFeedback,
} = require('../scripts/claude-feedback-sync');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

test('syncClaudeHistoryFeedback imports missed Claude feedback for the active project', () => {
  const homeDir = makeTmpDir('thumbgate-claude-sync-home-');
  const feedbackDir = makeTmpDir('thumbgate-claude-sync-feedback-');
  const projectDir = '/tmp/thumbgate-project';
  const historyPath = path.join(homeDir, '.claude', 'history.jsonl');

  writeJsonl(historyPath, [
    {
      display: 'thumbs down',
      timestamp: 1775750156301,
      project: projectDir,
      sessionId: 'session-1',
    },
    {
      display: 'thumbs up elsewhere',
      timestamp: 1775750157301,
      project: '/tmp/other-project',
      sessionId: 'session-2',
    },
  ]);

  const result = syncClaudeHistoryFeedback({
    feedbackDir,
    projectDir,
    historyPath,
  });

  assert.equal(result.importedCount, 1);

  const feedbackLog = path.join(feedbackDir, 'feedback-log.jsonl');
  const entries = fs.readFileSync(feedbackLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].signal, 'negative');
  assert.equal(entries[0].submittedContext, 'thumbs down');

  const cache = JSON.parse(fs.readFileSync(path.join(feedbackDir, 'statusline_cache.json'), 'utf8'));
  assert.equal(cache.thumbs_down, '1');

  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.rmSync(feedbackDir, { recursive: true, force: true });
});

test('syncClaudeHistoryFeedback skips feedback already captured by the live hook', () => {
  const homeDir = makeTmpDir('thumbgate-claude-sync-home-');
  const feedbackDir = makeTmpDir('thumbgate-claude-sync-feedback-');
  const projectDir = '/tmp/thumbgate-project';
  const historyPath = path.join(homeDir, '.claude', 'history.jsonl');
  const sourceTimestamp = '2026-04-09T15:25:50.754Z';

  writeJsonl(historyPath, [
    {
      display: 'thumbs down',
      timestamp: Date.parse(sourceTimestamp),
      project: projectDir,
      sessionId: 'session-1',
    },
  ]);

  writeJsonl(path.join(feedbackDir, 'feedback-log.jsonl'), [
    {
      id: 'fb_existing',
      signal: 'negative',
      context: 'thumbs down',
      submittedContext: 'thumbs down',
      actionType: 'no-action',
      actionReason: 'Negative feedback is too vague to promote — describe what failed in one sentence',
      timestamp: sourceTimestamp,
    },
  ]);

  const result = syncClaudeHistoryFeedback({
    feedbackDir,
    projectDir,
    historyPath,
  });

  assert.equal(result.importedCount, 0);
  assert.equal(result.skippedCount, 1);

  const entries = fs.readFileSync(path.join(feedbackDir, 'feedback-log.jsonl'), 'utf8').trim().split('\n');
  assert.equal(entries.length, 1);

  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.rmSync(feedbackDir, { recursive: true, force: true });
});
