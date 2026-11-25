'use strict';

// AGENT-3667, 24 Nov 2026 (faults brief, item B): lessons must show before the first tool call, not after the miss.
// Runs the real UserPromptSubmit command (bin/cli.js hook-auto-capture) on a "sign a dotloop form" prompt.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-prompt-lessons-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmp;
process.env.THUMBGATE_NO_RATE_LIMIT = '1';

const { captureFeedback } = require('../scripts/feedback-loop');
const promptLessons = require('../scripts/prompt-lessons');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const capture = (tags, wrong, change) => captureFeedback({
  signal: 'down', reviewOrigin: 'human', tags, context: `Igor: thumbs down. ${wrong}`, whatWentWrong: wrong, whatToChange: change,
});

test('setup: store three dotloop lessons and one unrelated lesson', () => {
  assert.equal(capture(['dotloop'], 'The agent signed a dotloop form before the buyer initialed page two.', 'Check initials on every page before signing a dotloop form.').accepted, true);
  assert.equal(capture(['dotloop'], 'The agent sent a dotloop form to the wrong signer.', 'Confirm the signer against the contact file before sending a dotloop form.').accepted, true);
  assert.equal(capture(['dotloop'], 'The agent voided a dotloop loop that was waiting on a lender document.', 'Never void a dotloop loop without asking who is waiting on it.').accepted, true);
  assert.equal(capture(['railway'], 'The agent called the Railway deploy live before curling health.', 'Curl the health endpoint before saying a Railway deploy is live.').accepted, true);
});

test('the real hook prints the dotloop lessons for a dotloop prompt and logs each injection', () => {
  const input = JSON.stringify({ session_id: 'sess_test_1', cwd: ROOT, prompt: 'Please sign a dotloop form for the Pilarte contract' });
  const out = execFileSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'hook-auto-capture'], {
    cwd: ROOT, input, encoding: 'utf8', env: { ...process.env, PWD: ROOT, CLAUDE_USER_PROMPT: '', THUMBGATE_USER_PROMPT: '' },
  });
  assert.match(out, /ThumbGate lessons that match this task/);
  const numbered = out.split('\n').filter((line) => /^\d\. /.test(line));
  assert.equal(numbered.length, 3, out);
  assert.ok(numbered.every((line) => /dotloop/i.test(line)), `a non-dotloop lesson was injected:\n${out}`);
  assert.doesNotMatch(out, /Railway/);
  const log = fs.readFileSync(path.join(tmp, promptLessons.INJECTION_LOG), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(log.length, 3);
  assert.ok(log.every((row) => row.surface === 'prompt' && row.sessionId === 'sess_test_1' && row.lessonId.startsWith('mem_')));
});

test('a prompt with no matching topic injects nothing and logs nothing', () => {
  const before = fs.readFileSync(path.join(tmp, promptLessons.INJECTION_LOG), 'utf8').split('\n').filter(Boolean).length;
  const out = execFileSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'hook-auto-capture'], {
    cwd: ROOT, input: JSON.stringify({ session_id: 'sess_test_2', cwd: ROOT, prompt: 'Explain how photosynthesis works' }), encoding: 'utf8', env: { ...process.env, PWD: ROOT, CLAUDE_USER_PROMPT: '', THUMBGATE_USER_PROMPT: '' },
  });
  assert.doesNotMatch(out, /ThumbGate lessons/);
  assert.equal(fs.readFileSync(path.join(tmp, promptLessons.INJECTION_LOG), 'utf8').split('\n').filter(Boolean).length, before);
});

test('selectPromptLessons ignores pruned lessons and one stray shared word', () => {
  const lessons = [
    { id: 'a', tags: ['dotloop'], whatToChange: 'Check initials before signing.' },
    { id: 'b', tags: ['dotloop'], pruned: true, whatToChange: 'Pruned lesson about dotloop.' },
    { id: 'c', tags: ['misc'], whatToChange: 'Always verify the contract total.' },
  ];
  assert.deepEqual(promptLessons.selectPromptLessons(lessons, 'sign a dotloop form').map((l) => l.id), ['a']);
  assert.deepEqual(promptLessons.selectPromptLessons(lessons, 'review the contract please'), []);
});
