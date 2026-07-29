'use strict';

// Feedback → action attribution, derived at capture time.
//
// The `lastAction` field existed since #203 and was populated exactly 0 times in 1,793
// production entries, because every capture surface omitted it. Without it, feedback can
// never be joined to the action that earned it — which is why the retrieval golden set
// could not be built (an offline trace-join recovered 7 usable pairs out of 384 lessons).
// These tests pin the derivation: present when the audit trail has a recent action,
// honest null when it does not, never a crash, and the caller's explicit value wins.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { recentAuditedAction } = require('../scripts/audit-trail.js');

function auditFile(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-attr-'));
  const file = path.join(dir, 'audit-trail.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

const NOW = Date.parse('2026-07-29T12:00:00.000Z');
const at = (secondsAgo) => new Date(NOW - secondsAgo * 1000).toISOString();

test('derives the most recent tool action inside the window', () => {
  const file = auditFile([
    { toolName: 'Bash', toolInput: { command: 'npm test' }, decision: 'allow', timestamp: at(240), id: 'a1' },
    { toolName: 'Bash', toolInput: { command: 'git push --force origin main' }, decision: 'deny', timestamp: at(30), id: 'a2' },
  ]);
  const action = recentAuditedAction({ nowMs: NOW, auditPath: file });
  assert.equal(action.command, 'git push --force origin main');
  assert.equal(action.auditId, 'a2');
  assert.equal(action.decision, 'deny');
  assert.equal(action.derivedFrom, 'audit-trail');
  assert.ok(action.ageMs >= 29_000 && action.ageMs <= 31_000);
});

test('returns null — not a stale action — when nothing is inside the window', () => {
  const file = auditFile([
    { toolName: 'Bash', toolInput: { command: 'old command' }, timestamp: at(600), id: 'a1' },
  ]);
  assert.equal(recentAuditedAction({ nowMs: NOW, auditPath: file }), null,
    'a 10-minute-old action must not be attributed to fresh feedback');
});

test('skips non-action tools and corrupt lines without failing', () => {
  const file = auditFile([
    { toolName: 'Bash', toolInput: { command: 'the real one' }, timestamp: at(60), id: 'a1' },
  ]);
  fs.appendFileSync(file, '{broken json\n' + JSON.stringify(
    { toolName: 'Read', toolInput: { file_path: '/x' }, timestamp: at(10), id: 'a2' }) + '\n');
  const action = recentAuditedAction({ nowMs: NOW, auditPath: file });
  assert.equal(action.command, 'the real one', 'Read tools and corrupt lines must be skipped');
});

test('missing audit file yields null, never a throw', () => {
  assert.equal(recentAuditedAction({ auditPath: '/nonexistent/audit.jsonl' }), null);
});

test('commands are length-capped', () => {
  const file = auditFile([
    { toolName: 'Bash', toolInput: { command: 'x'.repeat(2000) }, timestamp: at(5), id: 'a1' },
  ]);
  assert.equal(recentAuditedAction({ nowMs: NOW, auditPath: file }).command.length, 500);
});
