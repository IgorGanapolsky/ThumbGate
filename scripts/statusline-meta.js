#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { isProLicensed, isValidKey } = require('./license');

function getStatuslineMeta(options = {}) {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  const env = options.env || process.env;
  const homeDir = options.homeDir || env.HOME || env.USERPROFILE || '.';
  const fs = require('node:fs');
  
  // Enterprise detection based on key prefix
  let apiKey = env.THUMBGATE_OPERATOR_KEY || env.THUMBGATE_API_KEY || '';
  if (apiKey && !isValidKey(apiKey, { env })) {
    apiKey = '';
  }
  
  // Fallback to reading from disk if not in env
  if (!apiKey) {
    try {
      const configPath = path.join(homeDir, '.config', 'thumbgate', 'operator.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        apiKey = config.operatorKey || config.apiKey || '';
      }
    } catch (_) { /* ignore disk read errors */ }
  }

  let activeTier = 'Free';
  
  if (apiKey.startsWith('tg_op_') || apiKey.startsWith('tg_creator_')) {
    activeTier = 'TG Enterprise';
  } else if (isProLicensed({ homeDir, env }) || apiKey.startsWith('tg_pro_')) {
    activeTier = 'Pro';
  }

  return {
    version: String(pkg.version || '').trim() || 'unknown',
    tier: activeTier,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.stdout.write(JSON.stringify(getStatuslineMeta()));
}

module.exports = { getStatuslineMeta };
