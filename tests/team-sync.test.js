'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const CLI_PATH = path.join(PROJECT_ROOT, 'bin', 'cli.js');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-team-sync-'));
}

test('team-sync commits local prevention rules and pulls/pushes successfully', () => {
  const tmp = makeTmpDir();
  const remoteDir = path.join(tmp, 'remote.git');
  const clientDir = path.join(tmp, 'client');
  
  try {
    // 1. Setup local bare remote repo
    fs.mkdirSync(remoteDir, { recursive: true });
    execSync('git init --bare', { cwd: remoteDir, stdio: 'ignore' });
    
    // 2. Setup client repo
    fs.mkdirSync(clientDir, { recursive: true });
    execSync('git init', { cwd: clientDir, stdio: 'ignore' });
    execSync('git config user.email "sync-test@example.com"', { cwd: clientDir, stdio: 'ignore' });
    execSync('git config user.name "Sync Test"', { cwd: clientDir, stdio: 'ignore' });
    execSync('git config commit.gpgsign false', { cwd: clientDir, stdio: 'ignore' });
    
    // Create initial commit so we have a branch (main/master)
    fs.writeFileSync(path.join(clientDir, 'README.md'), '# Test Project');
    execSync('git add README.md', { cwd: clientDir, stdio: 'ignore' });
    execSync('git commit -m "initial commit"', { cwd: clientDir, stdio: 'ignore' });
    
    // Set origin to our bare repo
    execSync(`git remote add origin "${remoteDir}"`, { cwd: clientDir, stdio: 'ignore' });
    execSync('git push -u origin HEAD', { cwd: clientDir, stdio: 'ignore' });
    
    // 3. Create .thumbgate directory and local prevention rules
    const tgDir = path.join(clientDir, '.thumbgate');
    fs.mkdirSync(tgDir, { recursive: true });
    fs.writeFileSync(path.join(tgDir, 'prevention-rules.md'), '# Prevention Rules\n\n## Never drop production\n- Action: block\n- Pattern: DROP.*production\n');
    
    // Verify local changes are uncommitted
    const statusBefore = execSync('git status --porcelain', { cwd: clientDir, encoding: 'utf8' });
    assert.ok(statusBefore.includes('.thumbgate/'), 'should show .thumbgate/ as modified or untracked');
    
    // 4. Run npx thumbgate team-sync in the client repo
    const env = {
      ...process.env,
      THUMBGATE_NO_NUDGE: '1',
      THUMBGATE_NO_TELEMETRY: '1',
    };
    
    const output = execSync(`${process.execPath} "${CLI_PATH}" team-sync`, {
      cwd: clientDir,
      env,
      encoding: 'utf8',
    });
    
    // Verify stdout tells us it committed, pulled and pushed
    assert.match(output, /Checking shared prevention rules status/);
    assert.match(output, /Local changes detected/);
    assert.match(output, /Local rules committed successfully/);
    assert.match(output, /Pulling rules/);
    assert.match(output, /Pushing rules/);
    assert.match(output, /Rebuilding local context brain/);
    assert.match(output, /Team rules synchronization complete/);
    
    // Verify prevention-rules.md is committed and clean (BRAIN.md may remain untracked)
    const statusAfter = execSync('git status --porcelain', { cwd: clientDir, encoding: 'utf8' }).trim();
    const cleanStatus = statusAfter.split('\n').filter(line => line && !line.includes('BRAIN.md')).join('\n').trim();
    assert.equal(cleanStatus, '', 'Workspace should be clean (except for auto-generated BRAIN.md) after team-sync');
    
    // Verify BRAIN.md was auto-built
    assert.ok(fs.existsSync(path.join(tgDir, 'BRAIN.md')), 'BRAIN.md should have been automatically rebuilt');
    
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
