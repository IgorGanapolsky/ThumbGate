'use strict';

const fs = require('node:fs');
const os = require('node:os');
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

function resolveEnvPaths(envPath = DEFAULT_ENV_PATH) {
  const primaryPath = resolveEnvPath(envPath);
  const repoRoot = path.dirname(primaryPath);
  const candidates = [
    primaryPath,
    path.join(repoRoot, '.env.local'),
    path.join(repoRoot, '.thumbgate', '.env'),
    path.join(os.homedir(), '.thumbgate', '.env'),
    path.join(os.homedir(), '.thumbgate', 'bluesky-monitor.env'),
    path.join(os.homedir(), '.thumbgate', 'reddit-monitor.env'),
  ];

  return Array.from(new Set(candidates.map((candidate) => path.resolve(candidate))));
}

function loadLocalEnv(options = {}) {
  const resolvedPaths = resolveEnvPaths(options.envPath);
  const loadedKeys = [];
  const override = options.override === true;
  const loadedPaths = [];

  for (const resolvedPath of resolvedPaths) {
    if (!fs.existsSync(resolvedPath)) {
      continue;
    }
    const source = fs.readFileSync(resolvedPath, 'utf8');
    const parsed = dotenv ? dotenv.parse(source) : parseEnvFallback(source);

    for (const [key, value] of Object.entries(parsed)) {
      if (!override && process.env[key] !== undefined) {
        continue;
      }
      process.env[key] = value;
      loadedKeys.push(key);
    }
    loadedPaths.push(resolvedPath);
  }

  return {
    exists: loadedPaths.length > 0,
    loadedKeys,
    path: resolvedPaths[0],
    paths: loadedPaths,
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
  resolveEnvPaths,
};
