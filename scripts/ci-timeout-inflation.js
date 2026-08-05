#!/usr/bin/env node
'use strict';

/**
 * ci-timeout-inflation.js — Detect checks/tests that burn the clock instead of
 * failing fast (Trunk "timeout-inflation" monitor class).
 *
 * Pure helpers + optional CLI over `gh pr checks` JSON or a local fixture.
 *
 * Usage:
 *   node scripts/ci-timeout-inflation.js --checks-file fixture.json
 *   node scripts/ci-timeout-inflation.js --pr 3230
 *   node scripts/ci-timeout-inflation.js --json < checks.json
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TIMEOUT_NAME_RE = /timeout|timed.?out|deadline|hung|slow.?test/i;
const PASS_ON_RETRY_RE = /pass(?:ed)?\s*on\s*retry|flaky|intermittent/i;

/**
 * @param {Array<object>} checks - gh pr checks JSON-like rows
 * @param {{ minDurationMs?: number }} [options]
 */
function analyzeTimeoutInflation(checks = [], options = {}) {
  const minDurationMs = Number.isFinite(options.minDurationMs) ? options.minDurationMs : 10 * 60 * 1000;
  const suspects = [];

  for (const check of Array.isArray(checks) ? checks : []) {
    const name = String(check.name || check.workflow || 'unknown');
    const conclusion = String(check.conclusion || check.state || '').toUpperCase();
    const bucket = String(check.bucket || '').toLowerCase();
    const link = check.link || check.detailsUrl || null;
    const durationMs = Number(check.durationMs || check.duration_ms || 0);
    const reasons = [];

    if (conclusion === 'TIMED_OUT' || /timed_out/i.test(String(check.state || ''))) {
      reasons.push('check_conclusion_timed_out');
    }
    if (TIMEOUT_NAME_RE.test(name)) {
      reasons.push('name_suggests_timeout');
    }
    if (durationMs >= minDurationMs && (bucket === 'fail' || FAIL_CONCLUSIONS.has(conclusion))) {
      reasons.push(`long_failing_duration_ms:${durationMs}`);
    }
    if (PASS_ON_RETRY_RE.test(String(check.annotation || check.description || ''))) {
      reasons.push('pass_on_retry_signal');
    }

    if (reasons.length > 0) {
      suspects.push({ name, conclusion: conclusion || null, bucket: bucket || null, link, reasons });
    }
  }

  return {
    ok: suspects.length === 0,
    suspectCount: suspects.length,
    suspects,
    policy: 'Prefer fail-fast assertions over burning full job timeouts (Trunk timeout-inflation class).',
  };
}

const FAIL_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED']);

/**
 * Tunable pass-on-retry gate (Trunk flaky-tests analog).
 * Flag only when failureCount >= minRetries before a later pass.
 */
function shouldFlagPassOnRetry({ failureCount = 0, laterPassed = false, minRetries = 2 } = {}) {
  const min = Math.max(1, Number(minRetries) || 2);
  return Boolean(laterPassed) && Number(failureCount) >= min;
}

function loadChecksFromFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : (parsed.checks || []);
}

function loadChecksFromPr(prNumber) {
  const n = String(prNumber || '').trim();
  if (!/^[1-9]\d*$/.test(n)) throw new Error(`Unsafe PR number: ${prNumber}`);
  const res = spawnSync('gh', ['pr', 'checks', n, '--json', 'bucket,name,state,workflow,link'], {
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error((res.stderr || res.stdout || 'gh pr checks failed').trim());
  }
  return JSON.parse(res.stdout || '[]');
}

function parseArgs(argv) {
  const args = { json: false, pr: null, checksFile: null, minDurationMs: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--pr') args.pr = argv[++i];
    else if (a === '--checks-file') args.checksFile = argv[++i];
    else if (a === '--min-duration-ms') args.minDurationMs = Number(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node scripts/ci-timeout-inflation.js [--pr N | --checks-file path] [--json]');
    process.exit(0);
  }

  let checks = [];
  if (args.checksFile) checks = loadChecksFromFile(args.checksFile);
  else if (args.pr) checks = loadChecksFromPr(args.pr);
  else if (!process.stdin.isTTY) {
    checks = JSON.parse(fs.readFileSync(0, 'utf8') || '[]');
  } else {
    console.error('Provide --pr, --checks-file, or JSON on stdin.');
    process.exit(2);
  }

  const report = analyzeTimeoutInflation(checks, {
    minDurationMs: Number.isFinite(args.minDurationMs) ? args.minDurationMs : undefined,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`timeout-inflation suspects=${report.suspectCount} ok=${report.ok}`);
    for (const s of report.suspects) {
      console.log(`- ${s.name} [${s.conclusion || s.bucket || '?'}] ${s.reasons.join(', ')}`);
    }
  }
  process.exit(report.ok ? 0 : 1);
}

module.exports = {
  analyzeTimeoutInflation,
  shouldFlagPassOnRetry,
  loadChecksFromFile,
  parseArgs,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
