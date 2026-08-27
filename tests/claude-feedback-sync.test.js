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

test('history rotation does not re-import previously synced signals', () => {
  const homeDir = makeTmpDir('thumbgate-claude-sync-home-');
  const feedbackDir = makeTmpDir('thumbgate-claude-sync-feedback-');
  const projectDir = '/tmp/thumbgate-project';
  const historyPath = path.join(homeDir, '.claude', 'history.jsonl');

  writeJsonl(historyPath, [
    { display: 'thumbs down that deploy claim was wrong', timestamp: 1775750156301, project: projectDir, sessionId: 's1' },
    { display: 'thumbs up the fix landed cleanly this time', timestamp: 1775750256301, project: projectDir, sessionId: 's1' },
  ]);

  const first = syncClaudeHistoryFeedback({ feedbackDir, projectDir, historyPath });
  assert.equal(first.importedCount, 2);

  // Simulate rotation: the file is rewritten SMALLER than the recorded size,
  // containing the same old prompts. Pre-fix, the offset reset to 0 and both
  // signals re-imported as fresh "auto-capture-fallback" junk events.
  writeJsonl(historyPath, [
    { display: 'thumbs down that deploy claim was wrong', timestamp: 1775750156301, project: projectDir, sessionId: 's1' },
  ]);

  const second = syncClaudeHistoryFeedback({ feedbackDir, projectDir, historyPath });
  assert.equal(second.importedCount, 0);

  const entries = fs.readFileSync(path.join(feedbackDir, 'feedback-log.jsonl'), 'utf8').trim().split('\n');
  assert.equal(entries.length, 2);

  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.rmSync(feedbackDir, { recursive: true, force: true });
});

test('rotation preserves new entries already present in the replacement file', () => {
  const homeDir = makeTmpDir('thumbgate-claude-sync-home-');
  const feedbackDir = makeTmpDir('thumbgate-claude-sync-feedback-');
  const projectDir = '/tmp/thumbgate-project';
  const historyPath = path.join(homeDir, '.claude', 'history.jsonl');

  writeJsonl(historyPath, [
    { display: 'thumbs down that deploy claim was wrong', timestamp: 1775750156301, project: projectDir, sessionId: 's1' },
  ]);

  const first = syncClaudeHistoryFeedback({ feedbackDir, projectDir, historyPath });
  assert.equal(first.importedCount, 1);

  // Rename-based rotation: the replacement file has a NEW inode and grows
  // PAST the recorded size, carrying one already-synced signal plus one
  // brand-new signal. Skip-to-end would permanently drop the new signal;
  // a stale-offset read would slice into the middle of the new file.
  const replacementPath = `${historyPath}.rotating`;
  writeJsonl(replacementPath, [
    { display: 'thumbs down that deploy claim was wrong', timestamp: 1775750156301, project: projectDir, sessionId: 's1' },
    { display: 'thumbs down the new report also skipped verification entirely', timestamp: 1775750356301, project: projectDir, sessionId: 's2' },
  ]);
  fs.renameSync(replacementPath, historyPath);

  const second = syncClaudeHistoryFeedback({ feedbackDir, projectDir, historyPath });
  assert.equal(second.importedCount, 1);
  assert.equal(second.skippedCount, 1);

  const entries = fs.readFileSync(path.join(feedbackDir, 'feedback-log.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(entries.length, 2);
  assert.equal(entries[1].submittedContext, 'thumbs down the new report also skipped verification entirely');

  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.rmSync(feedbackDir, { recursive: true, force: true });
});

test('identical long text dedupes regardless of the timestamp window', () => {
  const homeDir = makeTmpDir('thumbgate-claude-sync-home-');
  const feedbackDir = makeTmpDir('thumbgate-claude-sync-feedback-');
  const projectDir = '/tmp/thumbgate-project';
  const historyPath = path.join(homeDir, '.claude', 'history.jsonl');
  const longPrompt = 'thumbs down the report claimed merged without a SHA again';

  writeJsonl(historyPath, [
    { display: longPrompt, timestamp: 1775750156301, project: projectDir, sessionId: 's1' },
  ]);

  // The live hook captured this prompt DAYS earlier — far outside the 5-minute
  // window that pre-fix let evicted candidates re-import as duplicates.
  writeJsonl(path.join(feedbackDir, 'feedback-log.jsonl'), [
    {
      id: 'fb_old',
      signal: 'negative',
      context: longPrompt,
      submittedContext: longPrompt,
      timestamp: '2026-03-01T00:00:00.000Z',
    },
  ]);

  const result = syncClaudeHistoryFeedback({ feedbackDir, projectDir, historyPath });
  assert.equal(result.importedCount, 0);
  assert.equal(result.skippedCount, 1);

  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.rmSync(feedbackDir, { recursive: true, force: true });
});

test('a short bare signal outside the window still imports as a new event', () => {
  const homeDir = makeTmpDir('thumbgate-claude-sync-home-');
  const feedbackDir = makeTmpDir('thumbgate-claude-sync-feedback-');
  const projectDir = '/tmp/thumbgate-project';
  const historyPath = path.join(homeDir, '.claude', 'history.jsonl');

  writeJsonl(historyPath, [
    { display: 'thumbs up', timestamp: 1775750156301, project: projectDir, sessionId: 's1' },
  ]);

  // Same bare words captured a month earlier: a human plausibly sends the same
  // short signal again, so the window-bound dedup must NOT swallow it.
  writeJsonl(path.join(feedbackDir, 'feedback-log.jsonl'), [
    {
      id: 'fb_old_bare',
      signal: 'positive',
      context: 'thumbs up',
      submittedContext: 'thumbs up',
      timestamp: '2026-03-01T00:00:00.000Z',
    },
  ]);

  const result = syncClaudeHistoryFeedback({ feedbackDir, projectDir, historyPath });
  assert.equal(result.importedCount, 1);

  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.rmSync(feedbackDir, { recursive: true, force: true });
});
