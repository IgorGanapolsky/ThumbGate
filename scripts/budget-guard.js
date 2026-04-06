#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const FEEDBACK_DIR = process.env.THUMBGATE_FEEDBACK_DIR || path.join(PROJECT_ROOT, '.claude', 'memory', 'feedback');
const LEDGER_PATH = path.join(FEEDBACK_DIR, 'budget-ledger.json');
const LOCK_PATH = `${LEDGER_PATH}.lock`;

function parseMonthlyBudget(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid THUMBGATE_MONTHLY_BUDGET_USD value: '${rawValue}'`);
  }
  return parsed;
}

function getMonthlyBudget() {
  const rawValue = process.env.THUMBGATE_MONTHLY_BUDGET_USD || '10';
  return parseMonthlyBudget(rawValue);
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return { months: {} };
  return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf-8'));
}

function saveLedger(ledger) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
}

function blockMs(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Intentional synchronous short wait while lock clears.
  }
}

function acquireLock({ timeoutMs = 5000, staleMs = 15000 } = {}) {
  const startedAt = Date.now();
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });

  while (true) {
    try {
      return fs.openSync(LOCK_PATH, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      try {
        const stat = fs.statSync(LOCK_PATH);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.rmSync(LOCK_PATH, { force: true });
          continue;
        }
      } catch {
        // lock disappeared between retries
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error('Could not acquire budget ledger lock');
      }
      blockMs(20);
    }
  }
}

function releaseLock(lockFd) {
  try {
    fs.closeSync(lockFd);
  } finally {
    fs.rmSync(LOCK_PATH, { force: true });
  }
}

function addSpend({ amountUsd, source, note }) {
  if (!Number.isFinite(amountUsd) || amountUsd < 0) {
    throw new Error('amountUsd must be a non-negative number');
  }

  const budgetUsd = getMonthlyBudget();
  const lockFd = acquireLock();
  try {
    const ledger = loadLedger();
    const month = currentMonthKey();
    if (!ledger.months[month]) {
      ledger.months[month] = {
        totalUsd: 0,
        entries: [],
      };
    }

    const nextTotal = ledger.months[month].totalUsd + amountUsd;
    if (nextTotal > budgetUsd) {
      throw new Error(`Budget exceeded: ${nextTotal.toFixed(2)} > ${budgetUsd.toFixed(2)} USD/month`);
    }

    ledger.months[month].totalUsd = nextTotal;
    ledger.months[month].entries.push({
      ts: new Date().toISOString(),
      source: source || 'unknown',
      note: note || '',
      amountUsd,
    });

    saveLedger(ledger);
    return {
      month,
      totalUsd: ledger.months[month].totalUsd,
      budgetUsd,
    };
  } finally {
    releaseLock(lockFd);
  }
}

function getBudgetStatus() {
  const budgetUsd = getMonthlyBudget();
  const ledger = loadLedger();
  const month = currentMonthKey();
  const total = ledger.months[month] ? ledger.months[month].totalUsd : 0;
  return {
    month,
    totalUsd: total,
    budgetUsd,
    remainingUsd: Math.max(0, budgetUsd - total),
  };
}

function runCli() {
  const args = process.argv.slice(2);
  if (args.includes('--status')) {
    console.log(JSON.stringify(getBudgetStatus(), null, 2));
    return;
  }

  const addArg = args.find((a) => a.startsWith('--add='));
  if (!addArg) {
    console.log('Usage: node scripts/budget-guard.js --status');
    console.log('Usage: node scripts/budget-guard.js --add=0.15 --source=paperbanana --note="diagram generation"');
    process.exit(1);
  }

  const amountUsd = Number(addArg.replace('--add=', ''));
  const sourceArg = args.find((a) => a.startsWith('--source='));
  const noteArg = args.find((a) => a.startsWith('--note='));

  const result = addSpend({
    amountUsd,
    source: sourceArg ? sourceArg.replace('--source=', '') : 'unknown',
    note: noteArg ? noteArg.replace('--note=', '') : '',
  });

  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  addSpend,
  getBudgetStatus,
  getMonthlyBudget,
  parseMonthlyBudget,
  LEDGER_PATH,
  LOCK_PATH,
};

if (require.main === module) {
  runCli();
}
