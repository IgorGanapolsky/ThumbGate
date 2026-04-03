#!/usr/bin/env node
/**
 * Feedback Inbox Reader
 *
 * Reads new feedback entries from the inbox JSONL file, using a cursor
 * to avoid reprocessing. External systems (Phoenix bridge, other agents)
 * append feedback signals to the inbox; Amp's reflexion-preflight skill
 * calls this script each turn to ingest new signals.
 *
 * Usage:
 *   node scripts/feedback-inbox-read.js              # output new entries as JSON array
 *   node scripts/feedback-inbox-read.js --peek        # show count without advancing cursor
 *   node scripts/feedback-inbox-read.js --reset       # reset cursor to re-read all
 *   node scripts/feedback-inbox-read.js --test        # run built-in tests
 *
 * Inbox:  .claude/feedback-loop/inbox.jsonl
 * Cursor: .claude/feedback-loop/inbox.cursor.json
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const INBOX_PATH = path.join(PROJECT_ROOT, '.claude', 'feedback-loop', 'inbox.jsonl');
const CURSOR_PATH = path.join(PROJECT_ROOT, '.claude', 'feedback-loop', 'inbox.cursor.json');

function readInbox() {
  if (!fs.existsSync(INBOX_PATH)) return [];
  const raw = fs.readFileSync(INBOX_PATH, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line, idx) => {
    try {
      return { _lineIndex: idx, ...JSON.parse(line) };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function loadCursor() {
  if (!fs.existsSync(CURSOR_PATH)) return { lastLineIndex: -1 };
  try {
    return JSON.parse(fs.readFileSync(CURSOR_PATH, 'utf-8'));
  } catch {
    return { lastLineIndex: -1 };
  }
}

function saveCursor(cursor) {
  const dir = path.dirname(CURSOR_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CURSOR_PATH, JSON.stringify(cursor, null, 2) + '\n');
}

function getNewEntries(advance) {
  const entries = readInbox();
  if (entries.length === 0) return [];

  const cursor = loadCursor();
  const newEntries = entries.filter((e) => e._lineIndex > cursor.lastLineIndex);

  if (advance && newEntries.length > 0) {
    const maxIdx = Math.max(...newEntries.map((e) => e._lineIndex));
    saveCursor({ lastLineIndex: maxIdx, updatedAt: new Date().toISOString() });
  }

  // Strip internal _lineIndex before returning
  return newEntries.map(({ _lineIndex, ...rest }) => rest);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function runTests() {
  const os = require('os');
  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}`); }
  }

  console.log('\n🧪 feedback-inbox-read.js — Tests\n');

  // Setup temp inbox
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-test-'));
  const tmpInbox = path.join(tmpDir, 'inbox.jsonl');
  const tmpCursor = path.join(tmpDir, 'inbox.cursor.json');

  // Write test entries
  const entries = [
    { signal: 'negative', context: 'Bad thing happened', tags: ['testing'] },
    { signal: 'positive', context: 'Good thing happened', tags: ['testing'] },
    { signal: 'negative', context: 'Another bad thing', tags: ['rlhf'] },
  ];
  fs.writeFileSync(tmpInbox, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

  // Test reading all (no cursor)
  const allEntries = (() => {
    const raw = fs.readFileSync(tmpInbox, 'utf-8').trim();
    return raw.split('\n').map((line, idx) => {
      try { return { _lineIndex: idx, ...JSON.parse(line) }; }
      catch { return null; }
    }).filter(Boolean);
  })();
  assert(allEntries.length === 3, 'reads all 3 entries from inbox');

  // Test cursor-based filtering
  fs.writeFileSync(tmpCursor, JSON.stringify({ lastLineIndex: 0 }));
  const afterFirst = allEntries.filter((e) => e._lineIndex > 0);
  assert(afterFirst.length === 2, 'cursor at 0 → 2 new entries');

  fs.writeFileSync(tmpCursor, JSON.stringify({ lastLineIndex: 2 }));
  const afterAll = allEntries.filter((e) => e._lineIndex > 2);
  assert(afterAll.length === 0, 'cursor at 2 → 0 new entries');

  // Test loadCursor with missing file
  const missingCursor = path.join(tmpDir, 'missing.cursor.json');
  const fakeMod = { loadCursor: () => {
    if (!fs.existsSync(missingCursor)) return { lastLineIndex: -1 };
    try { return JSON.parse(fs.readFileSync(missingCursor, 'utf-8')); } catch { return { lastLineIndex: -1 }; }
  }};
  assert(fakeMod.loadCursor().lastLineIndex === -1, 'loadCursor returns -1 for missing file');

  // Test saveCursor creates directory
  const deepDir = path.join(tmpDir, 'deep', 'nested');
  const deepCursor = path.join(deepDir, 'cursor.json');
  if (!fs.existsSync(deepDir)) fs.mkdirSync(deepDir, { recursive: true });
  fs.writeFileSync(deepCursor, JSON.stringify({ lastLineIndex: 5, updatedAt: new Date().toISOString() }) + '\n');
  const loaded = JSON.parse(fs.readFileSync(deepCursor, 'utf-8'));
  assert(loaded.lastLineIndex === 5, 'saveCursor persists cursor value');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'═'.repeat(50)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

if (require.main === module) {
  if (process.argv.includes('--test')) {
    runTests();
  } else if (process.argv.includes('--reset')) {
    if (fs.existsSync(CURSOR_PATH)) fs.unlinkSync(CURSOR_PATH);
    console.log('Cursor reset.');
  } else {
    const peek = process.argv.includes('--peek');
    const entries = getNewEntries(!peek);
    if (entries.length === 0) {
      // Silent — no new entries
      process.exit(0);
    }
    process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
  }
}

module.exports = { getNewEntries, readInbox, loadCursor, saveCursor, INBOX_PATH, CURSOR_PATH };
