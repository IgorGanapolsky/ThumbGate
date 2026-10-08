'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runDemo(mode = 'valid', args = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-buyer-demo-'));
  try {
    for (const dir of ['demo', 'bin', 'scripts']) fs.mkdirSync(path.join(root, dir));
    fs.copyFileSync(path.resolve(__dirname, '../demo/scale-the-vibe-demo.sh'), path.join(root, 'demo/scale-the-vibe-demo.sh'));
    fs.writeFileSync(path.join(root, 'scripts/gates-engine.js'), '');
    fs.writeFileSync(path.join(root, 'scripts/auto-promote-gates.js'), `
const fs = require('node:fs');
const path = require('node:path');
const target = path.join(process.env.THUMBGATE_FEEDBACK_DIR, 'promoted.json');
exports.promote = () => {
  if (process.env.DEMO_FIXTURE !== 'learning-failed') fs.writeFileSync(target, '{}');
  return { promotions: [{ type: 'new', gateId: 'learned', action: 'block' }] };
};
exports.getAutoGatesPath = () => target;
exports.loadAutoGates = () => ({ gates: [{ pattern: process.env.DEMO_FIXTURE === 'bad-pattern' ? 'entity:Customer' : process.env.LEARN_CMD, action: 'block' }] });
`);
    fs.writeFileSync(path.join(root, 'bin/cli.js'), `
const fs = require('node:fs');
const path = require('node:path');
const mode = process.env.DEMO_FIXTURE;
if (process.argv[2] === 'serve') {
  const rl = require('node:readline').createInterface({ input: process.stdin });
  process.stdin.on('end', () => process.exit(0));
  let initialized = false;
  rl.on('line', (line) => {
    const request = JSON.parse(line);
    if (request.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } } }) + '\\n');
    } else if (request.method === 'notifications/initialized') {
      initialized = true;
    } else if (request.method === 'tools/call' && request.params.name === 'gate_check' && initialized) {
      if (request.params.arguments.tool_input.command !== 'echo demo-mcp-probe') throw new Error('expected inert safe probe');
      setTimeout(() => {
        if (mode === 'mcp-missing') return process.exit(0);
        if (mode === 'mcp-malformed') return process.stdout.write('not JSON\\n');
        if (mode === 'mcp-error') return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'fixture failure' } }) + '\\n');
        const verdict = mode === 'mcp-empty' ? {} : { decision: mode === 'mcp-deny' ? 'block' : 'allow', flagged: false, enforcement: 'strict' };
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(verdict) }] } }) + '\\n');
      }, 40);
    }
  });
} else {
  const command = JSON.parse(fs.readFileSync(0, 'utf8')).tool_input.command;
  if (mode === 'cli-empty') process.exit(0);
  if (mode === 'cli-error-context') { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: '[ThumbGate Error] fixture failure' } })); process.exit(0); }
  if (mode === 'cli-warning' && command.startsWith('curl -s')) { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: '[GATE:fixture] WARNING: review egress' } })); process.exit(0); }
  if (mode === 'cli-malformed') { process.stdout.write('not JSON'); process.exit(0); }
  if (mode === 'cli-missing-decision') { process.stdout.write('{"unexpected":true}'); process.exit(0); }
  const learned = command.startsWith('kubectl') && fs.existsSync(path.join(process.env.THUMBGATE_FEEDBACK_DIR, 'promoted.json'));
  const dangerous = /^(rm |git push|psql |curl -X|curl -T|cat )/.test(command);
  const deny = mode === 'danger-allowed' ? false : (dangerous || learned || (mode === 'safe-denied' && command === 'git status'));
  process.stdout.write(JSON.stringify(deny ? { hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: '[GATE:fixture]' } } : {}));
}
`);
    return spawnSync('bash', [path.join(root, 'demo/scale-the-vibe-demo.sh'), ...args], {
      cwd: root,
      encoding: 'utf8',
      // Cover 10s initialization + 60s reply + 4s cleanup and 46s for CLI/host overhead.
      timeout: 120000,
      env: { ...process.env, DEMO_FIXTURE: mode, THUMBGATE_NO_TELEMETRY: '1', DO_NOT_TRACK: '1' },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const mode of ['mcp-missing', 'mcp-malformed', 'mcp-error', 'mcp-empty', 'mcp-deny', 'cli-empty', 'cli-malformed', 'cli-missing-decision', 'cli-error-context', 'danger-allowed', 'safe-denied', 'learning-failed', 'bad-pattern']) {
  test(`buyer demo rejects ${mode} instead of announcing success`, () => {
    const result = runDemo(mode);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /Close — what to say in the room/);
    assert.match(result.stdout + result.stderr, /Verification: FAIL/);
  });
}

test('buyer demo keeps stdin open until a delayed matching MCP reply arrives', () => {
  const result = runDemo();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /MCP: VERIFIED/);
  assert.match(result.stdout, /Verification: PASS/);
  assert.match(result.stdout, /ALLOW → 3× 👎 → auto-promote → DENY/);
});

for (const flag of ['--fast', '--learn']) {
  test(`buyer demo ${flag} explicitly marks MCP proof skipped`, () => {
    const result = runDemo('mcp-missing', [flag]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /MCP: SKIPPED/);
    assert.doesNotMatch(result.stdout, /MCP: VERIFIED/);
  });
}

test('buyer demo preserves nonblocking hook warnings without hiding them as plain allow', () => {
  const result = runDemo('cli-warning', ['--fast']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /WARN/);
  assert.match(result.stdout, /Verification: PASS/);
});
