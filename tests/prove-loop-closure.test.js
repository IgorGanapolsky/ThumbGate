const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('loop-closure proof script exits 0', () => {
  const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-loop-closure-'));
  const result = spawnSync('node', ['scripts/prove-loop-closure.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, THUMBGATE_PROOF_DIR: tmpProofDir },
    encoding: 'utf-8',
    timeout: 120000,
  });
  fs.rmSync(tmpProofDir, { recursive: true, force: true });
  assert.equal(result.status, 0, `proof failed: ${(result.stderr || '').slice(-500)}`);
});
