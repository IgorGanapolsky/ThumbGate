'use strict';

const fs = require('node:fs');
const path = require('node:path');
let dotenv = null;
try {
  dotenv = require('dotenv');
} catch (_) {
  dotenv = null;
}

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

  const source = fs.readFileSync(resolvedPath, 'utf8');
  const parsed = dotenv ? dotenv.parse(source) : parseEnvFallback(source);
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

function parseEnvFallback(source) {
  const parsed = {};
  for (const rawLine of String(source).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

module.exports = {
  DEFAULT_ENV_PATH,
  loadLocalEnv,
  parseEnvFallback,
  resolveEnvPath,
};
