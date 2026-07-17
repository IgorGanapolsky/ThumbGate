#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_SECRET_PATHS = Object.freeze([
  path.join(os.homedir(), '.thumbgate_secrets', 'stripe_live_key.txt'),
  path.join(os.homedir(), '.resume_secrets', 'stripe_live_key.txt'),
]);

function readSecretFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function resolveStripeSecretKey({ env = process.env, secretPaths = DEFAULT_SECRET_PATHS } = {}) {
  if (String(env.STRIPE_SECRET_KEY || '').trim()) {
    return { secretKey: env.STRIPE_SECRET_KEY.trim(), source: 'env' };
  }
  for (const filePath of secretPaths) {
    const secretKey = readSecretFile(filePath);
    if (secretKey) return { secretKey, source: 'managed_file' };
  }
  return { secretKey: null, source: null };
}

module.exports = {
  DEFAULT_SECRET_PATHS,
  readSecretFile,
  resolveStripeSecretKey,
};
