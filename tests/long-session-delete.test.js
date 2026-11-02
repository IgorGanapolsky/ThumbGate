'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  assessLongSessionDeletion,
  isDeletionCommand,
} = require('../scripts/hook-pre-tool-use');

const HOOK = path.join(__dirname, '..', 'scripts', 'hook-pre-tool-use.js');

function userLine(text) {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  });
}

function toolResultLine() {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
  });
}

function writeTranscript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-long-session-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

test('isDeletionCommand matches a delete and ignores a mention of rm', () => {
  assert.equal(isDeletionCommand('rm -rf /tmp/scratch'), true);
  assert.equal(isDeletionCommand('echo rm foo'), false);
  assert.equal(isDeletionCommand('git status'), false);
});

test('a delete before 20 user turns is allowed', () => {
  const transcriptPath = writeTranscript(Array.from({ length: 19 }, (_, i) => userLine(`turn ${i}`)));
  const result = assessLongSessionDeletion({
    transcriptPath,
    toolName: 'Bash',
    toolInput: { command: 'rm -rf /tmp/scratch' },
    externalVerification: false,
  });
  assert.equal(result.decision, 'allow');
  assert.equal(result.reason, 'under_turn_floor');
});

test('a delete at 20 user turns waits for a separate check', () => {
  const transcriptPath = writeTranscript(Array.from({ length: 20 }, (_, i) => userLine(`turn ${i}`)));
  const blocked = assessLongSessionDeletion({
    transcriptPath,
    toolName: 'Bash',
    toolInput: { command: 'rm -rf /tmp/scratch' },
    externalVerification: false,
  });
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.message, /20 user turns/);

  const allowed = assessLongSessionDeletion({
    transcriptPath,
    toolName: 'Bash',
    toolInput: { command: 'rm -rf /tmp/scratch' },
    externalVerification: true,
  });
  assert.equal(allowed.decision, 'allow');
  assert.equal(allowed.reason, 'external_verification_present');
});

test('tool results do not count as user turns', () => {
  const lines = [
    ...Array.from({ length: 19 }, (_, i) => userLine(`turn ${i}`)),
    ...Array.from({ length: 30 }, () => toolResultLine()),
  ];
  const transcriptPath = writeTranscript(lines);
  const result = assessLongSessionDeletion({
    transcriptPath,
    toolName: 'Bash',
    toolInput: { command: 'rm /tmp/scratch' },
  });
  assert.equal(result.decision, 'allow');
  assert.equal(result.reason, 'under_turn_floor');
});

test('the PreToolUse hook blocks that delete and allows a non-delete', () => {
  const transcriptPath = writeTranscript(Array.from({ length: 20 }, (_, i) => userLine(`turn ${i}`)));
  const blocked = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      session_id: 'long-session-delete',
      transcript_path: transcriptPath,
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /tmp/scratch' },
      hook_event_name: 'PreToolUse',
      cwd: os.tmpdir(),
    }),
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(blocked.status, 0, blocked.stderr);
  const blockedOut = JSON.parse((blocked.stdout || '').trim());
  assert.equal(blockedOut.decision, 'block');
  assert.match(blockedOut.reason, /20 user turns/);

  const allowed = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      session_id: 'long-session-delete',
      transcript_path: transcriptPath,
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
      hook_event_name: 'PreToolUse',
      cwd: os.tmpdir(),
    }),
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(allowed.status, 0, allowed.stderr);
  const allowedText = (allowed.stdout || '').trim();
  if (allowedText) {
    const allowedOut = JSON.parse(allowedText);
    assert.notEqual(allowedOut.decision, 'block');
  }
});
