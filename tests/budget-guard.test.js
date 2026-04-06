const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-budget-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
process.env.THUMBGATE_MONTHLY_BUDGET_USD = '1';

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
  assert.throws(() => parseMonthlyBudget('NaN'), /Invalid THUMBGATE_MONTHLY_BUDGET_USD/);
});

test('parseMonthlyBudget returns default (10) for undefined', () => {
  const { getMonthlyBudget } = require('../scripts/budget-guard');
  const prevBudget = process.env.THUMBGATE_MONTHLY_BUDGET_USD;
  delete process.env.THUMBGATE_MONTHLY_BUDGET_USD;
  const result = getMonthlyBudget();
  assert.equal(result, 10, 'default monthly budget should be 10');
  process.env.THUMBGATE_MONTHLY_BUDGET_USD = prevBudget || '1';
});

test('parseMonthlyBudget parses valid number string', () => {
  const result = parseMonthlyBudget('25.5');
  assert.equal(result, 25.5);
});

test('getMonthlyBudget returns number greater than 0', () => {
  const { getMonthlyBudget } = require('../scripts/budget-guard');
  const budget = getMonthlyBudget();
  assert.equal(typeof budget, 'number');
  assert.ok(budget > 0, 'monthly budget must be > 0');
});

test('getBudgetStatus on fresh ledger shows full remaining budget', () => {
  const freshTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-budget-fresh-'));
  const prevDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const prevBudget = process.env.THUMBGATE_MONTHLY_BUDGET_USD;
  process.env.THUMBGATE_FEEDBACK_DIR = freshTmpDir;
  process.env.THUMBGATE_MONTHLY_BUDGET_USD = '5';

  // Re-require to pick up new env
  delete require.cache[require.resolve('../scripts/budget-guard')];
  const fresh = require('../scripts/budget-guard');
  const status = fresh.getBudgetStatus();
  assert.equal(status.totalUsd, 0, 'fresh ledger should have 0 spend');
  assert.equal(status.remainingUsd, 5, 'remaining should equal full budget');

  fs.rmSync(freshTmpDir, { recursive: true, force: true });
  process.env.THUMBGATE_FEEDBACK_DIR = prevDir;
  process.env.THUMBGATE_MONTHLY_BUDGET_USD = prevBudget || '1';
  delete require.cache[require.resolve('../scripts/budget-guard')];
});
