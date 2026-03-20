const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('train_from_feedback.py compiles under python3', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'train_from_feedback.py');
  const result = spawnSync('python3', ['-m', 'py_compile', scriptPath], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout || 'python3 -m py_compile failed');
});
