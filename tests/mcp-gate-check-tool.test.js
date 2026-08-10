'use strict';

// `gate_check` is the enforcement surface for harnesses with NO pre-tool hook —
// Cline, Cursor, OpenCode. adapters/cline/.clinerules has instructed agents to call
// `thumbgate.gate_check` since the adapter shipped, and adapters/cline/INSTALL.md
// tells users to verify it works. The tool did not exist: tools/list returned 42
// tools and none of them was gate_check. That enforcement was inert.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');

function mcp(requests, env = {}) {
  return new Promise((resolve, reject) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-gc-'));
    const child = spawn(process.execPath, [CLI, 'serve'], {
      env: { ...process.env, HOME: home, THUMBGATE_HOME: path.join(home, '.thumbgate'), ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    const expectedIds = new Set(
      [0, ...requests.map((r) => r.id).filter((id) => id !== undefined && id !== null)].map(String)
    );
    const seenIds = new Set();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already exited */ }
      try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
      const messages = [];
      for (const line of out.split('\n')) {
        if (!line.trim().startsWith('{')) continue;
        try { messages.push(JSON.parse(line)); } catch { /* not a frame */ }
      }
      resolve(messages);
    };
    const timer = setTimeout(() => {
      finish();
    }, 60000);
    // Drain stderr so license/model noise cannot block the MCP child on a full pipe.
    child.stderr.on('data', () => {});
    child.stdout.on('data', (c) => {
      out += c;
      for (const line of String(c).split('\n')) {
        if (!line.trim().startsWith('{')) continue;
        try {
          const msg = JSON.parse(line);
          if (msg && msg.id !== undefined && msg.id !== null) {
            seenIds.add(String(msg.id));
          }
        } catch { /* partial/non-json line */ }
      }
      if ([...expectedIds].every((id) => seenIds.has(id))) {
        // Keep stdin open until all expected RPC responses arrive; closing stdin
        // immediately races server shutdown and drops tools/call replies under load.
        try { child.stdin.end(); } catch { /* ignore */ }
        finish();
      }
    });
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
    child.on('close', () => {
      finish();
    });
    const send = (o) => child.stdin.write(`${JSON.stringify(o)}\n`);
    send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    for (const r of requests) send(r);
  });
}

// One server per ENV, not one per assertion. Spawning five MCP servers in a file that
// node --test runs concurrently with other files put us within reach of the timeout
// under load — a flake, not a real failure, but it would land in CI as one.
const GATE = (command) => ({ tool_name: 'Bash', tool_input: { command } });

let defaultSession;
let strictSession;

function session(env) {
  return mcp([
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'gate_check', arguments: GATE('rm -rf /') } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'gate_check', arguments: GATE('echo hello') } },
  ], env);
}

function verdict(msgs, id) {
  const m = msgs.find((x) => x.id === id);
  assert.ok(m, `no response for id ${id}`);
  assert.ok(!m.error, `tools/call errored: ${JSON.stringify(m.error)}`);
  return JSON.parse(m.result.content[0].text);
}

test.before(async () => {
  [defaultSession, strictSession] = await Promise.all([
    session({ THUMBGATE_STRICT_ENFORCEMENT: '0' }),
    session({ THUMBGATE_STRICT_ENFORCEMENT: '1' }),
  ]);
});

test('gate_check is exposed in tools/list', () => {
  const listed = defaultSession.find((m) => m.id === 1 && m.result && m.result.tools);
  assert.ok(listed, 'no tools/list response');
  const names = listed.result.tools.map((t) => t.name);
  assert.ok(names.includes('gate_check'),
    'gate_check must be exposed — adapters/cline/.clinerules tells agents to call it');
});

test('gate_check BLOCKS a destructive command under strict enforcement', () => {
  const v = verdict(strictSession, 2);
  assert.equal(v.decision, 'block');
  assert.equal(v.flagged, true);
  assert.match(v.reason, /\[GATE:/, 'must name the gate that matched');
});

test('a flagged action NEVER reads as allow, even in warn-by-default mode', () => {
  // The failure this pins: the engine downgrades a matched gate to a warning by
  // default. Reporting that as "allow" would make .clinerules ("abort on block")
  // run rm -rf / while the warning text sat unread in a field agents ignore.
  const v = verdict(defaultSession, 2);
  assert.notEqual(v.decision, 'allow',
    'a matched gate must never be reported as allow — this is how the tool becomes theater');
  assert.equal(v.decision, 'warn');
  assert.equal(v.flagged, true);
  assert.equal(v.enforcement, 'warn-by-default',
    'the client must be told WHY a matched gate did not hard-block');
  assert.match(v.guidance, /confirmation/i, 'must tell the agent not to proceed unprompted');
});

test('gate_check allows a benign command — the guard is not vacuous', () => {
  const v = verdict(strictSession, 3);
  assert.equal(v.decision, 'allow');
  assert.equal(v.flagged, false);
});

test('.clinerules documents every decision value the tool can return', () => {
  const rules = fs.readFileSync(path.join(ROOT, 'adapters', 'cline', '.clinerules'), 'utf8');
  for (const value of ['block', 'warn', 'error']) {
    assert.ok(rules.includes(`\`${value}\``),
      `.clinerules must tell the agent what to do on "${value}" — an undocumented decision is ignored`);
  }
});
