'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { staleHookPath } = require('../scripts/auto-wire-hooks');

const ROOT = path.join(__dirname, '..');

function hookCommands(settings) {
  const commands = [];
  for (const entries of Object.values((settings && settings.hooks) || {})) {
    for (const entry of entries || []) {
      for (const hook of entry.hooks || []) {
        if (hook && typeof hook.command === 'string') commands.push(hook.command);
      }
    }
  }
  if (settings && settings.statusLine && typeof settings.statusLine.command === 'string') {
    commands.push(settings.statusLine.command);
  }
  return commands;
}

function trackedSettingsFiles() {
  const listed = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
  return listed.filter((file) => /(^|\/)\.claude\/settings(\.local)?\.json$/.test(file));
}

test('every tracked .claude/settings.json hook command points at a path that exists', () => {
  const files = trackedSettingsFiles();
  assert.ok(files.length > 0, 'expected a tracked .claude/settings.json');
  for (const file of files) {
    const settings = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    for (const command of hookCommands(settings)) {
      assert.equal(staleHookPath(command, ROOT), null, `${file}: dead path in hook command: ${command}`);
    }
  }
});

test('tracked hook commands never hard-code a worktree or another checkout of this repo', () => {
  for (const file of trackedSettingsFiles()) {
    const settings = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    for (const command of hookCommands(settings)) {
      assert.doesNotMatch(command, /\/workspace\/ThumbGate-[\w.-]+\//, `${file}: ${command}`);
      assert.doesNotMatch(command, /\.thumbgate-worktrees\//, `${file}: ${command}`);
    }
  }
});

test('staleHookPath catches a dead script behind an interpreter (the 23 Nov 2026 break)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-hookpath-'));
  fs.writeFileSync(path.join(dir, 'ok.js'), '');
  const dead = '/Users/nobody/workspace/ThumbGate-main-live/scripts/hook-pre-tool-use.js';
  assert.equal(staleHookPath(`node ${dead}`, dir), dead);
  assert.equal(staleHookPath(`node --no-warnings ${dead} --flag`, dir), dead);
  assert.equal(staleHookPath('node ok.js', dir), null);
  assert.equal(staleHookPath(`node ${path.join(dir, 'ok.js')}`, dir), null);
  assert.equal(staleHookPath('node missing.js', dir), 'missing.js');
  assert.equal(staleHookPath('node -e "1"', dir), null, 'inline code has no script path');
  assert.equal(staleHookPath('npx thumbgate gate-check', dir), null, 'non-interpreter commands are left alone');
  fs.rmSync(dir, { recursive: true, force: true });
});
