'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOKEN = 'ghp_FAKEFAKEFAKEFAKE';
const EMAIL = 'ada@example.com';
const PHONE = '305-555-0199';

function bulletLines(filePath) {
  return fs.readFileSync(filePath, 'utf8').split('\n').filter((line) => line.startsWith('- '));
}

test('one fake thumb becomes one scrubbed line and a second write does not duplicate it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recent-thumbs-'));
  const outPath = path.join(dir, 'RECENT-THUMBS.md');
  const logPath = path.join(dir, 'feedback-log.jsonl');
  const previous = {
    feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
    out: process.env.THUMBGATE_RECENT_THUMBS_PATH,
  };
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  process.env.THUMBGATE_RECENT_THUMBS_PATH = outPath;
  try {
    const record = {
      id: 'fb_test_one',
      signal: 'down',
      timestamp: '2026-11-12T19:42:00.000Z',
      whatWentWrong: `The gate emailed ${EMAIL} at ${PHONE} with token ${TOKEN}.`,
      whatToChange: 'The gate keeps addresses and tokens off the thumb line.',
      context: 'harness transcript that must stay off the line',
    };
    fs.writeFileSync(logPath, `${JSON.stringify(record)}\n${JSON.stringify(record)}\n`);
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const { syncRecentThumbsFromLog } = require('../scripts/feedback-loop');
    assert.equal(syncRecentThumbsFromLog(logPath), true);
    const lines = bulletLines(outPath);
    assert.deepEqual(lines, [
      '- 2026-11-12 2:42 PM, down: The gate emailed [REDACTED:email] at [REDACTED:phone] with token [REDACTED:github_pat]. Corrected claim: The gate keeps addresses and tokens off the thumb line.',
    ]);
    const body = fs.readFileSync(outPath, 'utf8');
    assert.equal(body.includes(EMAIL), false);
    assert.equal(body.includes(PHONE), false);
    assert.equal(body.includes(TOKEN), false);
    assert.equal(body.includes('harness transcript'), false);
    assert.equal(syncRecentThumbsFromLog(logPath), false);
    assert.equal(bulletLines(outPath).length, 1);
  } finally {
    if (previous.feedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = previous.feedbackDir;
    if (previous.out === undefined) delete process.env.THUMBGATE_RECENT_THUMBS_PATH;
    else process.env.THUMBGATE_RECENT_THUMBS_PATH = previous.out;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a capture append rewrites the same scrubbed file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recent-thumbs-capture-'));
  const outPath = path.join(dir, 'RECENT-THUMBS.md');
  const previous = {
    feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
    out: process.env.THUMBGATE_RECENT_THUMBS_PATH,
    telemetry: process.env.THUMBGATE_DISABLE_TELEMETRY,
    nudge: process.env.THUMBGATE_NO_NUDGE,
    history: process.env.THUMBGATE_DISABLE_CLAUDE_HISTORY_SYNC,
  };
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  process.env.THUMBGATE_RECENT_THUMBS_PATH = outPath;
  process.env.THUMBGATE_DISABLE_TELEMETRY = '1';
  process.env.THUMBGATE_NO_NUDGE = '1';
  process.env.THUMBGATE_DISABLE_CLAUDE_HISTORY_SYNC = '1';
  try {
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const { captureFeedback } = require('../scripts/feedback-loop');
    captureFeedback({
      signal: 'down',
      context: 'temp capture',
      whatWentWrong: `The note included ${EMAIL} and ${PHONE} and ${TOKEN}.`,
      whatToChange: 'Keep the note to the corrected claim.',
      tags: ['testing'],
      reviewOrigin: 'human',
    });
    const lines = bulletLines(outPath);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].includes('[REDACTED:email]'), true);
    assert.equal(lines[0].includes('[REDACTED:phone]'), true);
    assert.equal(lines[0].includes('[REDACTED:github_pat]'), true);
    assert.equal(lines[0].includes('Corrected claim:'), true);
    assert.equal(fs.readFileSync(outPath, 'utf8').includes(EMAIL), false);
    assert.equal(fs.readFileSync(outPath, 'utf8').includes(TOKEN), false);
  } finally {
    const restore = (key, value) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('THUMBGATE_FEEDBACK_DIR', previous.feedbackDir);
    restore('THUMBGATE_RECENT_THUMBS_PATH', previous.out);
    restore('THUMBGATE_DISABLE_TELEMETRY', previous.telemetry);
    restore('THUMBGATE_NO_NUDGE', previous.nudge);
    restore('THUMBGATE_DISABLE_CLAUDE_HISTORY_SYNC', previous.history);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
