'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-qs-'));
}

function runQuickStart(cwd, extraArgs = []) {
  const homeDir = path.join(cwd, '.home');
  fs.mkdirSync(homeDir, { recursive: true });
  return execFileSync(process.execPath, [CLI_PATH, 'quick-start', ...extraArgs], {
    cwd,
    env: {
      ...process.env,
      THUMBGATE_NO_NUDGE: '1',
      THUMBGATE_NO_TELEMETRY: '1',
      THUMBGATE_FEEDBACK_DIR: path.join(cwd, '.thumbgate'),
      PATH: process.env.PATH,
      HOME: homeDir,
      USERPROFILE: homeDir,
      XDG_CONFIG_HOME: path.join(homeDir, '.config'),
    },
    timeout: 15000,
    encoding: 'utf8',
  });
}

test('quick-start creates .thumbgate/config.json with correct defaults', () => {
  const tmp = makeTmpDir();
  try {
    runQuickStart(tmp);
    const configPath = path.join(tmp, '.thumbgate', 'config.json');
    assert.ok(fs.existsSync(configPath), 'config.json should exist');

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.strictEqual(config.selfDistillation, true, 'selfDistillation should be enabled');
    assert.strictEqual(config.contextStuffing, true, 'contextStuffing should be enabled');
    assert.strictEqual(config.maxTokenBudget, 10000, 'maxTokenBudget should be 10000');
    assert.strictEqual(config.autoGatePromotion, true, 'autoGatePromotion should be enabled');
    assert.ok(config.agent, 'agent should be set');
    assert.ok(config.installId, 'installId should be set');
    assert.ok(config.version, 'version should be set');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('quick-start copies default gates to .thumbgate/gates.json', () => {
  const tmp = makeTmpDir();
  try {
    runQuickStart(tmp);
    const gatesPath = path.join(tmp, '.thumbgate', 'gates.json');
    assert.ok(fs.existsSync(gatesPath), 'gates.json should exist');

    const gates = JSON.parse(fs.readFileSync(gatesPath, 'utf8'));
    assert.ok(gates.gates, 'gates.json should have a gates array');
    assert.ok(gates.gates.length > 0, 'gates array should not be empty');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('quick-start auto-detects claude-code when .claude/ exists', () => {
  const tmp = makeTmpDir();
  try {
    // Create .claude/ directory to trigger detection
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });

    runQuickStart(tmp);
    const config = JSON.parse(fs.readFileSync(path.join(tmp, '.thumbgate', 'config.json'), 'utf8'));
    assert.strictEqual(config.agent, 'claude-code', 'should detect claude-code');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('quick-start auto-detects cursor when .cursorrules exists', () => {
  const tmp = makeTmpDir();
  try {
    // Create .cursorrules file to trigger detection
    fs.writeFileSync(path.join(tmp, '.cursorrules'), '');

    runQuickStart(tmp);
    const config = JSON.parse(fs.readFileSync(path.join(tmp, '.thumbgate', 'config.json'), 'utf8'));
    assert.strictEqual(config.agent, 'cursor', 'should detect cursor');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('quick-start respects --agent flag over auto-detection', () => {
  const tmp = makeTmpDir();
  try {
    // Create .claude/ but pass --agent=gemini explicitly
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });

    runQuickStart(tmp, ['--agent=gemini']);
    const config = JSON.parse(fs.readFileSync(path.join(tmp, '.thumbgate', 'config.json'), 'utf8'));
    assert.strictEqual(config.agent, 'gemini', 'should use the explicit --agent flag');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('quick-start defaults to claude-code when no agent detected', () => {
  const tmp = makeTmpDir();
  try {
    // Empty directory, no agent markers
    runQuickStart(tmp);
    const config = JSON.parse(fs.readFileSync(path.join(tmp, '.thumbgate', 'config.json'), 'utf8'));
    assert.strictEqual(config.agent, 'claude-code', 'should default to claude-code');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
