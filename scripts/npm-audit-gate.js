#!/usr/bin/env node
'use strict';

// CI's "Audit root npm dependencies" step used to run raw `npm audit
// --audit-level=low`, which fails the whole build on ANY advisory at or
// above "low" severity -- including ones with no available fix. That
// blocked every PR (see GHSA-f88m-g3jw-g9cj, sharp/libvips, discovered
// 2026-07-22). This wrapper keeps the gate strict for anything new while
// letting a small, explicitly reviewed, time-boxed set of no-fix-available
// advisories through. Any advisory URL not in .audit-allowlist.json still
// fails the build.

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ALLOWLIST_PATH = path.join(__dirname, '..', '.audit-allowlist.json');

function loadAllowlist(allowlistPath = ALLOWLIST_PATH) {
  if (!fs.existsSync(allowlistPath)) return [];
  return JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
}

function collectAdvisoryUrls(vulnerabilities) {
  const urls = new Set();
  for (const pkg of Object.values(vulnerabilities || {})) {
    for (const via of pkg.via || []) {
      if (via && typeof via === 'object' && via.url) {
        urls.add(via.url);
      }
    }
  }
  return urls;
}

// Pure decision logic, kept separate from the npm audit spawn/IO below so
// it can be unit tested with synthetic report fixtures instead of hitting
// npm's (occasionally flaky/rate-limited) live registry audit endpoint.
function evaluateReport(report, allowlist) {
  const total = report?.metadata?.vulnerabilities?.total ?? 0;
  if (total === 0) {
    return { ok: true, total: 0, foundUrls: [], unapproved: [] };
  }

  const foundUrls = [...collectAdvisoryUrls(report.vulnerabilities)];
  const allowedUrls = new Set(allowlist.map((entry) => entry.url));
  const unapproved = foundUrls.filter((url) => !allowedUrls.has(url));

  return { ok: unapproved.length === 0, total, foundUrls, unapproved };
}

// A fixed table, not string interpolation: the untrusted CLI arg is only
// ever used as a lookup KEY here. The actual flag text that reaches
// spawnSync's argv always comes from one of these hardcoded literals, so
// there is no path for arbitrary input to become part of the OS command.
const AUDIT_LEVEL_FLAGS = Object.freeze({
  info: '--audit-level=info',
  low: '--audit-level=low',
  moderate: '--audit-level=moderate',
  high: '--audit-level=high',
  critical: '--audit-level=critical',
});

function resolveAuditLevel(raw) {
  const level = raw || 'low';
  if (!Object.prototype.hasOwnProperty.call(AUDIT_LEVEL_FLAGS, level)) {
    throw new Error(
      `npm-audit-gate: invalid audit level "${level}". Expected one of: ${Object.keys(AUDIT_LEVEL_FLAGS).join(', ')}`
    );
  }
  return level;
}

function resolveAuditLevelFlag(raw) {
  return AUDIT_LEVEL_FLAGS[resolveAuditLevel(raw)];
}

function resolveNpmInvocation() {
  // Avoid PATH-based resolution of the "npm" binary: prefer the exact npm
  // CLI script npm itself provides via npm_execpath when this runs inside
  // `npm run`/CI (always true for the ci.yml step this backs). Falls back
  // to the bare command name only for an ad-hoc standalone invocation.
  const execPath = process.env.npm_execpath;
  if (execPath && fs.existsSync(execPath)) {
    return { command: process.execPath, prefixArgs: [execPath] };
  }
  return { command: 'npm', prefixArgs: [] };
}

// spawnFn is injectable so tests can exercise this without depending on
// npm's live registry audit endpoint (observed 400s under rapid repeat
// calls while building this gate -- a real flakiness risk for CI).
function runNpmAudit(cwd, auditLevel, spawnFn = spawnSync) {
  const auditLevelFlag = resolveAuditLevelFlag(auditLevel);
  const { command, prefixArgs } = resolveNpmInvocation();
  const result = spawnFn(command, [...prefixArgs, 'audit', auditLevelFlag, '--json'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `npm-audit-gate: could not parse npm audit --json output.\n` +
      `stdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  }
}

// Every collaborator is injectable so this can be fully exercised in tests
// without shelling out to npm or actually terminating the test process.
function main({
  argv = process.argv,
  cwd = process.cwd(),
  exit = process.exit,
  log = console.log,
  error = console.error,
  runAudit = runNpmAudit,
  loadAllowlistFn = loadAllowlist,
} = {}) {
  const auditLevel = argv[2] || 'low';
  const report = runAudit(cwd, auditLevel);
  const allowlist = loadAllowlistFn();
  const { ok, total, foundUrls, unapproved } = evaluateReport(report, allowlist);

  if (total === 0) {
    log('npm-audit-gate: 0 vulnerabilities found.');
    exit(0);
    return;
  }

  if (ok) {
    log(`npm-audit-gate: ${total} finding(s), all explicitly allowlisted:`);
    for (const url of foundUrls) {
      const entry = allowlist.find((e) => e.url === url);
      log(`  - ${url}`);
      log(`    reason: ${entry.reason}`);
      log(`    review by: ${entry.reviewBy}`);
    }
    exit(0);
    return;
  }

  error(`npm-audit-gate: ${unapproved.length} NEW, non-allowlisted advisory URL(s):`);
  for (const url of unapproved) {
    error(`  - ${url}`);
  }
  error('');
  error('Run `npm audit` for details, then either fix the dependency or add a');
  error(`documented, time-boxed entry to ${path.relative(cwd, ALLOWLIST_PATH)}.`);
  exit(1);
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main();
}

module.exports = {
  evaluateReport,
  collectAdvisoryUrls,
  loadAllowlist,
  resolveAuditLevel,
  resolveAuditLevelFlag,
  resolveNpmInvocation,
  runNpmAudit,
  main,
};
