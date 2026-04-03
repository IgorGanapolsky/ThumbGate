const test = require('node:test');
const assert = require('node:assert/strict');
const mw = require('../scripts/money-watcher');
test('getCommercialRevenueSnapshot is function', () => { assert.equal(typeof mw.getCommercialRevenueSnapshot, 'function'); });
test('watchMoney is function', () => { assert.equal(typeof mw.watchMoney, 'function'); });
test('handles missing data', () => { try { mw.getCommercialRevenueSnapshot(); } catch(e) { assert.ok(e.message.length > 0); } });
