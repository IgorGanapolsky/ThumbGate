const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execSync } = require('node:child_process');

test('Reflection CLI is installed and operational via direct path and symlink (PATH)', () => {
  const output = execSync('node bin/reflection status --json', { encoding: 'utf8' });
  const parsed = JSON.parse(output);
  assert.strictEqual(parsed.status, 'ACTIVE');
  assert.ok(parsed.model.includes('Beam-1.0-501B-A23B'));
  assert.ok(parsed.checkoutLinks.proDirect19);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflection-symlink-test-'));
  const symlinkPath = path.join(tmpDir, 'reflection');
  try {
    fs.symlinkSync(path.resolve(__dirname, '../bin/reflection'), symlinkPath);
    const symlinkOut = execFileSync(symlinkPath, ['monetize', '--json'], { encoding: 'utf8' });
    const symlinkParsed = JSON.parse(symlinkOut);
    assert.strictEqual(symlinkParsed.status, 'ACTIVE');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
