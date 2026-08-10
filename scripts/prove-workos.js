#!/usr/bin/env node
'use strict';

/**
 * prove-workos.js — evidence that WorkOS production auth + MCP OAuth hierarchy
 * still satisfy ThumbGate's enterprise readiness contract ($10/mo AuthKit cap,
 * production client, scope implication for MCP tools).
 *
 * Usage: node scripts/prove-workos.js [--skip-live]
 */

const path = require('path');
const { spawnSync } = require('child_process');

const skipLive = process.argv.includes('--skip-live');
const root = path.resolve(__dirname, '..');

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    cwd: root,
    timeout: opts.timeout || 120000,
    env: process.env,
  });
  return res;
}

function main() {
  const failures = [];
  // Unit tests: OAuth hierarchy + guard constants
  const unit = run(process.execPath, [
    '--test',
    'tests/mcp-oauth.test.js',
    'tests/workos-production-guard.test.js',
  ]);
  if (unit.status !== 0) {
    failures.push(`unit tests failed:\n${unit.stdout || ''}\n${unit.stderr || ''}`);
  }

  if (!skipLive) {
    const live = run(process.execPath, ['scripts/workos-production-guard.js', '--json'], { timeout: 60000 });
    let report = null;
    try {
      report = JSON.parse(live.stdout || '{}');
    } catch {
      failures.push(`live guard did not emit JSON: ${live.stdout || live.stderr}`);
    }
    if (report && report.ok !== true) {
      failures.push(`live WorkOS guard failed: ${JSON.stringify(report.failures || report)}`);
    }
    if (report && report.ok) {
      console.log(
        `LIVE ok client=${report.clientId} host=${report.finalHost} methods=${(report.methodsFound || []).join(',')}`,
      );
    }
  } else {
    console.log('LIVE skipped (--skip-live)');
  }

  if (failures.length) {
    console.error('prove:workos FAILED');
    for (const f of failures) console.error(f);
    process.exit(1);
  }
  console.log('prove:workos OK');
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

module.exports = { main };
