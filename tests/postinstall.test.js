'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const path = require('path');

const POSTINSTALL = path.join(__dirname, '..', 'bin', 'postinstall.js');

describe('postinstall banner', () => {
  it('prints banner with checkout URL to stderr', () => {
    const result = execSync(`node ${POSTINSTALL}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    // stdout should be empty (no MCP contamination)
    assert.equal(result, '', 'stdout should be empty');
  });

  it('includes checkout URL in stderr output', () => {
    try {
      execSync(`node ${POSTINSTALL} 2>&1`, { encoding: 'utf8' });
    } catch (_) { /* ignore */ }
    // Run again capturing stderr
    const stderr = execSync(`node ${POSTINSTALL} 2>&1 1>/dev/null`, { encoding: 'utf8', shell: true });
    assert.ok(stderr.includes('checkout/pro'), 'should include checkout URL');
    assert.ok(stderr.includes('ThumbGate'), 'should mention ThumbGate');
    assert.ok(stderr.includes('npx mcp-memory-gateway'), 'should include quick start');
  });

  it('exits silently in CI', () => {
    const result = execSync(`CI=true node ${POSTINSTALL} 2>&1`, { encoding: 'utf8', shell: true });
    assert.equal(result.trim(), '', 'should produce no output in CI');
  });

  it('exits silently with RLHF_NO_NUDGE=1', () => {
    const result = execSync(`RLHF_NO_NUDGE=1 node ${POSTINSTALL} 2>&1`, { encoding: 'utf8', shell: true });
    assert.equal(result.trim(), '', 'should produce no output when nudge disabled');
  });
});
