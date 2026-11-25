'use strict';

// AGENT-3667, 24 Nov 2026 (faults brief E1/F2): a typed thumbs-down says "that was wrong" but names no command, so
// auto-promotion never had an action to build a gate from (three identical thumbs-downs on `rm -rf tests/` made zero
// gates). The pre-action hook records each shell command it lets through; the thumbs-down hook reads the latest one
// for the same session and attaches it as `failedCommand`.
const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'recent-commands.jsonl';
const KEEP_LINES = 60;
const MAX_COMMAND_CHARS = 400;
const DEFAULT_WINDOW_MS = 20 * 60 * 1000;

function filePath(feedbackDir) {
  return path.join(feedbackDir, FILE_NAME);
}

function readRows(feedbackDir) {
  let text = '';
  try { text = fs.readFileSync(filePath(feedbackDir), 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn line is skipped */ }
  }
  return rows;
}

function recordCommand({ feedbackDir, sessionId = '', command, now = Date.now() }) {
  const text = String(command || '').trim();
  if (!feedbackDir || text.length < 4 || text.length > MAX_COMMAND_CHARS) return false;
  fs.mkdirSync(feedbackDir, { recursive: true });
  const rows = readRows(feedbackDir);
  rows.push({ at: now, sessionId: String(sessionId || ''), command: text });
  const kept = rows.slice(-KEEP_LINES);
  fs.writeFileSync(filePath(feedbackDir), `${kept.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  return true;
}

// Same session wins. A row with no session id (Cursor's hook has none) matches any caller, so a lone user still works.
function lastCommand({ feedbackDir, sessionId = '', withinMs = DEFAULT_WINDOW_MS, now = Date.now() }) {
  const rows = readRows(feedbackDir).filter((row) => now - row.at <= withinMs && row.at <= now + 5000);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row.sessionId || !sessionId || row.sessionId === sessionId) return row.command;
  }
  return null;
}

module.exports = { FILE_NAME, DEFAULT_WINDOW_MS, recordCommand, lastCommand, readRows };
