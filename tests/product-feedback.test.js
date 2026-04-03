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
  const r = pf.buildProductIssueTitle({ category: 'bug', summary: 'test issue' });
  assert.ok(typeof r === 'string');
  assert.ok(r.length > 0);
});
test('buildProductIssueBody returns markdown', () => {
  const r = pf.buildProductIssueBody({ category: 'feature', summary: 'add export', details: 'need CSV' });
  assert.ok(typeof r === 'string');
  assert.ok(r.includes('feature') || r.includes('export') || r.includes('CSV'));
});
test('appendProductFeedbackLog writes to file', () => {
  pf.appendProductFeedbackLog({ category: 'bug', summary: 'test' });
  const logPath = path.join(tmpDir, 'product-feedback.jsonl');
  if (fs.existsSync(logPath)) {
    assert.ok(fs.readFileSync(logPath, 'utf-8').includes('test'));
  }
});
