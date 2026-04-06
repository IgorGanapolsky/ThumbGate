'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const DEFAULT_ENV_PATH = path.resolve(__dirname, '..', '..', '.env');

function resolveEnvPath(envPath = DEFAULT_ENV_PATH) {
  return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
}

function loadLocalEnv(options = {}) {
  const resolvedPath = resolveEnvPath(options.envPath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      exists: false,
      loadedKeys: [],
      path: resolvedPath,
    };
  }

  const parsed = dotenv.parse(fs.readFileSync(resolvedPath, 'utf8'));
  const loadedKeys = [];
  const override = options.override === true;

  for (const [key, value] of Object.entries(parsed)) {
    if (!override && process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = value;
    loadedKeys.push(key);
  }

  return {
    exists: true,
    loadedKeys,
    path: resolvedPath,
  };
}

module.exports = {
  DEFAULT_ENV_PATH,
  loadLocalEnv,
  resolveEnvPath,
};
