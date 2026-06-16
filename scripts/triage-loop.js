'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { dream } = require('./dream-consolidation');

function runCommandSafe(cmd, cwd) {
  try {
    return execSync(cmd, { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    return `ERROR: ${err.message}\n${err.stderr || ''}`;
  }
}

async function runTriageLoop(options = {}) {
  const cwd = options.cwd || process.cwd();
  const pkgRoot = options.pkgRoot || path.join(__dirname, '..');
  const reports = [];

  reports.push('🧹 [Triage Loop] Starting autonomous repository hygiene and triage...');
  reports.push(`📂 Working Directory: ${cwd}`);

  // 1. Git workspace status
  const gitStatus = runCommandSafe('git status --porcelain', cwd);
  const isDirty = Boolean(gitStatus && !gitStatus.startsWith('ERROR'));
  if (isDirty) {
    reports.push('⚠️  Dirty working tree detected. Modified files:');
    reports.push(gitStatus.split('\n').map(line => `   - ${line}`).join('\n'));
  } else {
    reports.push('✅ Working tree is clean.');
  }

  // 2. Unpushed commits check
  const unpushed = runCommandSafe('git log @{u}.. --oneline', cwd);
  if (unpushed && !unpushed.startsWith('ERROR')) {
    reports.push('📤 Unpushed local commits detected:');
    reports.push(unpushed.split('\n').map(line => `   - ${line}`).join('\n'));
  } else if (unpushed.startsWith('ERROR:')) {
    reports.push('ℹ️  No upstream tracking branch configured or git error checking unpushed commits.');
  } else {
    reports.push('✅ No unpushed commits.');
  }

  // 3. Git pull (remote update) if clean
  if (!isDirty) {
    reports.push('📥 Fetching and rebasing from remote (git pull --rebase)...');
    const pullResult = runCommandSafe('git pull --rebase', cwd);
    reports.push(`   ${pullResult.slice(0, 300)}`);
  } else {
    reports.push('⏭️  Skipping git pull --rebase due to dirty working tree.');
  }

  // 4. Run tests to verify repo health
  reports.push('🧪 Running test suite verification...');
  let testPass = false;
  let testOutput = '';
  try {
    // Detect package.json and run test command
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts && pkg.scripts.test) {
        testOutput = execSync('npm test', { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        testPass = true;
      } else {
        testOutput = 'No test script found in package.json';
      }
    } else {
      testOutput = 'No package.json found in current directory';
    }
  } catch (err) {
    testOutput = err.stdout + '\n' + err.stderr;
    testPass = false;
  }
  
  if (testPass) {
    reports.push('✅ Test suite passed successfully.');
  } else {
    reports.push('❌ Test suite failed or could not be run. Diagnostics:');
    reports.push(testOutput.split('\n').slice(0, 10).map(line => `   > ${line}`).join('\n'));
  }

  // 5. Silicon Dreaming (Memory consolidation & brain rebuilding)
  reports.push('💤 Executing Silicon Dreaming consolidation loop...');
  try {
    const dreamResult = await dream({
      pkgRoot,
      feedbackDir: path.join(cwd, '.thumbgate'),
      rulesPath: path.join(cwd, '.thumbgate', 'prevention-rules.md'),
      minOccurrences: 2,
    });
    reports.push(`✅ Consolidation complete. Merged ${dreamResult.consolidated} duplicates.`);
  } catch (dreamErr) {
    reports.push(`⚠️  Dreaming consolidation failed: ${dreamErr.message}`);
  }

  reports.push('🚀 [Triage Loop] Hygiene run completed.');
  return {
    success: true,
    testPass,
    log: reports.join('\n'),
  };
}

module.exports = { runTriageLoop };
