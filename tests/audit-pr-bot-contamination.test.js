'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isBareBotAuthor,
  totalAdditions,
  newFilesAdded,
} = require('../scripts/audit-pr-bot-contamination.js');

test('isBareBotAuthor flags bare actions@github.com identity', () => {
  assert.equal(isBareBotAuthor({ commit: { author: { email: 'actions@github.com' } } }), true);
  assert.equal(isBareBotAuthor({ commit: { author: { email: 'ACTIONS@github.com' } } }), true, 'case-insensitive');
});

test('isBareBotAuthor does NOT flag registered github-actions[bot]', () => {
  // The standard GitHub Actions bot uses this email; it's allowed because
  // commits from named workflows come through this identity legitimately.
  assert.equal(isBareBotAuthor({
    commit: { author: { email: '41898282+github-actions[bot]@users.noreply.github.com' } },
  }), false);
  assert.equal(isBareBotAuthor({
    commit: { author: { email: 'github-actions[bot]@users.noreply.github.com' } },
  }), false);
});

test('isBareBotAuthor does NOT flag human-authored commits', () => {
  assert.equal(isBareBotAuthor({ commit: { author: { email: 'igor@example.com' } } }), false);
  assert.equal(isBareBotAuthor({ commit: { author: { email: '' } } }), false);
  assert.equal(isBareBotAuthor({}), false, 'missing nested fields tolerated');
});

test('totalAdditions sums all per-file additions', () => {
  const detail = {
    files: [
      { filename: 'a.js', additions: 10, deletions: 0, status: 'modified' },
      { filename: 'b.js', additions: 50, deletions: 5, status: 'modified' },
      { filename: 'c.py', additions: 700, deletions: 0, status: 'added' },
    ],
  };
  assert.equal(totalAdditions(detail), 760);
});

test('totalAdditions tolerates missing files array', () => {
  assert.equal(totalAdditions({}), 0);
  assert.equal(totalAdditions({ files: [] }), 0);
});

test('newFilesAdded returns only "added" status entries with line counts', () => {
  const detail = {
    files: [
      { filename: 'a.js', additions: 10, status: 'modified' },
      { filename: 'b.js', additions: 50, status: 'added' },
      { filename: 'c.py', additions: 700, status: 'added' },
      { filename: 'd.js', additions: 3, status: 'removed' },
    ],
  };
  assert.deepEqual(newFilesAdded(detail), ['b.js (+50)', 'c.py (+700)']);
});

test('regression: the bee4938a contamination pattern would have been caught', () => {
  // Simulates the actual commit that contaminated PR #1910:
  // bee4938a feat(eval): add offline feedback quality report
  //   by GitHub Actions <actions@github.com>
  //   added scripts/feedback_quality_eval.py (+693 lines)
  const commit = { commit: { author: { email: 'actions@github.com' } } };
  const detail = {
    files: [
      { filename: 'scripts/feedback_quality_eval.py', additions: 693, status: 'added' },
    ],
  };
  assert.equal(isBareBotAuthor(commit), true);
  assert.equal(totalAdditions(detail), 693);
  assert.ok(693 > 100, 'exceeds default LARGE_ADD_THRESHOLD=100, would fail audit');
  assert.deepEqual(
    newFilesAdded(detail),
    ['scripts/feedback_quality_eval.py (+693)']
  );
});
