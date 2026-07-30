'use strict';

// Every agent we ADVERTISE must have a real implementation.
//
// Before this test: README.md's install table and `init --help` both listed
// `--agent opencode` and `--agent amp`. Neither had a reachable handler.
// `--agent opencode` wrote Claude/Codex/Gemini config, printed the wiring
// rejection as an ordinary log line, and exited 0 — so a user ran the documented
// command, saw success, and had no OpenCode integration. `--agent <typo>` did the
// same. This is the declared-vs-actual defect class: a promised surface with
// nothing comparing the promise to the code.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');

function supportedAgents() {
  // SUPPORTED_AGENTS is module-internal; read it from the CLI's own --help output
  // so the test pins what users are actually TOLD, not an internal we could drift from.
  const help = execFileSync(process.execPath, [CLI, 'init', '--help'], { encoding: 'utf8' });
  // Match the OPTION line, not the Usage: line — both contain '--agent <name>'.
  const line = help.split('\n').find((l) => l.includes('Wire a specific agent:'));
  assert.ok(line, 'init --help must document --agent');
  const listed = line.split('agent:')[1];
  assert.ok(listed, '--agent help must enumerate supported agents');
  return listed.split(',').map((a) => a.trim()).filter(Boolean);
}

test('README install table advertises only agents the CLI supports', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const advertised = [...readme.matchAll(/thumbgate init --agent ([a-z-]+)/g)].map((m) => m[1]);
  assert.ok(advertised.length >= 3, 'expected an install table with several agents');

  const supported = supportedAgents();
  for (const agent of new Set(advertised)) {
    assert.ok(supported.includes(agent),
      `README documents "npx thumbgate init --agent ${agent}" but the CLI does not support it. `
      + `Supported: ${supported.join(', ')}. Either implement it or stop advertising it.`);
  }
});

test('every advertised agent has a reachable handler — hook wiring or a setup function', () => {
  const { detectAgent } = require('../scripts/auto-wire-hooks.js');
  const cli = fs.readFileSync(CLI, 'utf8');

  for (const agent of supportedAgents()) {
    const hookable = Boolean(detectAgent(agent));
    // Non-hookable agents must have an explicit setup entry in SUPPORTED_AGENTS.
    const hasSetup = new RegExp(`['"]?${agent}['"]?:\\s*\\{[^}]*setup:`).test(cli);
    assert.ok(hookable || hasSetup,
      `--agent ${agent} is advertised but auto-wire-hooks rejects it AND it has no setup() `
      + `in SUPPORTED_AGENTS, so the flag silently does nothing for that agent`);
  }
});

test('an unknown --agent fails loudly instead of exiting 0', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-agent-'));
  let code = 0;
  let stderr = '';
  try {
    execFileSync(process.execPath, [CLI, 'init', '--agent', 'definitely-not-an-agent'], {
      cwd: home,
      env: { ...process.env, HOME: home, THUMBGATE_NONINTERACTIVE: '1', CI: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    code = err.status;
    stderr = String(err.stderr || '');
  }
  fs.rmSync(home, { recursive: true, force: true });
  assert.equal(code, 1, 'a typo in --agent must not exit 0 pretending it worked');
  assert.match(stderr, /Unknown --agent/, 'must name the problem');
  assert.match(stderr, /Supported:/, 'must list what IS supported so the user can self-serve');
});

test('setupOpenCode writes a real OpenCode MCP config', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-oc-'));
  execFileSync(process.execPath, [CLI, 'init', '--agent', 'opencode'], {
    cwd: home,
    env: { ...process.env, HOME: home, THUMBGATE_NONINTERACTIVE: '1', CI: '1' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const configPath = path.join(home, '.config', 'opencode', 'opencode.json');
  assert.ok(fs.existsSync(configPath), `--agent opencode must write ${configPath}`);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.ok(config.mcp && config.mcp.thumbgate, 'must register the thumbgate MCP server');
  assert.ok(Array.isArray(config.mcp.thumbgate.command), 'server entry must carry a launch command');
  fs.rmSync(home, { recursive: true, force: true });
});

test('documented agent aliases resolve instead of being rejected', () => {
  // scripts/auto-wire-hooks.js accepts `claude` for `claude-code`, and
  // plugins/claude-skill/README.md publishes `npx thumbgate init --agent claude`.
  // The first version of the unknown-agent guard used an exact-key lookup and turned
  // that published command into exit 1 — fixing one silent failure by creating a loud one.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-alias-'));
  execFileSync(process.execPath, [CLI, 'init', '--agent', 'claude'], {
    cwd: home,
    env: { ...process.env, HOME: home, THUMBGATE_NONINTERACTIVE: '1', CI: '1' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.ok(fs.existsSync(path.join(home, '.claude', 'settings.json')),
    '--agent claude must wire Claude Code, not error');
  fs.rmSync(home, { recursive: true, force: true });
});

test('an unparseable OpenCode config is preserved, never overwritten', () => {
  // OpenCode configs accept JSONC. Treating a parse failure as an empty object and
  // writing would replace the whole file — deleting the user's model, provider and
  // plugin settings to add ours.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ocp-'));
  const configPath = path.join(home, '.config', 'opencode', 'opencode.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = '{\n  // JSONC comment\n  "model": "anthropic/claude-opus-4",\n  "provider": { "anthropic": { "apiKey": "sk-user-key" } },\n}\n';
  fs.writeFileSync(configPath, original);

  try {
    execFileSync(process.execPath, [CLI, 'init', '--agent', 'opencode'], {
      cwd: home,
      env: { ...process.env, HOME: home, THUMBGATE_NONINTERACTIVE: '1', CI: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch { /* non-zero exit is the correct refusal signal */ }

  assert.equal(fs.readFileSync(configPath, 'utf8'), original,
    'a config we cannot parse must be left exactly as-is');
  fs.rmSync(home, { recursive: true, force: true });
});
