#!/usr/bin/env node
'use strict';

/**
 * billing-setup.js — Wire up hosted billing for the CFO dashboard
 *
 * Generates a THUMBGATE_OPERATOR_KEY and stores it locally so that
 * `node bin/cli.js cfo --today` pulls live revenue from the production server.
 *
 * Usage:
 *   node scripts/billing-setup.js
 *
 * After running, set the printed key on Railway:
 *   railway variables set THUMBGATE_OPERATOR_KEY=<key>
 * Then redeploy (or let Railway auto-deploy).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const LOCAL_CONFIG_PATH = path.join(os.homedir(), '.config', 'thumbgate', 'operator.json');
const PROD_URL = 'https://thumbgate.ai';

function generateOperatorKey() {
  return `tg_op_${crypto.randomBytes(20).toString('hex')}`;
}

function loadExistingConfig() {
  try {
    const raw = fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveConfig(config) {
  const dir = path.dirname(LOCAL_CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

async function verifyEndpoint(baseUrl, key) {
  try {
    const url = new URL('/v1/billing/summary?window=today', baseUrl);
    const res = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    });
    return { status: res.status, ok: res.ok };
  } catch (err) {
    return { status: null, ok: false, error: err.message };
  }
}

async function main() {
  const existing = loadExistingConfig();

  if (existing && existing.operatorKey && existing.baseUrl) {
    console.log('\n✓ Operator config already exists at', LOCAL_CONFIG_PATH);
    console.log('  Base URL    :', existing.baseUrl);
    console.log('  Operator key:', existing.operatorKey);
    console.log('\nTo regenerate, delete the file and re-run this script.');

    // Set env for this process so the verify check works
    process.env.THUMBGATE_OPERATOR_KEY = existing.operatorKey;
    process.env.THUMBGATE_BILLING_API_BASE_URL = existing.baseUrl;

    const check = await verifyEndpoint(existing.baseUrl, existing.operatorKey);
    if (check.ok) {
      console.log('\n✓ Production endpoint responds OK — hosted billing is active.');
    } else if (check.status === 403) {
      console.log('\n⚠ Production endpoint returned 403 — the operator key is not yet set on Railway.');
      console.log('\nSet it now:\n');
      console.log(`  railway variables set THUMBGATE_OPERATOR_KEY=${existing.operatorKey}`);
      console.log('\nThen redeploy (Railway will pick it up automatically).');
    } else {
      console.log(`\n⚠ Endpoint check returned status ${check.status || 'error'}: ${check.error || ''}`);
    }
    return;
  }

  const key = generateOperatorKey();
  const config = {
    operatorKey: key,
    baseUrl: process.env.THUMBGATE_BILLING_API_BASE_URL || PROD_URL,
    createdAt: new Date().toISOString(),
  };

  saveConfig(config);

  console.log('\n✓ Operator key generated and saved to', LOCAL_CONFIG_PATH);
  console.log('\n──────────────────────────────────────────────────────');
  console.log('  THUMBGATE_OPERATOR_KEY =', key);
  console.log('──────────────────────────────────────────────────────');
  console.log('\nSet this key on Railway (one-time):');
  console.log('\n  railway variables set THUMBGATE_OPERATOR_KEY=' + key);
  console.log('\nOr paste it into the Railway dashboard under Variables.');
  console.log('\nAfter Railway redeploys, run:\n');
  console.log('  node bin/cli.js cfo --today\n');
  console.log('The CFO dashboard will use live production billing data.');
}

main().catch((err) => {
  console.error('billing-setup error:', err.message);
  process.exit(1);
});
