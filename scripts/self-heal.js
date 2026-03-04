#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, 'package.json');
const KNOWN_FIX_SCRIPTS = ['lint:fix', 'format', 'fix', 'feedback:rules'];

function runCommand(command, { cwd = PROJECT_ROOT, timeoutMs = 5 * 60_000 } = {}) {
  const [cmd, ...args] = command;
  const started = Date.now();
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf-8',
    timeout: timeoutMs,
    shell: false,
  });

  return {
    command: command.join(' '),
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    durationMs: Date.now() - started,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : null,
  };
}

function loadPackageScripts(packageJsonPath = PACKAGE_JSON_PATH) {
  const raw = fs.readFileSync(packageJsonPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return parsed.scripts || {};
}

function buildFixPlan(scripts) {
  return KNOWN_FIX_SCRIPTS.filter((name) => Object.prototype.hasOwnProperty.call(scripts, name));
}

function listChangedFiles({ cwd = PROJECT_ROOT } = {}) {
  const diff = runCommand(['git', 'diff', '--name-only'], { cwd, timeoutMs: 10_000 });
  if (diff.exitCode !== 0) return [];
  return diff.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function runFixPlan({ plan, runner = runCommand, cwd = PROJECT_ROOT } = {}) {
  const results = [];
  plan.forEach((scriptName) => {
    const run = runner(['npm', 'run', scriptName], { cwd, timeoutMs: 10 * 60_000 });
    results.push({
      script: scriptName,
      status: run.exitCode === 0 ? 'success' : 'failed',
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      error: run.error,
      outputTail: `${run.stdout}\n${run.stderr}`.trim().slice(-2000),
    });
  });

  const successful = results.filter((x) => x.status === 'success').length;
  return {
    successful,
    failed: results.length - successful,
    total: results.length,
    results,
  };
}

function runSelfHeal({ reason = 'unknown', cwd = PROJECT_ROOT } = {}) {
  const beforeChanges = listChangedFiles({ cwd });
  const beforeSet = new Set(beforeChanges);
  const scripts = loadPackageScripts();
  const plan = buildFixPlan(scripts);
  const execution = runFixPlan({ plan, cwd });
  const afterChanges = listChangedFiles({ cwd });
  const changedFiles = afterChanges.filter((filePath) => !beforeSet.has(filePath));

  return {
    timestamp: new Date().toISOString(),
    reason,
    plan,
    execution,
    preExistingChanges: beforeChanges,
    changedFiles,
    changed: changedFiles.length > 0,
    healthy: execution.failed === 0,
  };
}

function runCli() {
  const reasonArg = process.argv.slice(2).find((a) => a.startsWith('--reason='));
  const reason = reasonArg ? reasonArg.slice('--reason='.length) : 'manual';
  const report = runSelfHeal({ reason });
  console.log(JSON.stringify(report, null, 2));

  if (!report.healthy) {
    process.exit(1);
  }
}

module.exports = {
  KNOWN_FIX_SCRIPTS,
  loadPackageScripts,
  buildFixPlan,
  runFixPlan,
  runSelfHeal,
};

if (require.main === module) {
  runCli();
}
