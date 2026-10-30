const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pf = require('../scripts/product-feedback');

test('buildProductIssueTitle returns string', () => { assert.ok(typeof pf.buildProductIssueTitle({ category: 'bug', summary: 'test' }) === 'string'); });
test('buildProductIssueBody includes category', () => { assert.ok(pf.buildProductIssueBody({ category: 'bug', summary: 'test' }).includes('bug')); });
test('appendProductFeedbackLog is function', () => { assert.equal(typeof pf.appendProductFeedbackLog, 'function'); });

test('composeChipFeedback refuses an empty reason list', () => {
  const result = pf.composeChipFeedback({ reasons: [], details: 'a real note' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'pick a reason');
});

test('composeChipFeedback turns one feature chip into the lesson line', () => {
  const result = pf.composeChipFeedback({ reasons: ['solved-the-task'] });
  assert.equal(result.ok, true);
  assert.equal(result.category, 'feature');
  assert.equal(result.message, 'Solved the task.');
  assert.deepEqual(result.reasonIds, ['solved-the-task']);
});

test('composeChipFeedback lets a bug chip outrank a feature chip', () => {
  const result = pf.composeChipFeedback({
    reasons: ['solved-the-task', 'missed-the-mistake', 'not-a-reason'],
    details: '  the deploy   skipped the test  ',
  });
  assert.equal(result.ok, true);
  assert.equal(result.category, 'bug');
  assert.equal(result.message, 'Solved the task. Missed the mistake. the deploy skipped the test');
  assert.deepEqual(result.reasonIds, ['solved-the-task', 'missed-the-mistake']);
});

test('composeChipFeedback requires a short detail when Other is the only reason', () => {
  const missing = pf.composeChipFeedback({ reasons: ['other'], details: 'no' });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'add a short detail for Other');

  const filed = pf.composeChipFeedback({ reasons: ['other'], details: 'the note was empty' });
  assert.equal(filed.ok, true);
  assert.equal(filed.category, 'question');
  assert.equal(filed.message, 'Other. the note was empty');
});
