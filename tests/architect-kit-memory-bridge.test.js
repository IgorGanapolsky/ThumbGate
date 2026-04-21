'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  parseMemoryFile,
  classifyEntry,
  importDirectory,
  formatTextSummary,
} = require('../scripts/integrations/architect-kit-memory-bridge');

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures', 'architect-kit-memory');

test('parseMemoryFile splits the four canonical sections with dates', () => {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, 'coder.md'), 'utf8');
  const { role, sections } = parseMemoryFile(raw, 'coder');
  assert.equal(role, 'coder');
  assert.equal(sections.mistakes.length, 2);
  assert.equal(sections.learnings.length, 1);
  assert.equal(sections.stakeholder_feedback.length, 2);
  assert.equal(sections.session_log.length, 2);
  assert.equal(sections.mistakes[0].date, '2026-02-06');
  assert.ok(sections.mistakes[0].text.startsWith('Pushed code without running tests'));
});

test('parseMemoryFile handles continuation lines in bullets', () => {
  const raw = `# Coder Memory

## Mistakes
- [2026-03-01] Short preamble.
  Continuation on next line describing the fix.
- [2026-03-02] Another entry.
`;
  const { sections } = parseMemoryFile(raw, 'coder');
  assert.equal(sections.mistakes.length, 2);
  assert.ok(
    sections.mistakes[0].text.includes('Continuation on next line'),
    `expected merged continuation, got: ${sections.mistakes[0].text}`,
  );
});

test('parseMemoryFile tolerates empty sections and missing dates', () => {
  const { sections } = parseMemoryFile(
    '# X\n\n## Mistakes\n\n## Learnings\n- Just a bullet without date.\n',
    'x',
  );
  assert.equal(sections.mistakes.length, 0);
  assert.equal(sections.learnings.length, 1);
  assert.equal(sections.learnings[0].date, null);
  assert.equal(sections.learnings[0].text, 'Just a bullet without date.');
});

test('parseMemoryFile ignores unknown section headings', () => {
  const { sections } = parseMemoryFile(
    '## Random Section\n- should be ignored\n## Mistakes\n- [2026-01-01] real one\n',
    'x',
  );
  assert.equal(sections.mistakes.length, 1);
});

test('classifyEntry maps mistakes to thumbs-down', () => {
  const res = classifyEntry({
    section: 'mistakes',
    text: 'Pushed code without running tests.',
    role: 'coder',
  });
  assert.equal(res.signal, 'down');
  assert.equal(res.whatWentWrong, 'Pushed code without running tests.');
  assert.deepEqual(res.tags.sort(), ['architect-kit', 'mistakes', 'role:coder'].sort());
});

test('classifyEntry maps learnings to thumbs-up', () => {
  const res = classifyEntry({
    section: 'learnings',
    text: 'Use the swap-id flow for published products.',
    role: 'coder',
  });
  assert.equal(res.signal, 'up');
  assert.equal(res.whatWorked, 'Use the swap-id flow for published products.');
});

test('classifyEntry flips stakeholder_feedback based on negative keywords', () => {
  const pos = classifyEntry({
    section: 'stakeholder_feedback',
    text: 'Loved the new landing hero.',
    role: 'designer',
  });
  const neg = classifyEntry({
    section: 'stakeholder_feedback',
    text: 'Rejected sticker layout — poster, not die-cut.',
    role: 'designer',
  });
  assert.equal(pos.signal, 'up');
  assert.equal(neg.signal, 'down');
});

test('classifyEntry returns null for session_log (too granular)', () => {
  const res = classifyEntry({
    section: 'session_log',
    text: 'WQ-716: Fixed template.',
    role: 'coder',
  });
  assert.equal(res, null);
});

test('classifyEntry rejects empty text', () => {
  assert.equal(classifyEntry({ section: 'mistakes', text: '', role: 'x' }), null);
  assert.equal(classifyEntry({ section: 'mistakes', text: null, role: 'x' }), null);
});

test('importDirectory dry-run counts entries without calling capture', () => {
  let callCount = 0;
  const summary = importDirectory({
    dir: FIXTURE_DIR,
    dryRun: true,
    captureFn: () => { callCount += 1; return { accepted: true }; },
  });
  assert.equal(callCount, 0);
  assert.equal(summary.filesScanned, 2);
  assert.equal(summary.filesImported, 2);
  // coder: 2 mistakes + 1 learning + 2 feedback = 5; qa: 1 mistake + 1 learning = 2
  assert.equal(summary.captured, 7);
  assert.equal(summary.skipped, 3); // 2 session_log (coder) + 1 (qa)
  assert.equal(summary.totalEntries, 10);
  assert.equal(summary.errors.length, 0);
});

test('importDirectory calls captureFn with the right signal/tags shape', () => {
  const calls = [];
  const summary = importDirectory({
    dir: FIXTURE_DIR,
    roleFilter: 'qa',
    dryRun: false,
    captureFn: (params) => { calls.push(params); return { accepted: true }; },
  });
  assert.equal(summary.filesImported, 1);
  assert.equal(summary.captured, 2);
  assert.equal(summary.skipped, 1); // session_log skipped
  const signals = calls.map((c) => c.signal).sort();
  assert.deepEqual(signals, ['down', 'up']);
  for (const call of calls) {
    assert.ok(call.tags.includes('architect-kit'));
    assert.ok(call.tags.includes('role:qa'));
    assert.equal(call.source, 'architect-kit-memory-bridge');
  }
});

test('importDirectory records captureFn errors without bailing', () => {
  let n = 0;
  const summary = importDirectory({
    dir: FIXTURE_DIR,
    roleFilter: 'coder',
    dryRun: false,
    captureFn: () => {
      n += 1;
      if (n === 2) throw new Error('simulated db failure');
      return { accepted: true };
    },
  });
  assert.equal(summary.errors.length, 1);
  assert.equal(summary.errors[0].message, 'simulated db failure');
  assert.ok(summary.captured >= 4);
});

test('importDirectory counts not-accepted captures as skipped', () => {
  const summary = importDirectory({
    dir: FIXTURE_DIR,
    roleFilter: 'qa',
    dryRun: false,
    captureFn: () => ({ accepted: false, reason: 'too short' }),
  });
  // qa has 2 actionable entries after skipping session_log — both should be skipped.
  assert.equal(summary.captured, 0);
  assert.equal(summary.skipped, 1 + 2); // 1 session_log + 2 not-accepted
  assert.equal(summary.perRole.qa.errors.length, 2);
});

test('importDirectory honors roleFilter for single-role imports', () => {
  const summary = importDirectory({
    dir: FIXTURE_DIR,
    roleFilter: 'coder',
    dryRun: true,
  });
  assert.equal(summary.filesImported, 1);
  assert.deepEqual(Object.keys(summary.perRole), ['coder']);
});

test('importDirectory throws for missing dir arg', () => {
  assert.throws(() => importDirectory({}), /--dir is required/);
});

test('formatTextSummary produces a human-readable report', () => {
  const summary = importDirectory({ dir: FIXTURE_DIR, dryRun: true });
  const text = formatTextSummary(summary);
  assert.ok(text.includes('[architect-kit-bridge]'));
  assert.ok(text.includes('coder:'));
  assert.ok(text.includes('qa:'));
});
