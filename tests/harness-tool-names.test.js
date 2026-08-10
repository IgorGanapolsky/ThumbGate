'use strict';

// Policy gates match Claude Code's vocabulary (Bash, Write, Edit). Other harnesses use
// their own. adapters/cline/.clinerules instructs the agent to gate-check
// `execute_command`, `write_to_file`, `replace_in_file` and `browser_action` — and
// gate_check forwarded those straight through, so every gate missed and
// {tool_name: "execute_command", command: "rm -rf /"} returned ALLOW.
//
// The first version of the gate_check test asserted with `Bash` and passed while the
// documented Cline path was wide open. These tests use the HARNESS names on purpose.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const { canonicalizeToolCall } = require('../scripts/harness-tool-names');

test('harness tool names map onto the vocabulary gates actually match', () => {
  assert.equal(canonicalizeToolCall('execute_command', {}).toolName, 'Bash');
  assert.equal(canonicalizeToolCall('write_to_file', {}).toolName, 'Write');
  assert.equal(canonicalizeToolCall('replace_in_file', {}).toolName, 'Edit');
  assert.equal(canonicalizeToolCall('run_terminal_cmd', {}).toolName, 'Bash');
  // Canonical names must pass through untouched.
  assert.equal(canonicalizeToolCall('Bash', {}).toolName, 'Bash');
  // Unknown names are forwarded rather than dropped — better a miss than a wrong gate.
  assert.equal(canonicalizeToolCall('some_future_tool', {}).toolName, 'some_future_tool');
});

test('argument keys are remapped, and never clobber a canonical key', () => {
  assert.deepEqual(canonicalizeToolCall('write_to_file', { path: 'a.js' }).toolInput, { file_path: 'a.js' });
  assert.deepEqual(canonicalizeToolCall('shell', { cmd: 'ls' }).toolInput, { command: 'ls' });
  const both = canonicalizeToolCall('Bash', { command: 'canonical', cmd: 'alias' }).toolInput;
  assert.equal(both.command, 'canonical', 'an alias key must not overwrite the canonical one');
});

function gateCheck(toolName, toolInput, env = {}) {
  return new Promise((resolve, reject) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-htn-'));
    const child = spawn(process.execPath, [CLI, 'serve'], {
      env: { ...process.env, HOME: home, THUMBGATE_HOME: path.join(home, '.thumbgate'), ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already exited */ }
      try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('timeout'))), 60000);
    // Drain stderr so license/model noise cannot block the MCP child on a full pipe.
    child.stderr.on('data', () => {});
    child.stdout.on('data', (c) => {
      out += c;
      for (const line of String(c).split('\n')) {
        if (!line.trim().startsWith('{')) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 9 && m.result && m.result.content && m.result.content[0]) {
          // Keep stdin open until the tools/call reply arrives; early EOF races
          // server shutdown and drops gate_check responses under CI load.
          try { child.stdin.end(); } catch { /* ignore */ }
          return finish(() => resolve(JSON.parse(m.result.content[0].text)));
        }
      }
    });
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', () => {
      finish(() => {
        for (const line of out.split('\n')) {
          if (!line.trim().startsWith('{')) continue;
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (m.id === 9 && m.result && m.result.content && m.result.content[0]) {
            return resolve(JSON.parse(m.result.content[0].text));
          }
        }
        reject(new Error('no gate_check response'));
      });
    });
    const send = (o) => child.stdin.write(`${JSON.stringify(o)}\n`);
    send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'gate_check', arguments: { tool_name: toolName, tool_input: toolInput } } });
  });
}

test("gate_check blocks rm -rf / under Cline's OWN tool name", async () => {
  const v = await gateCheck('execute_command', { command: 'rm -rf /' }, { THUMBGATE_STRICT_ENFORCEMENT: '1' });
  assert.equal(v.decision, 'block',
    'adapters/cline/.clinerules advertises exactly this scenario as protected');
});

test('gate_check still allows benign work under a harness tool name', async () => {
  const v = await gateCheck('execute_command', { command: 'echo hello' }, { THUMBGATE_STRICT_ENFORCEMENT: '1' });
  assert.equal(v.decision, 'allow');
});

test('every tool name .clinerules tells the agent to check is mapped or canonical', () => {
  const rules = fs.readFileSync(path.join(ROOT, 'adapters', 'cline', '.clinerules'), 'utf8');
  const CANONICAL = new Set(['Bash', 'Write', 'Edit', 'MultiEdit']);
  const named = [...rules.matchAll(/`([a-z_]+)`/g)].map((m) => m[1])
    .filter((n) => n.includes('_') && !n.startsWith('gate'));
  assert.ok(named.length >= 3, `expected .clinerules to name harness tools, found ${named.join(',')}`);
  const unmapped = named.filter((n) => !CANONICAL.has(canonicalizeToolCall(n, {}).toolName));
  assert.deepEqual(unmapped, [],
    `.clinerules tells the agent to gate-check ${unmapped.join(', ')}, but those do not map to a `
    + 'name any gate matches, so the check silently passes');
});
