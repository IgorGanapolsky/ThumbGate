'use strict';

// 27 Nov 2026 (trust.3): a thumbs-down answered "Prevention rules will auto-update" although nothing new blocked.
// It must say plainly that the saved lesson is advice only. A thumbs-up says nothing about blocking.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-capture-advice-'));
const env = { HOME: dir, USERPROFILE: dir, THUMBGATE_FEEDBACK_DIR: dir, THUMBGATE_NO_TELEMETRY: '1' };
Object.assign(process.env, env);
const { captureFeedback } = require('../scripts/feedback-loop');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const DOWN = {
  signal: 'down',
  context: 'that was wrong, the weekly email used the wrong greeting',
  whatWentWrong: 'wrong greeting in the weekly email',
  whatToChange: 'read the greeting from the customer record',
  tags: ['email'],
};
const ADVICE = /advice only: it blocks nothing until a gate is built from it/i;

test('a thumbs-down result says the lesson is advice only', () => {
  assert.match(captureFeedback(DOWN).message, ADVICE);
  const up = captureFeedback({ signal: 'up', context: 'the release notes were clear and complete', whatWorked: 'listed every change with its proof', tags: ['release'] });
  assert.doesNotMatch(up.message, ADVICE);
});

test('the capture command prints the same and promises no automatic rule', () => {
  const script = path.join(__dirname, '..', '.claude', 'scripts', 'feedback', 'capture-feedback.js');
  const out = spawnSync(process.execPath, [script, '--feedback=down', '--context=that was wrong, the invoice total was not checked',
    '--what-went-wrong=invoice total not checked', '--what-to-change=add up the lines before sending', '--tags=billing'],
  { cwd: dir, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 90000 }).stdout;
  assert.match(out, ADVICE);
  assert.doesNotMatch(out, /auto-update/);
});
