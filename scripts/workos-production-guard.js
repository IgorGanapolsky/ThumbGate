#!/usr/bin/env node
'use strict';

/**
 * workos-production-guard.js — Public, secret-free checks that thumbgate.app
 * auth is on WorkOS Production AuthKit (not staging) and ordinary login has no
 * max_age step-up. Enforces the $10/mo ops policy's "no public staging auth"
 * rule. Does not call WorkOS billing APIs (no secrets).
 *
 * Also asserts which sign-in METHODS actually render on the hosted AuthKit
 * page (EXPECTED_METHODS below). Root cause this closes (2026-07-22): the
 * redirect-chain check alone never noticed when available sign-in methods
 * changed — Igor had to notice by eye that Google SSO silently vanished after
 * a staging->production cutover. Update EXPECTED_METHODS whenever a method is
 * deliberately added/removed (same update-on-purpose contract as the client
 * ID / host constants below).
 *
 * Usage:
 *   node scripts/workos-production-guard.js
 *   node scripts/workos-production-guard.js --json
 *   node scripts/workos-production-guard.js --base https://thumbgate.app
 *   npm run prove:workos
 */

const path = require('path');
const { spawnSync } = require('child_process');

const PROD_CLIENT_ID = 'client_' + '01KY0306CYDV6QSXE43QKM2ZXW';
const STAGING_CLIENT_ID = 'client_' + '01KY0305JKQ2D3AN0DN88A8EYM';
const PROD_AUTHKIT_HOST = 'progressive-mouse-13.authkit.app';

// Sign-in methods that must render on the hosted AuthKit page. Each entry is
// a case-insensitive substring to look for in the page body. Update this list
// the same day a method is deliberately enabled/disabled in the WorkOS
// Dashboard (Authentication -> Providers/Methods) — see
// docs/WORKOS-PRODUCTION-SPEND-CAP.md.
const EXPECTED_METHODS = [
  { name: 'email', marker: 'continue with email' },
  { name: 'google', marker: 'continue with google' },
];

