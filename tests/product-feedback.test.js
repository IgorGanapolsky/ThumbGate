const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-pf-'));
process.env.RLHF_FEEDBACK_DIR = tmpDir;
const pf = require('../scripts/product-feedback');
test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });
test('buildProductIssueTitle returns string', () => {
  assert.ok(typeof pf.buildProductIssueTitle({ category: 'bug', summary: 'test' }) === 'string');
});
test('buildProductIssueBody returns markdown with category', () => {
  const r = pf.buildProductIssueBody({ category: 'bug', summary: 'test' });
  assert.ok(r.includes('bug'));
});
test('appendProductFeedbackLog is a function', () => {
  assert.equal(typeof pf.appendProductFeedbackLog, 'function');
});
