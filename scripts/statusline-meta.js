#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verifyLicense, isProLicensed, isValidKey } = require('./license');

function readDiskOperatorKey(homeDir) {
  try {
    const configPath = path.join(homeDir, '.config', 'thumbgate', 'operator.json');
    if (!fs.existsSync(configPath)) return '';
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config.operatorKey || config.apiKey || '';
  } catch {
    // Ignore missing or unreadable operator.json on personal machines
    return '';
  }
}

function resolveActiveTier(licenseResult, apiKey, options, env, homeDir) {
  if ((licenseResult.valid && licenseResult.tier === 'enterprise') || apiKey.startsWith('tg_ent_')) {
    return 'Enterprise';
  }
  if (licenseResult.valid && licenseResult.tier === 'team') {
    return 'Team';
  }
  if (isProLicensed({ ...options, env, homeDir }) || apiKey.startsWith('tg_pro_')) {
    return 'Pro';
  }
  return 'Free';
}

function getStatuslineMeta(options = {}) {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  const env = options.env || process.env;
  const homeDir = options.homeDir || env.HOME || env.USERPROFILE || '.';

  let apiKey = env.THUMBGATE_OPERATOR_KEY || env.THUMBGATE_API_KEY || '';
  if (apiKey && !isValidKey(apiKey, { env, homeDir })) {
    apiKey = '';
  }
  if (!apiKey) {
    apiKey = readDiskOperatorKey(homeDir);
  }

  const licenseResult = verifyLicense({ ...options, env, homeDir });
  const activeTier = resolveActiveTier(licenseResult, apiKey, options, env, homeDir);

  return {
    version: String(pkg.version || '').trim() || 'unknown',
    tier: activeTier,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.stdout.write(JSON.stringify(getStatuslineMeta()));
}

module.exports = { getStatuslineMeta };
