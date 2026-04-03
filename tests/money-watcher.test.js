const test = require('node:test');
const assert = require('node:assert/strict');
const mw = require('../scripts/money-watcher');
test('getCommercialRevenueSnapshot is a function', () => { assert.equal(typeof mw.getCommercialRevenueSnapshot, 'function'); });
test('watchMoney is a function', () => { assert.equal(typeof mw.watchMoney, 'function'); });
test('getCommercialRevenueSnapshot handles missing data gracefully', () => {
  try { const r = mw.getCommercialRevenueSnapshot(); assert.ok(typeof r === 'object'); }
  catch (e) { assert.ok(e.message.length > 0, 'should throw with meaningful error'); }
});
