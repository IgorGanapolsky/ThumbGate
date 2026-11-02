const test = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');

test('Reflection CLI is installed and operational in path', () => {
  const output = execSync('node bin/reflection status --json', { encoding: 'utf8' });
  const parsed = JSON.parse(output);
  assert.strictEqual(parsed.status, 'ACTIVE');
  assert.ok(parsed.model.includes('Beam-1.0-501B-A23B'));
  assert.ok(parsed.checkoutLinks.proDirect19);
});
