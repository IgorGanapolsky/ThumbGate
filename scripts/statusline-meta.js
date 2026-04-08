#!/usr/bin/env node
'use strict';

const path = require('path');
const { isProLicensed } = require('./license');

function getStatuslineMeta(options = {}) {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  const env = options.env || process.env;
  const homeDir = options.homeDir || env.HOME || env.USERPROFILE || '.';

  return {
    version: String(pkg.version || '').trim() || 'unknown',
    tier: isProLicensed({ homeDir }) ? 'Pro' : 'Free',
  };
}

if (require.main === module) {
  process.stdout.write(JSON.stringify(getStatuslineMeta()));
}

module.exports = { getStatuslineMeta };
