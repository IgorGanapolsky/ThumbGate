'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeFeedbackText,
  transportWordsOnly,
  looksLikeTransportBlob,
  extractPromptEnvelope,
  extractPromptText,
} = require('../scripts/feedback-sanitizer');

// The EXACT session-metadata blob observed polluting the lesson store: raw
// UserPromptSubmit hook stdin promoted verbatim as a "lesson". It survived the
// old TRANSPORT_WORDS denylist because it also contains non-transport path
// fragments ("workspace", "git", the repo name, "jsonl").
const POLLUTION_BLOB = '{"session_id":"1234cc85-2b12-4d92-8cd6-a9033f0d0efc","transcript_path":"/Users/igorganapolsky/.claude/projects/x/1234.jsonl","cwd":"/Users/igorganapolsky/workspace/git/igor/ThumbGate","prompt_id":"3d80d"}';

test('sanitizeFeedbackText REJECTS the raw session-metadata blob', () => {
  assert.equal(sanitizeFeedbackText(POLLUTION_BLOB), '');
});

test('looksLikeTransportBlob flags the blob (JSON payload)', () => {
  assert.equal(looksLikeTransportBlob(POLLUTION_BLOB), true);
});

test('looksLikeTransportBlob flags camelCase hook envelopes', () => {
  const payload = JSON.stringify({
    sessionId: 'session-1',
    transcriptPath: '/tmp/session.jsonl',
    hookEventName: 'UserPromptSubmit',
  });
  assert.equal(looksLikeTransportBlob(payload), true);
  assert.equal(sanitizeFeedbackText(payload), '');
});

test('transportWordsOnly treats the blob as transport-only', () => {
  assert.equal(transportWordsOnly(POLLUTION_BLOB), true);
});

test('a non-JSON blob carrying transport markers is still rejected', () => {
  const markerText = 'session_id 1234cc85 transcript_path /Users/x/a.jsonl prompt_id 3d80d';
  assert.equal(sanitizeFeedbackText(markerText), '');
});

test('a path-dominated blob is rejected', () => {
  const pathText = '/Users/igorganapolsky/workspace/git/igor/ThumbGate /Users/igorganapolsky/.claude/projects/x/1234.jsonl';
  assert.equal(sanitizeFeedbackText(pathText), '');
});

test('a normal human prompt SURVIVES sanitization', () => {
  const prompt = 'cut the railway bill';
  assert.equal(sanitizeFeedbackText(prompt), 'cut the railway bill');
  assert.equal(looksLikeTransportBlob(prompt), false);
  assert.equal(transportWordsOnly(prompt), false);
});

test('a tool action with one path token SURVIVES sanitization', () => {
  const context = 'Edit /var/src/foo.js';
  assert.equal(sanitizeFeedbackText(context), context);
  assert.equal(looksLikeTransportBlob(context), false);
});

test('ordinary JSON tool input SURVIVES sanitization', () => {
  const toolInput = '{"filePath":"AGENTS.md","reason":"protected file scope creep"}';
  assert.equal(sanitizeFeedbackText(toolInput), toolInput);
  assert.equal(looksLikeTransportBlob(toolInput), false);
});

test('a human sentence that names one transport key SURVIVES sanitization', () => {
  const sentence = 'do not expose the session_id field in logs';
  assert.equal(sanitizeFeedbackText(sentence), sentence);
  assert.equal(looksLikeTransportBlob(sentence), false);
});

test('extractPromptText pulls ONLY the .prompt field from a hook payload', () => {
  const payload = JSON.stringify({
    session_id: '1234cc85-2b12-4d92-8cd6-a9033f0d0efc',
    transcript_path: '/Users/igorganapolsky/.claude/projects/x/1234.jsonl',
    cwd: '/Users/igorganapolsky/workspace/git/igor/ThumbGate',
    hook_event_name: 'UserPromptSubmit',
    prompt: 'cut the railway bill',
  });
  assert.equal(extractPromptText(payload), 'cut the railway bill');
});

test('extractPromptEnvelope separates source identity fields from human lesson text', () => {
  const envelope = extractPromptEnvelope(JSON.stringify({
    session_id: 'session-123',
    prompt_id: 'prompt-456',
    cwd: '/tmp/project',
    hook_event_name: 'UserPromptSubmit',
    timestamp: 1775750156301,
    transcript_path: '/tmp/transcript.jsonl',
    prompt: 'thumbs up Evidence was clear',
  }));
  assert.deepEqual(envelope, {
    prompt: 'thumbs up Evidence was clear',
    sessionId: 'session-123',
    promptId: 'prompt-456',
    projectDir: '/tmp/project',
    timestamp: '1775750156301',
    hookEventName: 'UserPromptSubmit',
  });
  assert.equal(Object.hasOwn(envelope, 'transcriptPath'), false);
});

test('extractPromptText yields no text for a metadata-only payload (no .prompt)', () => {
  assert.equal(extractPromptText(POLLUTION_BLOB), '');
});

test('extractPromptText passes through a genuine plain-text prompt', () => {
  assert.equal(extractPromptText('cut the railway bill'), 'cut the railway bill');
});

test('end-to-end: extracted prompt survives sanitization; metadata does not', () => {
  const payload = JSON.stringify({
    session_id: 'abc',
    transcript_path: '/Users/x/.claude/y.jsonl',
    cwd: '/Users/x/workspace/git/igor/ThumbGate',
    prompt: 'the checkout bypass sent users to the wrong product',
  });
  const humanText = extractPromptText(payload);
  assert.equal(sanitizeFeedbackText(humanText), 'the checkout bypass sent users to the wrong product');
  // The raw payload itself must never survive.
  assert.equal(sanitizeFeedbackText(payload), '');
});
