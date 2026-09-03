'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const AGENT_LOOP = path.join(ROOT, 'bin/agent-loop');

describe('bin/agent-loop health contract (#3670)', () => {
  it('is an executable file', () => {
    assert.ok(fs.existsSync(AGENT_LOOP), 'bin/agent-loop must exist');
    const mode = fs.statSync(AGENT_LOOP).mode;
    assert.ok((mode & 0o111) !== 0, 'bin/agent-loop must be executable');
  });

  it('--health --json returns valid HEALTHY JSON and exits 0', () => {
    const result = spawnSync(process.execPath, [AGENT_LOOP, '--health', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'HEALTHY');
    assert.equal(payload.ok, true);
    assert.ok(Array.isArray(payload.checks));
    assert.ok(payload.checks.some((c) => c.id === 'package.json' && c.ok));
    assert.ok(payload.checks.some((c) => c.id === 'scripts/session-lease.js' && c.ok));
  });

  it('fail-closed: injected required failure exits nonzero', () => {
    const result = spawnSync(process.execPath, [AGENT_LOOP, '--health', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        THUMBGATE_AGENT_LOOP_INJECT_FAILURE: 'injected-required-check',
      },
    });
    assert.notEqual(result.status, 0, 'injected failure must fail closed');
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.status, 'UNHEALTHY');
    assert.ok(payload.requiredFailed.includes('injected-required-check'));
  });

  it('full --json loop exposes recollect/plan/act/evaluate/learn', () => {
    const result = spawnSync(process.execPath, [AGENT_LOOP, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.loop, ['recollect', 'plan', 'observe', 'act', 'evaluate', 'learn']);
    assert.equal(payload.evaluate.pass, true);
  });
});
