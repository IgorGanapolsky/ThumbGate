'use strict';

// AGENT-3667 (lead brief 4:00 PM): the README says "no cloud required for the enforcement path". This runs the
// Claude Code hook path (`gate-check`) with every network entry point in the Node process made to record and throw,
// then asserts the deny still happens and nothing tried to reach the network.
// Limit: this covers the Node process only. A child process it starts could still use the network (git, for example,
// is not exercised by this command), and it covers the gate-check hook, not `thumbgate init`, the dashboard or sync.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

const STUB = `
const fs = require('node:fs');
const log = process.env.NET_ATTEMPT_LOG;
const note = (what) => fs.appendFileSync(log, what + '\\n');
const net = require('node:net');
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) { note('net.connect ' + JSON.stringify(a[0])); throw new Error('network blocked by test'); };
const dns = require('node:dns');
for (const fn of ['lookup', 'resolve', 'resolve4', 'resolve6']) { const o = dns[fn]; dns[fn] = function (host) { note('dns.' + fn + ' ' + host); throw new Error('network blocked by test'); }; }
if (dns.promises) for (const fn of ['lookup', 'resolve']) dns.promises[fn] = async (host) => { note('dns.promises.' + fn + ' ' + host); throw new Error('network blocked by test'); };
globalThis.fetch = async (u) => { note('fetch ' + u); throw new Error('network blocked by test'); };
for (const m of ['node:http', 'node:https']) { const mod = require(m); for (const fn of ['request', 'get']) mod[fn] = function (u) { note(m + '.' + fn + ' ' + (u && u.href || u)); throw new Error('network blocked by test'); }; }
void origConnect;
`;

function run(command, extraEnv = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-offline-')));
  const project = path.join(home, 'proj');
  fs.mkdirSync(project);
  cp.execFileSync('git', ['init', '-q'], { cwd: project });
  const stub = path.join(home, 'no-network.js');
  fs.writeFileSync(stub, STUB);
  const attempts = path.join(home, 'attempts.log');
  fs.writeFileSync(attempts, '');
  const env = { ...process.env, HOME: home, USERPROFILE: home, THUMBGATE_FEEDBACK_DIR: path.join(project, '.thumbgate'), THUMBGATE_NO_RATE_LIMIT: '1', NET_ATTEMPT_LOG: attempts, NODE_OPTIONS: `--require ${stub}`, ...extraEnv };
  for (const n of ['THUMBGATE_STRICT_ENFORCEMENT', 'THUMBGATE_GOVERNANCE_MODE', 'THUMBGATE_CLI']) delete env[n];
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: project, session_id: 'offline', hook_event_name: 'PreToolUse' });
  const res = cp.spawnSync(process.execPath, [CLI, 'gate-check'], { cwd: project, env, input, encoding: 'utf8', timeout: 90000 });
  const lines = String(res.stdout).trim().split('\n').filter(Boolean);
  let out = {};
  for (let i = lines.length - 1; i >= 0; i -= 1) { try { out = JSON.parse(lines[i]); break; } catch { /* next */ } }
  const h = out.hookSpecificOutput || {};
  const result = { decision: h.permissionDecision || 'none', reason: String(h.permissionDecisionReason || ''), attempts: fs.readFileSync(attempts, 'utf8').trim(), stderr: res.stderr };
  fs.rmSync(home, { recursive: true, force: true });
  return result;
}

test('the stub really blocks the network (a control, so a pass below means something)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-offline-ctl-'));
  try {
    const stub = path.join(home, 'no-network.js');
    const log = path.join(home, 'log');
    fs.writeFileSync(stub, STUB);
    fs.writeFileSync(log, '');
    const r = cp.spawnSync(process.execPath, ['-e', "fetch('https://example.invalid').catch(()=>{}); require('node:dns').lookup('example.invalid',()=>{});"], { env: { ...process.env, NODE_OPTIONS: `--require ${stub}`, NET_ATTEMPT_LOG: log }, encoding: 'utf8' });
    assert.notEqual(fs.readFileSync(log, 'utf8').trim(), '', `stub recorded nothing; stderr: ${r.stderr}`);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('gate-check denies rm -rf ~/ with every network call blocked, and makes no network attempt', () => {
  const r = run('rm -rf ~/');
  assert.equal(r.decision, 'deny', JSON.stringify({ ...r, stderr: r.stderr.slice(0, 300) }));
  assert.equal(r.attempts, '', `network attempts: ${r.attempts}`);
});

test('gate-check allows ls with every network call blocked, and makes no network attempt', () => {
  const r = run('ls -la');
  assert.notEqual(r.decision, 'deny');
  assert.equal(r.attempts, '', `network attempts: ${r.attempts}`);
});
