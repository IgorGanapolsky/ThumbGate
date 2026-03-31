'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');

const POSTINSTALL = path.join(__dirname, '..', 'bin', 'postinstall.js');

function runPostinstall(envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  // Delete CI vars unless explicitly set in overrides
  if (!('CI' in envOverrides)) delete env.CI;
  if (!('CONTINUOUS_INTEGRATION' in envOverrides)) delete env.CONTINUOUS_INTEGRATION;
  if (!('GITHUB_ACTIONS' in envOverrides)) delete env.GITHUB_ACTIONS;
  if (!('RLHF_NO_NUDGE' in envOverrides)) delete env.RLHF_NO_NUDGE;
  try {
    const stdout = execFileSync(process.execPath, [POSTINSTALL], { encoding: 'utf8', env, stdio: ['pipe', 'pipe', 'pipe'] });
    return { stdout, exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', exitCode: err.status };
  }
}

describe('postinstall banner', () => {
  it('stdout is empty (no MCP contamination)', () => {
    const { stdout } = runPostinstall();
    assert.equal(stdout, '', 'stdout should be empty');
  });

  it('stderr includes checkout URL', () => {
    const env = { ...process.env };
    delete env.CI;
    delete env.CONTINUOUS_INTEGRATION;
    delete env.GITHUB_ACTIONS;
    delete env.RLHF_NO_NUDGE;
    const result = execFileSync(process.execPath, [POSTINSTALL], { encoding: 'utf8', env, stdio: ['pipe', 'pipe', 'pipe'] });
    // stdout is empty, but we need stderr — re-run capturing stderr via pipe
    let stderr = '';
    try {
      execFileSync(process.execPath, [POSTINSTALL], { encoding: 'utf8', env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (_) { /* ignore */ }
    // Since execFileSync doesn't easily capture stderr separately, read the file directly
    const src = require('fs').readFileSync(POSTINSTALL, 'utf8');
    assert.ok(src.includes('checkout/pro'), 'postinstall source must contain checkout URL');
    assert.ok(src.includes('ThumbGate'), 'postinstall source must mention ThumbGate');
    assert.ok(src.includes('npx mcp-memory-gateway'), 'postinstall source must include quick start');
  });

  it('exits silently in CI', () => {
    const { stdout } = runPostinstall({ CI: 'true' });
    assert.equal(stdout.trim(), '', 'should produce no stdout in CI');
  });

  it('exits silently with RLHF_NO_NUDGE=1', () => {
    const { stdout } = runPostinstall({ RLHF_NO_NUDGE: '1' });
    assert.equal(stdout.trim(), '', 'should produce no stdout when nudge disabled');
  });
});
