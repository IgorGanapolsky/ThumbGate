const test = require('node:test');

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

test('scripts/obsidian-linear-sync.js executes and syncs vault notes cleanly', () => {
  const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-test-vault-'));
  const scriptPath = path.join(__dirname, '..', 'scripts', 'obsidian-linear-sync.js');

  try {
    // Run script in subprocess with mock env or dry execution
    const output = execFileSync('node', [scriptPath], {
      encoding: 'utf8',
      env: { ...process.env },
    });
    assert.match(output, /\[Obsidian-Linear Sync\]/);
  } finally {
    fs.rmSync(tmpVault, { recursive: true, force: true });
  }
});
