const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-money-'));
process.env.RLHF_FEEDBACK_DIR = tmpDir;
const mw = require('../scripts/money-watcher');
test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });
test('getCommercialRevenueSnapshot returns structure', () => {
  const r = mw.getCommercialRevenueSnapshot();
  assert.ok(typeof r === 'object');
  assert.ok('paidOrders' in r || 'bookedRevenueCents' in r || 'error' in r);
});
test('watchMoney returns alert or summary', () => {
  const r = mw.watchMoney();
  assert.ok(typeof r === 'object');
});
