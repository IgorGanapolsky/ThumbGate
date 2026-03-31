'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const BRIDGE_PATH = path.join(ROOT, 'plugins', 'claude-codex-bridge', 'scripts', 'codex-bridge.js');

function makeStubCodex(tmpDir) {
  const stubPath = path.join(tmpDir, 'codex');
  const content = `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');

const argv = process.argv.slice(2);
if (argv[0] === '--version') {
  process.stdout.write('codex-cli 0.0-test\\n');
  process.exit(0);
}
if (argv[0] === 'exec' && argv[1] === '--help') {
  process.stdout.write('exec help\\n');
  process.exit(0);
}
if (argv[0] === 'exec' && argv[1] === 'review' && argv[2] === '--help') {
  process.stdout.write('review help\\n');
  process.exit(0);
}
const outputIndex = argv.findIndex((token) => token === '--output-last-message');
if (outputIndex !== -1) {
  fs.writeFileSync(argv[outputIndex + 1], 'Stub Codex result for ' + argv.join(' ') + '\\n');
}
process.stdout.write(JSON.stringify({ event: 'completed', argv }) + '\\n');
process.exit(0);
`;
  fs.writeFileSync(stubPath, content, { mode: 0o755 });
  return stubPath;
}

function runBridge(args, env) {
  return execFileSync('node', [BRIDGE_PATH, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
  });
}

test('codex bridge setup reports readiness using the configured Codex binary', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-codex-bridge-'));
  const stubPath = makeStubCodex(tmpDir);
  const dataDir = path.join(tmpDir, 'data');
  const output = runBridge(['setup'], {
    RLHF_CODEX_BIN: stubPath,
    CLAUDE_PLUGIN_DATA: dataDir,
    CLAUDE_PLUGIN_ROOT: path.join(ROOT, 'plugins', 'claude-codex-bridge'),
  });
  const payload = JSON.parse(output);

  assert.equal(payload.ok, true);
  assert.equal(payload.codexInstalled, true);
  assert.equal(payload.reviewCommand, true);
  assert.equal(payload.execCommand, true);
  assert.equal(payload.dataDir, dataDir);
});

test('codex bridge review persists latest metadata and result artifacts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-codex-bridge-'));
  const stubPath = makeStubCodex(tmpDir);
  const dataDir = path.join(tmpDir, 'data');
  const pluginRoot = path.join(ROOT, 'plugins', 'claude-codex-bridge');

  const output = runBridge(['review', '--base', 'main', '--prompt', 'Look for regressions'], {
    RLHF_CODEX_BIN: stubPath,
    CLAUDE_PLUGIN_DATA: dataDir,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
  });

  assert.match(output, /Stub Codex result/);

  const latestPath = path.join(dataDir, 'runs', 'latest.json');
  const latestMessagePath = path.join(dataDir, 'runs', 'latest.md');
  const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));

  assert.equal(latest.ok, true);
  assert.equal(latest.mode, 'review');
  assert.ok(fs.existsSync(latest.eventsPath));
  assert.equal(fs.existsSync(latestMessagePath), true);
  assert.match(fs.readFileSync(latestMessagePath, 'utf8'), /Stub Codex result/);
});

test('codex bridge status and result replay the latest saved run', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-codex-bridge-'));
  const stubPath = makeStubCodex(tmpDir);
  const dataDir = path.join(tmpDir, 'data');
  const pluginRoot = path.join(ROOT, 'plugins', 'claude-codex-bridge');
  const env = {
    RLHF_CODEX_BIN: stubPath,
    CLAUDE_PLUGIN_DATA: dataDir,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
  };

  runBridge(['second-pass', '--prompt', 'Take another look at the diff'], env);

  const status = JSON.parse(runBridge(['status'], env));
  const result = runBridge(['result'], env);

  assert.equal(status.mode, 'second-pass');
  assert.match(result, /Stub Codex result/);
});
