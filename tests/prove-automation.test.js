const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { runAutomationProof } = require('../scripts/prove-automation');

test('automation proof harness passes all checks', async () => {
  const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-automation-proof-test-'));
  const report = await runAutomationProof({ proofDir: tmpProofDir, port: 0 });
  assert.equal(report.summary.failed, 0);
  assert.ok(report.summary.passed >= 10);
  assert.equal(fs.existsSync(path.join(tmpProofDir, 'report.json')), true);
  assert.equal(fs.existsSync(path.join(tmpProofDir, 'report.md')), true);
  fs.rmSync(tmpProofDir, { recursive: true, force: true });
});
