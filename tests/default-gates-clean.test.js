'use strict';

// AGENT-3667 item F4: a fresh install's default gates carry no owner-only (ECI, marketing) gates,
// a hook call prints no license text, and the owner profile still loads when asked for.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const OWNER_GATE_IDS = ['eci-corporate-email-isolation', 'outbound-off-brand-vertical-block'];

function listGateIds(home, extra) {
  const code = `
    const { loadGatesConfig } = require(${JSON.stringify(path.join(ROOT, 'scripts', 'gates-engine.js'))});
    console.log(JSON.stringify(loadGatesConfig().gates.map((g) => g.id)));
  `;
  const env = { ...process.env, HOME: home, USERPROFILE: home, THUMBGATE_FEEDBACK_DIR: path.join(home, '.thumbgate') };
  delete env.THUMBGATE_EXTRA_GATES;
  delete env.THUMBGATE_GATES_CONFIG;
  if (extra) env.THUMBGATE_EXTRA_GATES = extra;
  const out = cp.execFileSync(process.execPath, ['-e', code], { cwd: home, env, encoding: 'utf8', timeout: 60000 });
  return JSON.parse(out.split('\n').filter((l) => l.startsWith('[')).pop());
}

test('a fresh install lists its enabled gates without the ECI or marketing gates', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-fresh-'));
  try {
    const ids = listGateIds(home);
    assert.ok(ids.length > 20, `default gates should load (${ids.length})`);
    for (const id of OWNER_GATE_IDS) assert.ok(!ids.includes(id), `${id} must not be on by default`);
    for (const id of ['rm-rf-home-or-root', 'force-push', 'terraform-destroy', 'secret-egress']) {
      assert.ok(ids.includes(id), `${id} stays on by default`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the owner profile loads when asked for and is absent otherwise', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-owner-'));
  try {
    const profile = path.join(ROOT, 'config', 'gates', 'profiles', 'private-owner.json');
    const ids = listGateIds(home, profile);
    for (const id of OWNER_GATE_IDS) assert.ok(ids.includes(id), `${id} loads from the owner profile`);
    fs.mkdirSync(path.join(home, '.config', 'thumbgate'), { recursive: true });
    fs.copyFileSync(profile, path.join(home, '.config', 'thumbgate', 'extra-gates.json'));
    const viaHome = listGateIds(home);
    for (const id of OWNER_GATE_IDS) assert.ok(viaHome.includes(id), `${id} loads from ~/.config/thumbgate/extra-gates.json`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a hook call on a free install prints no license text', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-nag-'));
  try {
    cp.execFileSync('git', ['init', '-q'], { cwd: home });
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      THUMBGATE_FEEDBACK_DIR: path.join(home, '.thumbgate'),
      THUMBGATE_NO_RATE_LIMIT: '1',
      CLAUDE_PROJECT_DIR: home,
    };
    delete env.THUMBGATE_LICENSE;
    delete env.THUMBGATE_LICENSE_ADVISORY;
    const input = JSON.stringify({ session_id: 'nag', cwd: home, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls -la' } });
    const res = cp.spawnSync(process.execPath, [CLI, 'gate-check'], { cwd: home, env, input, encoding: 'utf8', timeout: 60000 });
    const all = `${res.stdout}\n${res.stderr}`;
    assert.ok(!/paid license|thumbgate\.ai\/pricing|Advisory mode/i.test(all), `no license text expected, got: ${all.slice(0, 300)}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
