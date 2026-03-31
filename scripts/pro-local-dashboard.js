'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_PRO_API = 'https://rlhf-feedback-loop-production.up.railway.app';

function getLicenseDir(homeDir = os.homedir()) {
  return path.join(homeDir, '.thumbgate');
}

function getLicensePath(homeDir = os.homedir()) {
  return path.join(getLicenseDir(homeDir), 'license.json');
}

function readLicense({ homeDir } = {}) {
  try {
    return JSON.parse(fs.readFileSync(getLicensePath(homeDir), 'utf8'));
  } catch {
    return null;
  }
}

function saveLicense(key, { homeDir, version } = {}) {
  const licenseDir = getLicenseDir(homeDir);
  const licensePath = getLicensePath(homeDir);
  fs.mkdirSync(licenseDir, { recursive: true });
  fs.writeFileSync(
    licensePath,
    JSON.stringify({
      key: String(key || '').trim(),
      savedAt: new Date().toISOString(),
      version: version || null,
    }, null, 2) + '\n'
  );
  return licensePath;
}

function resolveProKey({ env = process.env, homeDir } = {}) {
  const envKey = String(env.RLHF_API_KEY || '').trim();
  if (envKey) {
    return {
      key: envKey,
      source: 'env',
    };
  }

  const license = readLicense({ homeDir });
  const licenseKey = String(license && license.key ? license.key : '').trim();
  if (licenseKey) {
    return {
      key: licenseKey,
      source: 'license',
      licensePath: getLicensePath(homeDir),
    };
  }

  return null;
}

async function validateProKey(key, { apiBaseUrl = DEFAULT_PRO_API, fetchImpl = globalThis.fetch } = {}) {
  if (!key || typeof fetchImpl !== 'function') {
    return false;
  }

  try {
    const res = await fetchImpl(`${apiBaseUrl}/v1/billing/usage`, {
      headers: {
        'Authorization': `Bearer ${String(key).trim()}`,
      },
    });
    if (!res.ok) {
      return false;
    }
    const data = await res.json().catch(() => ({}));
    return Boolean(data && data.key);
  } catch {
    return false;
  }
}

async function startLocalProDashboard({
  key,
  env = process.env,
  port,
  startServerImpl,
} = {}) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    throw new Error('Pro license key required.');
  }

  env.RLHF_PRO_MODE = '1';
  env.RLHF_API_KEY = normalizedKey;

  const desiredPort = Number(port ?? env.PORT ?? 3456);
  env.PORT = String(desiredPort);

  const startServer = startServerImpl || require(path.join(__dirname, '..', 'src', 'api', 'server')).startServer;
  const handle = await startServer({ port: desiredPort });
  return {
    server: handle.server,
    port: handle.port,
    url: `http://localhost:${handle.port}/dashboard`,
  };
}

module.exports = {
  DEFAULT_PRO_API,
  getLicenseDir,
  getLicensePath,
  readLicense,
  saveLicense,
  resolveProKey,
  validateProKey,
  startLocalProDashboard,
};
