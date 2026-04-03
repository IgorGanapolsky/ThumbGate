const test = require('node:test');
const assert = require('node:assert/strict');
const pf = require('../scripts/product-feedback');
test('buildProductIssueTitle returns string', () => { assert.ok(typeof pf.buildProductIssueTitle({ category: 'bug', summary: 'test' }) === 'string'); });
test('buildProductIssueBody includes category', () => { assert.ok(pf.buildProductIssueBody({ category: 'bug', summary: 'test' }).includes('bug')); });
test('appendProductFeedbackLog is function', () => { assert.equal(typeof pf.appendProductFeedbackLog, 'function'); });
