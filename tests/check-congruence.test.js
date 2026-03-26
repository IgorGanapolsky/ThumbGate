const test = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('check-congruence exits 0 on current codebase', () => {
  const result = execSync('node scripts/check-congruence.js', { cwd: ROOT, encoding: 'utf-8' });
  assert.match(result, /Congruence check passed/);
  assert.match(result, /ThumbGate/);
  assert.match(result, /6 tech terms/);
});

test('check-congruence verifies version, brand, tech terms, and disclaimer', () => {
  const output = execSync('node scripts/check-congruence.js', { cwd: ROOT, encoding: 'utf-8' });
  assert.match(output, /v\d+\.\d+\.\d+/);
  assert.match(output, /brand "ThumbGate"/);
});
