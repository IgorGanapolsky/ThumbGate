'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');

function makeFeedbackDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-feedback-e2e-'));
}

function runHook(feedbackDir, payload) {
  const env = {
    ...process.env,
    THUMBGATE_FEEDBACK_DIR: feedbackDir,
    THUMBGATE_NO_NUDGE: '1',
    THUMBGATE_NO_TELEMETRY: '1',
    THUMBGATE_DISABLE_CLAUDE_HISTORY_SYNC: '1',
  };
  delete env.CLAUDE_USER_PROMPT;
  delete env.THUMBGATE_USER_PROMPT;
  delete env.CODEX_USER_PROMPT;
  delete env.USER_PROMPT;
  return spawnSync(process.execPath, [CLI, 'hook-auto-capture'], {
    cwd: ROOT,
    env,
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

test('UserPromptSubmit thumbs up is durably stored and acknowledged in the same turn', (t) => {
  const feedbackDir = makeFeedbackDir();
  t.after(() => fs.rmSync(feedbackDir, { recursive: true, force: true }));
  const result = runHook(feedbackDir, {
    hook_event_name: 'UserPromptSubmit', session_id: 'session-up', prompt_id: 'prompt-up', cwd: ROOT, prompt: '👍',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Thumbs up recorded/);
  assert.match(result.stdout, /Feedback ID: fb_/);
  assert.match(result.stdout, /Reusable memory: not created/);
  const events = readJsonl(path.join(feedbackDir, 'feedback-log.jsonl'));
  assert.equal(events.length, 1);
  assert.equal(events[0].signal, 'positive');
  assert.match(events[0].sourceEvent.key, /^fev_[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(path.join(feedbackDir, 'memory-log.jsonl')), false);
});

test('UserPromptSubmit thumbs down stores a negative event and corrective memory', (t) => {
  const feedbackDir = makeFeedbackDir();
  t.after(() => fs.rmSync(feedbackDir, { recursive: true, force: true }));
  const result = runHook(feedbackDir, {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'session-down',
    prompt_id: 'prompt-down',
    cwd: ROOT,
    prompt: '👎 The agent skipped tests before claiming success; run the relevant tests before replying.',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Thumbs down recorded/);
  assert.match(result.stdout, /Memory ID\s+: mem_/);
  const events = readJsonl(path.join(feedbackDir, 'feedback-log.jsonl'));
  const memories = readJsonl(path.join(feedbackDir, 'memory-log.jsonl'));
  assert.equal(events.length, 1);
  assert.equal(events[0].signal, 'negative');
  assert.equal(events[0].actionType, 'store-mistake');
  assert.equal(memories.length, 1);
  assert.equal(memories[0].sourceFeedbackId, events[0].id);
  assert.match(memories[0].content, /How to avoid|tests before claiming/i);
});

test('duplicate hook delivery links to the original feedback instead of storing twice', (t) => {
  const feedbackDir = makeFeedbackDir();
  t.after(() => fs.rmSync(feedbackDir, { recursive: true, force: true }));
  const payload = {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'session-dupe',
    prompt_id: 'prompt-dupe',
    cwd: ROOT,
    prompt: 'thumbs up the evidence was exact and reproducible',
  };
  const first = runHook(feedbackDir, payload);
  const second = runHook(feedbackDir, payload);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  const events = readJsonl(path.join(feedbackDir, 'feedback-log.jsonl'));
  const memories = readJsonl(path.join(feedbackDir, 'memory-log.jsonl'));
  assert.equal(events.length, 1);
  assert.equal(memories.length, 1);
  assert.match(first.stdout, new RegExp(events[0].id));
  assert.match(second.stdout, new RegExp(events[0].id));
  assert.match(second.stdout, /already captured/i);
});

test('duplicate bare emoji delivery reuses one privacy-safe feedback event', (t) => {
  const feedbackDir = makeFeedbackDir();
  t.after(() => fs.rmSync(feedbackDir, { recursive: true, force: true }));
  const payload = {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'session-bare-dupe',
    prompt_id: 'prompt-bare-dupe',
    cwd: ROOT,
    prompt: '👍',
  };
  const first = runHook(feedbackDir, payload);
  const second = runHook(feedbackDir, payload);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  const events = readJsonl(path.join(feedbackDir, 'feedback-log.jsonl'));
  assert.equal(events.length, 1);
  assert.match(events[0].sourceEvent.key, /^fev_[a-f0-9]{64}$/);
  assert.match(first.stdout, new RegExp(events[0].id));
  assert.match(second.stdout, new RegExp(events[0].id));
  assert.match(second.stdout, /already captured/i);
  assert.equal(fs.existsSync(path.join(feedbackDir, 'memory-log.jsonl')), false);
});
