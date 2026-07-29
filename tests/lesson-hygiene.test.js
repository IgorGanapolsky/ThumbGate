'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isRawHookPayload,
  filterRetrievedLessons,
  stripJsonSpans,
  MIN_PROSE_CHARS,
} = require('../scripts/lesson-hygiene');

const PURE_PAYLOAD = JSON.stringify({
  session_id: 'sess-0157-abc',
  transcript_path: '/tmp/claude/transcripts/0157.jsonl',
  hookEventName: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'git push --force origin main' },
  cwd: '/Users/op/project',
});

const PROSE_150 = 'The hook fired before the push and we learned that force-pushing to main '
  + 'destroys shared history. Always create a branch and open a PR instead of rewriting main.';

describe('isRawHookPayload', () => {
  test('pure hook payload is junk', () => {
    assert.equal(isRawHookPayload(PURE_PAYLOAD), true);
  });

  test('payload quoted alongside 150 chars of prose is kept', () => {
    assert.ok(PROSE_150.length >= 150);
    assert.equal(isRawHookPayload(`${PROSE_150}\nOffending payload was: ${PURE_PAYLOAD}`), false);
  });

  test('normal lesson is kept', () => {
    assert.equal(
      isRawHookPayload('NEVER claim deployed without curling /health and showing the version output.'),
      false,
    );
  });

  test('unparseable garbage payload line is junk', () => {
    const truncated = '{"session_id":"sess-9","transcript_path":"/tmp/claude/t.jsonl","hookEventName":"PreT';
    assert.equal(isRawHookPayload(truncated), true);
  });

  test('marker-free JSON tool input is not junk', () => {
    assert.equal(isRawHookPayload('{"filePath":"AGENTS.md","reason":"docs"}'), false);
  });

  test('empty and non-string inputs are not junk', () => {
    assert.equal(isRawHookPayload(''), false);
    assert.equal(isRawHookPayload(null), false);
    assert.equal(isRawHookPayload(undefined), false);
  });
});

describe('stripJsonSpans', () => {
  test('removes balanced and dangling JSON spans, keeps outside prose', () => {
    assert.equal(stripJsonSpans('keep {"a":1} this').replace(/\s+/g, ' ').trim(), 'keep this');
    assert.equal(stripJsonSpans('prose {"unclosed":').trim(), 'prose');
  });
});

describe('filterRetrievedLessons', () => {
  test('drops payload items, keeps lessons, preserves order', () => {
    const items = [
      { id: 'a', content: 'ALWAYS run gh pr view before claiming done.' },
      { id: 'junk', content: PURE_PAYLOAD },
      { id: 'b', whatWentWrong: 'Pushed without tests; CI went red on main.' },
    ];
    const kept = filterRetrievedLessons(items);
    assert.deepEqual(kept.map((i) => i.id), ['a', 'b']);
  });

  test('honors a custom textOf extractor', () => {
    const items = [{ id: 'x', payload: PURE_PAYLOAD }];
    assert.equal(filterRetrievedLessons(items, (i) => i.payload).length, 0);
    assert.equal(filterRetrievedLessons(items).length, 1);
  });

  test('non-array input returns empty array', () => {
    assert.deepEqual(filterRetrievedLessons(null), []);
  });
});

describe('ingestion gate quarantines raw payload feedback entries', () => {
  test('appendJSONL routes payload entries to feedback-log.quarantine.jsonl', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-hygiene-gate-'));
    try {
      const { appendJSONL } = require('../scripts/feedback-loop');
      const logPath = path.join(dir, 'feedback-log.jsonl');

      appendJSONL(logPath, {
        id: 'fb_junk',
        signal: 'negative',
        context: PURE_PAYLOAD,
        whatWentWrong: null,
        whatWorked: null,
      });
      appendJSONL(logPath, {
        id: 'fb_real',
        signal: 'negative',
        context: 'Claimed deployed without verifying production',
        whatWentWrong: 'Skipped the /health curl',
        whatWorked: null,
      });

      const quarantinePath = path.join(dir, 'feedback-log.quarantine.jsonl');
      assert.ok(fs.existsSync(quarantinePath), 'quarantine file should exist');
      const quarantined = fs.readFileSync(quarantinePath, 'utf8').trim().split('\n').map(JSON.parse);
      assert.equal(quarantined.length, 1);
      assert.equal(quarantined[0].id, 'fb_junk');

      const logged = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
      assert.equal(logged.length, 1);
      assert.equal(logged[0].id, 'fb_real');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('MIN_PROSE_CHARS boundary is what the gate documents', () => {
    assert.equal(MIN_PROSE_CHARS, 100);
  });
});
