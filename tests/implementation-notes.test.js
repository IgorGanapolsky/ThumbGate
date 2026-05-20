'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  appendNote,
  listNotes,
  findNote,
  promoteToLesson,
} = require('../scripts/implementation-notes');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-impl-notes-'));
}

test('appendNote writes both markdown and jsonl, returns record with id', () => {
  const dir = mkTmpDir();
  const record = appendNote({
    dir,
    tool: 'edit_file',
    decision: 'switched from kebab-case to snake_case to match existing module style',
    rationale: 'consistency with surrounding modules; kebab is only used at CLI boundary',
    signal: 'info',
    tags: ['naming', 'consistency'],
  });
  assert.match(record.id, /^note_[a-f0-9]{12}$/, 'id is sha-prefixed');
  assert.equal(record.tool, 'edit_file');
  assert.equal(record.tags.length, 2);

  const md = fs.readFileSync(path.join(dir, 'implementation-notes.md'), 'utf8');
  assert.match(md, /# Implementation Notes/, 'markdown has header');
  assert.match(md, /switched from kebab-case to snake_case/, 'decision in markdown');

  const jsonl = fs.readFileSync(path.join(dir, 'implementation-notes.jsonl'), 'utf8');
  const lines = jsonl.split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.id, record.id);
});

test('appendNote requires decision; refuses empty', () => {
  const dir = mkTmpDir();
  assert.throws(() => appendNote({ dir, tool: 'x', decision: '   ' }), /decision is required/);
});

test('listNotes returns recent entries respecting limit', () => {
  const dir = mkTmpDir();
  for (let i = 0; i < 5; i += 1) {
    appendNote({ dir, decision: `decision ${i}`, tool: 't', signal: i === 2 ? 'down' : 'info', timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString() });
  }
  const all = listNotes({ dir, limit: 100 });
  assert.equal(all.length, 5);
  const last3 = listNotes({ dir, limit: 3 });
  assert.equal(last3.length, 3);
  assert.equal(last3[0].decision, 'decision 2');
  assert.equal(last3[2].decision, 'decision 4');
});

test('findNote locates an entry by id, returns null when missing', () => {
  const dir = mkTmpDir();
  const r = appendNote({ dir, decision: 'a', tool: 't' });
  assert.equal(findNote({ id: r.id, dir }).decision, 'a');
  assert.equal(findNote({ id: 'note_nonexistent', dir }), null);
});

test('promoteToLesson hands a normalized payload to the injected capture fn', () => {
  const dir = mkTmpDir();
  const note = appendNote({
    dir,
    tool: 'bash',
    decision: 'forced --no-verify because hook kept hanging',
    rationale: 'pre-commit hook timed out 3x; bypassed once to unblock',
    signal: 'down',
    specSection: 'commit-policy',
    tags: ['hook-bypass'],
  });

  let received;
  const capture = (payload) => {
    received = payload;
    return { id: 'feedback_stub' };
  };

  const result = promoteToLesson({ id: note.id, dir, capture });
  assert.equal(result.noteId, note.id);
  assert.equal(result.captureResult.id, 'feedback_stub');
  assert.equal(received.feedback, 'down', 'down signal forwards as feedback=down');
  assert.match(received.context, /forced --no-verify/);
  assert.match(received.whatWentWrong, /pre-commit hook timed out/);
  assert.deepEqual(
    [...received.tags].sort(),
    ['hook-bypass', 'implementation-note'],
    'preserves source tags + adds the implementation-note tag',
  );
  assert.equal(received.sourceNoteId, note.id);
  assert.match(received.whatToChange, /commit-policy/);
});

test('promoteToLesson refuses when capture is not a function', () => {
  const dir = mkTmpDir();
  const note = appendNote({ dir, decision: 'x', tool: 't' });
  assert.throws(() => promoteToLesson({ id: note.id, dir, capture: null }), /capture function required/);
});

test('promoteToLesson throws when id not found', () => {
  const dir = mkTmpDir();
  appendNote({ dir, decision: 'x', tool: 't' });
  assert.throws(() => promoteToLesson({ id: 'note_missing', dir, capture: () => ({}) }), /no note with id/);
});

test('appendNote with signal=up maps promote -> feedback=up + whatWorked filled', () => {
  const dir = mkTmpDir();
  const note = appendNote({ dir, decision: 'cached the API response', signal: 'up', rationale: 'eliminated 40% of duplicate calls', tool: 'fetch' });
  let received;
  promoteToLesson({ id: note.id, dir, capture: (p) => { received = p; return {}; } });
  assert.equal(received.feedback, 'up');
  assert.match(received.whatWorked, /eliminated 40%/);
  assert.equal(received.whatWentWrong, '', 'whatWentWrong stays empty on up signal');
});
