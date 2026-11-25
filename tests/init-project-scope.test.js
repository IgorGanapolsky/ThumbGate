'use strict';

// `init --project` must write Claude Code hooks into the repo, and plain `init`
// must keep writing them machine-wide. Before 2026-11-25 init ignored --project
// and always wrote ~/.claude/settings.local.json, while the README promised
// per-project hooks.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-init-scope-'));
  const home = path.join(root, 'home');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  return { root, home, repo };
}

function runInit(box, extraArgs) {
  const env = { ...process.env, HOME: box.home, USERPROFILE: box.home, THUMBGATE_NO_TELEMETRY: '1' };
  delete env.THUMBGATE_FEEDBACK_DIR;
  execFileSync(process.execPath, [CLI, 'init', '--agent', 'claude-code', ...extraArgs], {
    cwd: box.repo,
    env,
    stdio: 'pipe',
    timeout: 120000,
  });
}

function hasPreToolUse(file) {
  if (!fs.existsSync(file)) return false;
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Boolean(settings.hooks && Array.isArray(settings.hooks.PreToolUse) && settings.hooks.PreToolUse.length > 0);
}

test('init --project writes Claude Code hooks to <repo>/.claude/settings.json only', () => {
  const box = sandbox();
  try {
    runInit(box, ['--project']);
    assert.equal(hasPreToolUse(path.join(box.repo, '.claude', 'settings.json')), true);
    assert.equal(hasPreToolUse(path.join(box.home, '.claude', 'settings.local.json')), false);
    assert.equal(hasPreToolUse(path.join(box.home, '.claude', 'settings.json')), false);
  } finally {
    fs.rmSync(box.root, { recursive: true, force: true });
  }
});

test('plain init keeps writing Claude Code hooks to ~/.claude/settings.local.json', () => {
  const box = sandbox();
  try {
    runInit(box, []);
    assert.equal(hasPreToolUse(path.join(box.home, '.claude', 'settings.local.json')), true);
    assert.equal(hasPreToolUse(path.join(box.repo, '.claude', 'settings.json')), false);
  } finally {
    fs.rmSync(box.root, { recursive: true, force: true });
  }
});