function parseArgs(argv) {
  const args = { json: false, base: 'https://thumbgate.app' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--base') args.base = String(argv[++i] || args.base).replace(/\/$/, '');
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

function curlHeaders(url) {
  const res = spawnSync('curl', ['-sI', url], { encoding: 'utf8', timeout: 20000 });
  if (res.status !== 0) {
    throw new Error(`curl failed for ${url}: ${res.stderr || res.stdout || res.status}`);
  }
  return res.stdout || '';
}

function locationFromHeaders(headers) {
  const m = headers.match(/^location:\s*(\S+)/im);
  return m ? m[1].trim() : null;
}

function curlBody(url) {
  const res = spawnSync('curl', ['-sL', url], { encoding: 'utf8', timeout: 20000 });
  if (res.status !== 0) {
    throw new Error(`curl failed for ${url}: ${res.stderr || res.stdout || res.status}`);
  }
  return res.stdout || '';
}

function checkSignInMethods(finalUrl) {
  const failures = [];
  const warnings = [];
  let body = '';
  try {
    body = curlBody(finalUrl).toLowerCase();
  } catch (error) {
    // A fetch error here is a warning, not a failure — this check must not
    // make unrelated CI runs flaky on a transient network blip. The
    // redirect-chain checks above are the hard gate; this is a second,
    // best-effort layer on top.
    warnings.push(`could not fetch AuthKit page body to verify sign-in methods: ${error.message}`);
    return { failures, warnings, methodsFound: [] };
  }
  const methodsFound = [];
  for (const method of EXPECTED_METHODS) {
    const present = body.includes(method.marker);
    if (present) {
      methodsFound.push(method.name);
    } else {
      failures.push(
        `expected sign-in method "${method.name}" (marker "${method.marker}") not found on ` +
          `the hosted AuthKit page — either it was disabled and EXPECTED_METHODS needs updating, ` +
          `or this is an unintentional regression`,
      );
    }
  }
  return { failures, warnings, methodsFound };
}

function followHosts(startUrl, maxHops = 8) {
  const hosts = [];
  let url = startUrl;
  for (let i = 0; i < maxHops; i += 1) {
    let host;
    try {
      host = new URL(url).host;
    } catch {
      break;
    }
    hosts.push(host);
    const headers = curlHeaders(url);
    const next = locationFromHeaders(headers);
    if (!next) break;
    url = next;
  }
  return { hosts, finalHost: hosts[hosts.length - 1] || null, finalUrl: url };
}

function check(base) {
  const loginUrl = `${base}/api/auth/login`;
  const headers = curlHeaders(loginUrl);
  const location = locationFromHeaders(headers);
  const failures = [];
  const warnings = [];

  if (!location) {
    failures.push('login did not return a Location redirect');
    return { ok: false, failures, warnings, loginUrl };
  }

  let clientId = null;
  let redirectUri = null;
  let hasMaxAge = false;
  try {
    const u = new URL(location);
    clientId = u.searchParams.get('client_id');
    redirectUri = u.searchParams.get('redirect_uri');
    hasMaxAge = u.searchParams.has('max_age');
  } catch {
    failures.push(`invalid login Location: ${location.slice(0, 120)}`);
  }

  if (clientId !== PROD_CLIENT_ID) {
    failures.push(`expected production client_id ${PROD_CLIENT_ID}, got ${clientId || 'null'}`);
  }
  if (clientId === STAGING_CLIENT_ID) {
    failures.push('staging client_id is live on public login (hard fail)');
  }
  if (hasMaxAge) {
    failures.push('login Location includes max_age (ordinary sign-in must not force step-up reauth)');
  }
  if (redirectUri !== `${base}/api/auth/callback`) {
    warnings.push(`redirect_uri is ${redirectUri} (expected ${base}/api/auth/callback)`);
  }

  const chain = followHosts(location);
  const anyStaging = chain.hosts.some((h) => /staging/i.test(h));
  const anyAuthkit = chain.hosts.some((h) => /authkit\.app$/i.test(h));
  const anyError = chain.hosts.some((h) => /error\.workos\.com$/i.test(h));

  if (anyStaging) {
    failures.push(`redirect chain hits staging host(s): ${chain.hosts.filter((h) => /staging/i.test(h)).join(', ')}`);
  }
  if (anyError) {
    failures.push(`redirect chain hits error.workos.com (often missing Production redirect URI)`);
  }
  if (!anyAuthkit) {
    failures.push(`redirect chain never reached authkit.app (hosts: ${chain.hosts.join(' -> ')})`);
  }
  if (chain.finalHost && chain.finalHost !== PROD_AUTHKIT_HOST && anyAuthkit && !anyStaging) {
    warnings.push(
      `AuthKit host is ${chain.finalHost} (documented production host is ${PROD_AUTHKIT_HOST}; update docs if intentional)`,
    );
  }

  let methodsFound = [];
  if (anyAuthkit && !anyStaging) {
    const methodCheck = checkSignInMethods(chain.finalUrl);
    failures.push(...methodCheck.failures);
    warnings.push(...methodCheck.warnings);
    methodsFound = methodCheck.methodsFound;
  }

  return {
    ok: failures.length === 0,
    base,
    loginUrl,
    clientId,
    redirectUri,
    hasMaxAge,
    hosts: chain.hosts,
    finalHost: chain.finalHost,
    expectedMethods: EXPECTED_METHODS.map((m) => m.name),
    methodsFound,
    spendCapUsd: 10,
    policy: 'AuthKit only; no custom domains ($99); no enterprise SSO connections; public site must not use staging',
    failures,
    warnings,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/workos-production-guard.js [--json] [--base https://thumbgate.app]');
    process.exit(0);
  }
  let report;
  try {
    report = check(args.base);
  } catch (error) {
    report = { ok: false, failures: [String(error.message || error)], warnings: [] };
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('=== WorkOS production guard ($10/mo policy) ===');
    console.log(`ok=${report.ok} finalHost=${report.finalHost || '?'}`);
    console.log(`client_id=${report.clientId || '?'} max_age=${report.hasMaxAge}`);
    if (report.hosts) console.log(`chain: ${report.hosts.join(' -> ')}`);
    if (report.expectedMethods) {
      console.log(`sign-in methods: expected=[${report.expectedMethods.join(', ')}] found=[${(report.methodsFound || []).join(', ')}]`);
    }
    console.log(`policy: ${report.policy}`);
    for (const w of report.warnings || []) console.log(`WARN: ${w}`);
    for (const f of report.failures || []) console.log(`FAIL: ${f}`);
  }
  process.exit(report.ok ? 0 : 1);
}

module.exports = { check, PROD_CLIENT_ID, STAGING_CLIENT_ID, PROD_AUTHKIT_HOST, EXPECTED_METHODS };

// Path-based main check (portable under CommonJS strict equality / Sonar S3403).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
