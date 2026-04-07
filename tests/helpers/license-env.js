'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadWithIsolatedLicenseEnv(subjectModuleId, extraModuleIds = []) {
  const savedEnv = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    THUMBGATE_API_KEY: process.env.THUMBGATE_API_KEY,
    THUMBGATE_PRO_KEY: process.env.THUMBGATE_PRO_KEY,
    THUMBGATE_PRO_MODE: process.env.THUMBGATE_PRO_MODE,
    THUMBGATE_NO_RATE_LIMIT: process.env.THUMBGATE_NO_RATE_LIMIT,
  };
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-license-test-'));
  const moduleIds = [...new Set([subjectModuleId, ...extraModuleIds])];
  let restored = false;

  function restore() {
    if (restored) return;
    restored = true;
    for (const moduleId of moduleIds) {
      delete require.cache[moduleId];
    }
    if (savedEnv.HOME !== undefined) process.env.HOME = savedEnv.HOME;
    else delete process.env.HOME;
    if (savedEnv.USERPROFILE !== undefined) process.env.USERPROFILE = savedEnv.USERPROFILE;
    else delete process.env.USERPROFILE;
    if (savedEnv.THUMBGATE_API_KEY !== undefined) process.env.THUMBGATE_API_KEY = savedEnv.THUMBGATE_API_KEY;
    else delete process.env.THUMBGATE_API_KEY;
    if (savedEnv.THUMBGATE_PRO_KEY !== undefined) process.env.THUMBGATE_PRO_KEY = savedEnv.THUMBGATE_PRO_KEY;
    else delete process.env.THUMBGATE_PRO_KEY;
    if (savedEnv.THUMBGATE_PRO_MODE !== undefined) process.env.THUMBGATE_PRO_MODE = savedEnv.THUMBGATE_PRO_MODE;
    else delete process.env.THUMBGATE_PRO_MODE;
    if (savedEnv.THUMBGATE_NO_RATE_LIMIT !== undefined) process.env.THUMBGATE_NO_RATE_LIMIT = savedEnv.THUMBGATE_NO_RATE_LIMIT;
    else delete process.env.THUMBGATE_NO_RATE_LIMIT;
    fs.rmSync(homeDir, { recursive: true, force: true });
  }

  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_PRO_KEY;
  delete process.env.THUMBGATE_PRO_MODE;
  delete process.env.THUMBGATE_NO_RATE_LIMIT;

  for (const moduleId of moduleIds) {
    delete require.cache[moduleId];
  }

  try {
    return {
      moduleExports: require(subjectModuleId),
      homeDir,
      restore,
    };
  } catch (error) {
    restore();
    throw error;
  }
}

module.exports = { loadWithIsolatedLicenseEnv };
