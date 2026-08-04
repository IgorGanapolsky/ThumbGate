#!/usr/bin/env node
'use strict';

/**
 * prove-vlt-dogfood.js — High-ROI smoke for vlt (package manager / registry client).
 *
 * Why: agents thrash `npm install`; vlt is a drop-in client with security query
 * selectors and optional secure mirrors. This proves the local client works
 * without requiring a paid vlt.io account (uses public npm registry).
 *
 * Usage:
 *   node scripts/prove-vlt-dogfood.js
 *   node scripts/prove-vlt-dogfood.js --json
 *
 * Exit:
 *   0 — all probes pass (or skipped with --allow-missing when vlt absent)
 *   1 — probe failure
 *   2 — vlt missing (unless --allow-missing)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const JSON_MODE = process.argv.includes('--json');
const ALLOW_MISSING = process.argv.includes('--allow-missing');
const REGISTRY = process.env.VLT_REGISTRY || 'https://registry.npmjs.org/';

function log(msg) {
  if (!JSON_MODE) process.stderr.write(`${msg}\n`);
}

function findVlt() {
  const candidates = [
    process.env.VLT_BIN,
    'vlt',
    path.join(os.homedir(), '.npm-global', 'bin', 'vlt'),
    path.join(os.homedir(), '.local', 'bin', 'vlt'),
  ].filter(Boolean);

  for (const bin of candidates) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && String(r.stdout || r.stderr || '').trim()) {
      return { bin, version: String(r.stdout || r.stderr).trim().split(/\s+/).pop() };
    }
  }
  return null;
}

function run(bin, args, opts = {}) {
  const r = spawnSync(bin, args, {
    encoding: 'utf8',
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env || {}) },
    timeout: opts.timeout || 120000,
  });
  return {
    status: r.status,
    stdout: String(r.stdout || ''),
    stderr: String(r.stderr || ''),
    error: r.error ? String(r.error.message) : null,
  };
}

function main() {
  const report = {
    ok: false,
    skipped: false,
    version: null,
    probes: [],
  };

  const found = findVlt();
  if (!found) {
    report.skipped = true;
    report.error = 'vlt CLI not found on PATH';
    if (ALLOW_MISSING) {
      report.ok = true;
      report.note = 'Skipped — install via: curl -fsSL https://install.vlt.sh | bash';
      if (JSON_MODE) console.log(JSON.stringify(report, null, 2));
      else log(`SKIP: ${report.error}`);
      return 0;
    }
    if (JSON_MODE) console.log(JSON.stringify(report, null, 2));
    else log(`FAIL: ${report.error}`);
    return 2;
  }

  report.version = found.version;
  log(`vlt ${found.version} @ ${found.bin}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-vlt-dogfood-'));
  try {
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({
        name: 'thumbgate-vlt-dogfood',
        version: '0.0.0',
        private: true,
        dependencies: { ms: '2.1.3' },
      }),
      'utf8',
    );

    // 1) install
    const t0 = Date.now();
    const install = run(found.bin, ['install', `--registry=${REGISTRY}`], { cwd: tmp });
    const installMs = Date.now() - t0;
    const installOk = install.status === 0
      && fs.existsSync(path.join(tmp, 'node_modules', 'ms'));
    report.probes.push({
      id: 'install',
      ok: installOk,
      ms: installMs,
      detail: installOk ? `ms@2.1.3 in ${installMs}ms` : (install.stderr || install.stdout || install.error || 'install failed').slice(0, 300),
    });
    log(installOk ? `PASS install (${installMs}ms)` : `FAIL install: ${report.probes[0].detail}`);

    // 2) query installed package
    const query = run(found.bin, ['query', '#ms', '--view=count'], { cwd: tmp });
    const queryOut = (query.stdout || query.stderr || '').trim();
    // count view may print a number or json number
    const queryOk = query.status === 0 && /[1-9]/.test(queryOut);
    report.probes.push({
      id: 'query-ms',
      ok: queryOk,
      detail: queryOut.slice(0, 120) || query.error || 'empty',
    });
    log(queryOk ? `PASS query #ms → ${queryOut.slice(0, 40)}` : `FAIL query: ${report.probes[1].detail}`);

    // 3) security selector runs (0 vulns expected on ms)
    const vuln = run(found.bin, ['query', ':vuln', '--view=count'], { cwd: tmp });
    const vulnOk = vuln.status === 0;
    report.probes.push({
      id: 'query-vuln-selector',
      ok: vulnOk,
      detail: (vuln.stdout || vuln.stderr || '').trim().slice(0, 80) || (vulnOk ? '0' : 'selector failed'),
    });
    log(vulnOk ? `PASS query :vuln (security selector executable)` : `FAIL :vuln`);

    report.ok = report.probes.every((p) => p.ok);
    report.tmp = tmp;
    if (JSON_MODE) console.log(JSON.stringify(report, null, 2));
    else log(report.ok ? 'SELF-TEST: ALL PASS' : 'SELF-TEST: FAILED');
    return report.ok ? 0 : 1;
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

if (require.main === module || path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exitCode = main();
}

module.exports = { main, findVlt };
