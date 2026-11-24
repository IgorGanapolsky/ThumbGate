'use strict';

// AGENT-3667, 24 Nov 2026 (faults brief, item C): three lessons that differ in one detail each (the page that was not
// checked) collapsed into one memory row, and the row kept only the last text. Only an identical lesson may merge.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-distinct-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmp;
process.env.THUMBGATE_NO_RATE_LIMIT = '1';

const { captureFeedback } = require('../scripts/feedback-loop');
const { searchLessons } = require('../scripts/lesson-search');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const lesson = (page, thing) => ({
  signal: 'down',
  reviewOrigin: 'human',
  tags: ['dotloop', 'signing'],
  context: `Igor: thumbs down. The agent signed the dotloop form without checking the ${thing} on page ${page}.`,
  whatWentWrong: `The agent signed the dotloop form for the buyer without checking the ${thing} on page ${page}.`,
  whatToChange: `Check the ${thing} on page ${page} before signing the dotloop form.`,
});

const memoryRows = () => fs.readFileSync(path.join(tmp, 'memory-log.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));

test('three lessons that differ in one detail are all kept, each with its own text', () => {
  for (const [page, thing] of [['two', 'initials'], ['five', 'lender name'], ['nine', 'closing date']]) {
    const result = captureFeedback(lesson(page, thing));
    assert.equal(result.accepted, true, result.reason);
  }
  const rows = memoryRows();
  assert.equal(rows.length, 3, `expected 3 memory rows, got ${rows.length}`);
  for (const [page, thing] of [['two', 'initials'], ['five', 'lender name'], ['nine', 'closing date']]) {
    assert.ok(rows.some((row) => String(row.content).includes(`${thing} on page ${page}`)), `lost the ${thing} lesson`);
  }
});

test('retrieval returns all three', () => {
  const found = searchLessons('dotloop form', { limit: 10 });
  const list = Array.isArray(found) ? found : (found.results || found.lessons || []);
  const text = JSON.stringify(list);
  for (const thing of ['initials', 'lender name', 'closing date']) assert.ok(text.includes(thing), `retrieval is missing the ${thing} lesson`);
});

test('an identical lesson is still deduplicated, not stored twice', () => {
  captureFeedback(lesson('two', 'initials'));
  const initialsRows = memoryRows().filter((row) => String(row.content).includes('initials on page two'));
  assert.equal(initialsRows.length, 1);
});
