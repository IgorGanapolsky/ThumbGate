#!/usr/bin/env node
'use strict';

const path = require('path');
const { isProLicensed } = require('./license');

function getStatuslineMeta(options = {}) {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  const env = options.env || process.env;
  const homeDir = options.homeDir || env.HOME || env.USERPROFILE || '.';
  
  // Enterprise detection based on key prefix
  const apiKey = env.THUMBGATE_API_KEY || env.THUMBGATE_OPERATOR_KEY || '';
  let activeTier = 'Free';
  
  if (apiKey.startsWith('tg_op_') || apiKey.startsWith('tg_creator_')) {
    activeTier = 'Enterprise';
  } else if (isProLicensed({ homeDir }) || apiKey.startsWith('tg_pro_')) {
    activeTier = 'Pro';
  }

  return {
    version: String(pkg.version || '').trim() || 'unknown',
    tier: activeTier,
  };
}

if (require.main === module) {
  process.stdout.write(JSON.stringify(getStatuslineMeta()));
}

module.exports = { getStatuslineMeta };
