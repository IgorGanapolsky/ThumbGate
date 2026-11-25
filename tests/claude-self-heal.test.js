'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const SELF_HEAL = path.join(__dirname, '..', 'scripts', 'claude-self-heal.js');

// Run in a child so getHome() in auto-wire-hooks sees the sandbox HOME.
function runRepair(home, extraEnv = {}) {
  const script = `const r = require(${JSON.stringify(SELF_HEAL)}).repairUnreadClaudeHooks();
process.stderr.write('RESULT ' + JSON.stringify({ changed: !!r.changed, reason: r.reason || null }) + '\\n');`;
  const res = spawnSync(process.execPath, ['-e', script], {
    env: { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv },
    encoding: 'utf8',
    timeout: 60000,
  });
  const line = (res.stderr || '').split('\n').find((l) => l.startsWith('RESULT '));
  return { stdout: res.stdout, result: line ? JSON.parse(line.slice(7)) : null };
}

function sandboxWithLegacyHooks() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claude-heal-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.local.json'), JSON.stringify({
    permissions: { allow: ['Bash(ls)'] },
    hooks: {
      PreToolUse: [
        { matcher: '.*', hooks: [{ type: 'command', command: '"/h/.thumbgate/bin/thumbgate-hook" gate-check' }] },
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-own-hook.sh' }] },
      ],
    },
  }));
  return home;
}

function preToolUseCommands(file) {
  if (!fs.existsSync(file)) return [];
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  return ((s.hooks && s.hooks.PreToolUse) || []).flatMap((e) => (e.hooks || []).map((h) => h.command));
}

test('MCP-start self-heal moves ThumbGate hooks from the unread settings.local.json to settings.json, once', () => {
  const home = sandboxWithLegacyHooks();
  try {
    const first = runRepair(home);
    assert.equal(first.result.changed, true);
    assert.equal(first.stdout, '', 'self-heal must not write to stdout (MCP JSON-RPC channel)');

    const local = path.join(home, '.claude', 'settings.local.json');
    assert.deepEqual(preToolUseCommands(local), ['my-own-hook.sh'], 'only the user hook stays behind');
    assert.deepEqual(JSON.parse(fs.readFileSync(local, 'utf8')).permissions, { allow: ['Bash(ls)'] });
    assert.ok(preToolUseCommands(path.join(home, '.claude', 'settings.json')).some((c) => /gate-check/.test(c)));

    const second = runRepair(home);
    assert.equal(second.result.changed, false);
    assert.equal(second.result.reason, 'nothing-to-move');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('self-heal does nothing without legacy hooks or when disabled', () => {
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claude-heal-clean-'));
  const legacy = sandboxWithLegacyHooks();
  try {
    assert.equal(runRepair(clean).result.reason, 'nothing-to-move');
    assert.equal(fs.existsSync(path.join(clean, '.claude', 'settings.json')), false);

    assert.equal(runRepair(legacy, { THUMBGATE_DISABLE_CLAUDE_SELF_HEAL: '1' }).result.reason, 'disabled');
    assert.equal(fs.existsSync(path.join(legacy, '.claude', 'settings.json')), false);
  } finally {
    fs.rmSync(clean, { recursive: true, force: true });
    fs.rmSync(legacy, { recursive: true, force: true });
  }
});
