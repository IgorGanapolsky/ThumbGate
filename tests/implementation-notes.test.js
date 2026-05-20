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
  cli,
  resolvePaths,
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

// --- CLI coverage tests ---

test('resolvePaths returns default dir when none specified', () => {
  const paths = resolvePaths();
  assert.ok(paths.dir.endsWith('.thumbgate'), 'default dir ends with .thumbgate');
  assert.ok(paths.markdownPath.endsWith('implementation-notes.md'));
  assert.ok(paths.jsonlPath.endsWith('implementation-notes.jsonl'));
});

test('resolvePaths uses custom dir when provided', () => {
  const dir = mkTmpDir();
  const paths = resolvePaths({ dir });
  assert.equal(paths.dir, dir);
  assert.ok(paths.markdownPath.startsWith(dir));
});

test('cli append subcommand creates a note and logs json', () => {
  const dir = mkTmpDir();
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    const result = cli(['append', `--decision=test decision via CLI`, '--tool=bash', `--rationale=testing`, '--signal=info', '--tags=a,b', `--dir=${dir}`]);
    assert.ok(result.id, 'returns a record with id');
    assert.equal(result.decision, 'test decision via CLI');
    assert.ok(logs.length > 0, 'logged output');
  } finally {
    console.log = origLog;
  }
});

test('cli list subcommand (text mode) prints entries', () => {
  const dir = mkTmpDir();
  appendNote({ dir, decision: 'decision alpha', tool: 't' });
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    const result = cli(['list', `--dir=${dir}`]);
    assert.equal(result.length, 1);
    assert.ok(logs.some((l) => l.includes('decision alpha')), 'text mode shows decision');
  } finally {
    console.log = origLog;
  }
});

test('cli list subcommand (json mode) prints JSON', () => {
  const dir = mkTmpDir();
  appendNote({ dir, decision: 'decision beta', tool: 't' });
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    cli(['list', '--json', `--dir=${dir}`]);
    const parsed = JSON.parse(logs.join(''));
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed[0].decision, 'decision beta');
  } finally {
    console.log = origLog;
  }
});

test('cli list subcommand with empty notes prints hint', () => {
  const dir = mkTmpDir();
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    cli(['list', `--dir=${dir}`]);
    assert.ok(logs.some((l) => l.includes('No implementation notes yet')));
  } finally {
    console.log = origLog;
  }
});

test('cli show subcommand finds a note by positional id', () => {
  const dir = mkTmpDir();
  const note = appendNote({ dir, decision: 'show me', tool: 'x' });
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    const result = cli(['show', note.id, `--dir=${dir}`]);
    assert.equal(result.decision, 'show me');
  } finally {
    console.log = origLog;
  }
});

test('cli show subcommand exits with 1 when note not found', () => {
  const dir = mkTmpDir();
  appendNote({ dir, decision: 'x', tool: 't' });
  const origExitCode = process.exitCode;
  const errs = [];
  const origErr = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  try {
    const result = cli(['show', 'note_missing123', `--dir=${dir}`]);
    assert.equal(result, null);
    assert.equal(process.exitCode, 1);
    assert.ok(errs.some((l) => l.includes('No note with id')));
  } finally {
    console.error = origErr;
    process.exitCode = origExitCode;
  }
});

test('cli promote subcommand with fallback capture', () => {
  const dir = mkTmpDir();
  const note = appendNote({ dir, decision: 'promote me', tool: 'bash', signal: 'down', rationale: 'broke prod' });
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    const result = cli(['promote', note.id, `--dir=${dir}`]);
    assert.ok(result, 'returns a result');
    assert.equal(result.noteId, note.id);
  } finally {
    console.log = origLog;
  }
});

test('cli default (no subcommand) prints usage', () => {
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    const result = cli([]);
    assert.equal(result, null);
    assert.ok(logs.some((l) => l.includes('Usage:')));
  } finally {
    console.log = origLog;
  }
});

test('appendNote with no tool defaults to unspecified', () => {
  const dir = mkTmpDir();
  const record = appendNote({ dir, decision: 'no tool given' });
  assert.equal(record.tool, 'unspecified');
});

test('appendNote with null/undefined values normalizes to empty strings', () => {
  const dir = mkTmpDir();
  const record = appendNote({ dir, decision: 'test null handling', tool: null, rationale: undefined, signal: null });
  assert.equal(record.tool, 'unspecified');
  assert.equal(record.rationale, '');
  assert.equal(record.signal, 'info');
});

test('appendNote with non-array tags normalizes to empty array', () => {
  const dir = mkTmpDir();
  const record = appendNote({ dir, decision: 'test tags', tags: 'not-an-array' });
  assert.deepEqual(record.tags, []);
});

test('listNotes returns empty when no jsonl file exists', () => {
  const dir = mkTmpDir();
  const result = listNotes({ dir });
  assert.deepEqual(result, []);
});

test('findNote returns null when no jsonl file exists', () => {
  const dir = mkTmpDir();
  assert.equal(findNote({ id: 'note_abc', dir }), null);
});

test('findNote returns null when id is falsy', () => {
  const dir = mkTmpDir();
  assert.equal(findNote({ id: '', dir }), null);
  assert.equal(findNote({ id: null, dir }), null);
});

test('renderMarkdownEntry includes signal and specSection when present', () => {
  const dir = mkTmpDir();
  const record = appendNote({
    dir,
    decision: 'chose option A',
    tool: 'edit',
    signal: 'down',
    specSection: 'section-3.2',
    rationale: 'lower complexity',
  });
  const md = fs.readFileSync(path.join(dir, 'implementation-notes.md'), 'utf8');
  assert.match(md, /Signal.*down/, 'includes signal');
  assert.match(md, /Spec section.*section-3\.2/, 'includes spec section');
  assert.match(md, /Rationale.*lower complexity/, 'includes rationale');
});

test('cli append with spec-section flag', () => {
  const dir = mkTmpDir();
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    const result = cli(['append', '--decision=spec test', '--spec-section=sec-1', `--dir=${dir}`]);
    assert.equal(result.specSection, 'sec-1');
  } finally {
    console.log = origLog;
  }
});

test('promoteToLesson with info signal maps to feedback=down', () => {
  const dir = mkTmpDir();
  const note = appendNote({ dir, decision: 'info note', tool: 't', signal: 'info' });
  let received;
  promoteToLesson({ id: note.id, dir, capture: (p) => { received = p; return {}; } });
  assert.equal(received.feedback, 'down', 'info signal defaults to down');
  assert.equal(received.whatWorked, '', 'whatWorked empty for non-up signal');
});

test('cli list with limit flag', () => {
  const dir = mkTmpDir();
  for (let i = 0; i < 5; i += 1) {
    appendNote({ dir, decision: `d${i}`, tool: 't', timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString() });
  }
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    const result = cli(['list', '--limit=2', `--dir=${dir}`]);
    assert.equal(result.length, 2);
  } finally {
    console.log = origLog;
  }
});

test('cli show with --id flag instead of positional', () => {
  const dir = mkTmpDir();
  const note = appendNote({ dir, decision: 'flag id test', tool: 'x' });
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    const result = cli(['show', `--id=${note.id}`, `--dir=${dir}`]);
    assert.equal(result.decision, 'flag id test');
  } finally {
    console.log = origLog;
  }
});
