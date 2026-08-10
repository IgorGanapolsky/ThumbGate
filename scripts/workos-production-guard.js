#!/usr/bin/env node
'use strict';

/**
 * workos-production-guard.js — Public, secret-free checks that thumbgate.app
 * auth is on WorkOS Production AuthKit (not staging) and ordinary login has no
 * max_age step-up. Enforces the $10/mo ops policy's "no public staging auth"
 * rule. Does not call WorkOS billing APIs (no secrets).
 *
 * Uses Node built-in fetch (no shell PATH curl) so Sonar reliability stays clean
 * and unit tests can inject a fetch implementation.
 *
 * Usage:
 *   node scripts/workos-production-guard.js
 *   node scripts/workos-production-guard.js --json
 *   node scripts/workos-production-guard.js --base https://thumbgate.app
 *   npm run prove:workos
 */

const path = require('path');

const PROD_CLIENT_ID = 'client_' + '01KY0306CYDV6QSXE43QKM2ZXW';
const STAGING_CLIENT_ID = 'client_' + '01KY0305JKQ2D3AN0DN88A8EYM';
const PROD_AUTHKIT_HOST = 'progressive-mouse-13.authkit.app';

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

function defaultFetchImpl(url, options = {}) {
  return fetch(url, {
    method: options.method || 'GET',
    redirect: options.redirect || 'manual',
    headers: options.headers,
    signal: options.signal,
  });
}

async function fetchHeaders(url, fetchImpl, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: controller.signal });
    const location = res.headers.get('location') || res.headers.get('Location') || null;
    return { status: res.status, location, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBody(url, fetchImpl, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function checkSignInMethods(finalUrl, fetchImpl) {
  const failures = [];
  const warnings = [];
  let body = '';
  try {
    body = (await fetchBody(finalUrl, fetchImpl)).toLowerCase();
  } catch (error) {
    warnings.push(`could not fetch AuthKit page body to verify sign-in methods: ${error.message}`);
    return { failures, warnings, methodsFound: [] };
  }
  const methodsFound = [];
  for (const method of EXPECTED_METHODS) {
    if (body.includes(method.marker)) {
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

async function followHosts(startUrl, fetchImpl, maxHops = 8) {
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
    let location = null;
    try {
      const headers = await fetchHeaders(url, fetchImpl);
      location = headers.location;
    } catch {
      break;
    }
    if (!location) break;
    try {
      url = new URL(location, url).toString();
    } catch {
      url = location;
    }
  }
  return { hosts, finalHost: hosts[hosts.length - 1] || null, finalUrl: url };
}

async function check(base, options = {}) {
  const fetchImpl = options.fetchImpl || defaultFetchImpl;
  const loginUrl = `${base}/api/auth/login`;
  const failures = [];
  const warnings = [];

  let location = null;
  try {
    const headers = await fetchHeaders(loginUrl, fetchImpl);
    location = headers.location;
  } catch (error) {
    failures.push(`login request failed: ${error.message || error}`);
    return { ok: false, failures, warnings, loginUrl };
  }

  if (!location) {
    failures.push('login did not return a Location redirect');
    return { ok: false, failures, warnings, loginUrl };
  }

  let clientId = null;
  let redirectUri = null;
  let hasMaxAge = false;
  try {
    const u = new URL(location, loginUrl);
    clientId = u.searchParams.get('client_id');
    redirectUri = u.searchParams.get('redirect_uri');
    hasMaxAge = u.searchParams.has('max_age');
    location = u.toString();
  } catch {
    failures.push(`invalid login Location: ${String(location).slice(0, 120)}`);
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

  const chain = await followHosts(location, fetchImpl);
  const anyStaging = chain.hosts.some((h) => /staging/i.test(h));
  const anyAuthkit = chain.hosts.some((h) => /authkit\.app$/i.test(h));
  const anyError = chain.hosts.some((h) => /error\.workos\.com$/i.test(h));

  if (anyStaging) {
    failures.push(`redirect chain hits staging host(s): ${chain.hosts.filter((h) => /staging/i.test(h)).join(', ')}`);
  }
  if (anyError) {
    failures.push('redirect chain hits error.workos.com (often missing Production redirect URI)');
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
    const methodCheck = await checkSignInMethods(chain.finalUrl, fetchImpl);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/workos-production-guard.js [--json] [--base https://thumbgate.app]');
    process.exit(0);
  }
  let report;
  try {
    report = await check(args.base);
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

module.exports = {
  check,
  parseArgs,
  PROD_CLIENT_ID,
  STAGING_CLIENT_ID,
  PROD_AUTHKIT_HOST,
  EXPECTED_METHODS,
  defaultFetchImpl,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
