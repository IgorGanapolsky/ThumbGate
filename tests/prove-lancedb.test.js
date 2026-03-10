const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('lancedb proof core requirements pass (VEC-01 through VEC-04)', () => {
  const result = spawnSync('node', ['-e', `
    (async () => {
      const { runProof } = require('./scripts/prove-lancedb');
      const os = require('os'); const fs = require('fs'); const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lance-'));
      try {
        const r = await runProof({ proofDir: tmp });
        process.stderr.write('PROOF_JSON:' + JSON.stringify({ passed: r.summary.passed, reqs: Object.fromEntries(Object.entries(r.requirements).map(([k,v]) => [k, v.status])) }) + '\\n');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    })();
  `], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf-8',
    timeout: 120000,
  });

  const marker = (result.stderr || '').split('\n').find((l) => l.startsWith('PROOF_JSON:'));
  assert.ok(marker, `no proof output found. stderr: ${(result.stderr || '').slice(-300)}`);
  const report = JSON.parse(marker.replace('PROOF_JSON:', ''));

  assert.ok(report.passed >= 4, `expected >= 4 passed, got ${report.passed}`);
  assert.equal(report.reqs['VEC-01'], 'pass');
  assert.equal(report.reqs['VEC-02'], 'pass');
  assert.equal(report.reqs['VEC-03'], 'pass');
  assert.equal(report.reqs['VEC-04'], 'pass');
});
