const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-budget-test-'));
process.env.RLHF_FEEDBACK_DIR = tmpFeedbackDir;
process.env.RLHF_MONTHLY_BUDGET_USD = '1';

const {
  addSpend,
  getBudgetStatus,
  parseMonthlyBudget,
} = require('../scripts/budget-guard');

test.after(() => {
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
});

test('budget ledger adds spend and reports status', () => {
  const before = getBudgetStatus();
  assert.equal(before.totalUsd, 0);

  const afterAdd = addSpend({ amountUsd: 0.25, source: 'test', note: 'unit' });
  assert.equal(afterAdd.totalUsd, 0.25);

  const status = getBudgetStatus();
  assert.equal(status.remainingUsd, 0.75);
});

test('budget guard blocks overspend', () => {
  assert.throws(() => {
    addSpend({ amountUsd: 0.9, source: 'test', note: 'overspend' });
  }, /Budget exceeded/);
});

test('invalid budget env value is rejected', () => {
  assert.throws(() => parseMonthlyBudget('NaN'), /Invalid RLHF_MONTHLY_BUDGET_USD/);
});
