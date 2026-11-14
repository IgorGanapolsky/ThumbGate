'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { dedupeSessionContext } = require('../scripts/session-context-dedupe');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dedupe-'));
}

test('same lessons twice in one session inject nothing the second time', () => {
  const dir = tmpDir();
  const text = '[ThumbGate] Recurring failure patterns (enforce these):\n  - never force push';
  assert.equal(dedupeSessionContext('sess-a', text, { dir }), text);
  assert.equal(dedupeSessionContext('sess-a', text, { dir }), null);
  assert.equal(dedupeSessionContext('sess-a', text, { dir }), null);
});

test('changed lessons inject again, then dedupe against the new text', () => {
  const dir = tmpDir();
  assert.equal(dedupeSessionContext('sess-a', 'one', { dir }), 'one');
  assert.equal(dedupeSessionContext('sess-a', 'two', { dir }), 'two');
  assert.equal(dedupeSessionContext('sess-a', 'two', { dir }), null);
});

test('another session still receives the same text', () => {
  const dir = tmpDir();
  assert.equal(dedupeSessionContext('sess-a', 'same', { dir }), 'same');
  assert.equal(dedupeSessionContext('sess-b', 'same', { dir }), 'same');
});

test('no session id means no dedupe', () => {
  const dir = tmpDir();
  assert.equal(dedupeSessionContext('', 'same', { dir }), 'same');
  assert.equal(dedupeSessionContext('', 'same', { dir }), 'same');
});

test('gate engine: matching lesson injects every time, static context only once', () => {
  const dir = tmpDir();
  process.env.THUMBGATE_CONTEXT_DEDUPE_DIR = dir;
  try {
    const gates = require('../scripts/gates-engine');
    assert.equal(typeof gates.combineWithSessionDedupe, 'function');
    const input = { session_id: 'sess-gate', tool_name: 'Bash' };
    const first = gates.combineWithSessionDedupe(input, 'LESSON', 'RECENT', 'PATTERNS', null);
    assert.equal(first, 'LESSON\n\nRECENT\n\nPATTERNS');
    const second = gates.combineWithSessionDedupe(input, 'LESSON', 'RECENT', 'PATTERNS', null);
    assert.equal(second, 'LESSON');
    const third = gates.combineWithSessionDedupe(input, null, 'RECENT', 'PATTERNS', null);
    assert.equal(third, null);
    const changed = gates.combineWithSessionDedupe(input, null, 'RECENT2', 'PATTERNS', null);
    assert.equal(changed, 'RECENT2\n\nPATTERNS');
  } finally {
    delete process.env.THUMBGATE_CONTEXT_DEDUPE_DIR;
  }
});
