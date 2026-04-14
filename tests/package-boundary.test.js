const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');

function npmPackFiles() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output)[0].files.map((file) => file.path);
}

test('npm package excludes generated runtime state from included directories', () => {
  const runtimeDb = path.join(root, 'scripts', 'social-analytics', 'db', 'package-leak-test.sqlite');
  const pycacheDir = path.join(root, 'scripts', '__pycache__');
  const pycacheFile = path.join(pycacheDir, 'package_leak_test.cpython-314.pyc');

  fs.mkdirSync(path.dirname(runtimeDb), { recursive: true });
  fs.mkdirSync(pycacheDir, { recursive: true });
  fs.writeFileSync(runtimeDb, 'local sqlite state must not ship\n');
  fs.writeFileSync(pycacheFile, 'compiled bytecode must not ship\n');

  try {
    const files = npmPackFiles();
    assert.equal(files.includes('scripts/social-analytics/db/package-leak-test.sqlite'), false);
    assert.equal(files.includes('scripts/__pycache__/package_leak_test.cpython-314.pyc'), false);
  } finally {
    fs.rmSync(runtimeDb, { force: true });
    fs.rmSync(pycacheFile, { force: true });
    try {
      fs.rmdirSync(pycacheDir);
    } catch {
      // Keep the directory if a developer has other local bytecode files.
    }
  }
});
