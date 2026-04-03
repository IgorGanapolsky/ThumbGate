'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function withUnlicensedEnvironment(run, { prefix = 'thumbgate-unlicensed-test-' } = {}) {
  const savedEnv = {
    RLHF_API_KEY: process.env.RLHF_API_KEY,
    THUMBGATE_PRO_KEY: process.env.THUMBGATE_PRO_KEY,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
  };
  const tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  delete process.env.RLHF_API_KEY;
  delete process.env.THUMBGATE_PRO_KEY;
  process.env.HOME = tempHomeDir;
  process.env.USERPROFILE = tempHomeDir;

  try {
    return run();
  } finally {
    if (savedEnv.RLHF_API_KEY !== undefined) process.env.RLHF_API_KEY = savedEnv.RLHF_API_KEY;
    else delete process.env.RLHF_API_KEY;
    if (savedEnv.THUMBGATE_PRO_KEY !== undefined) process.env.THUMBGATE_PRO_KEY = savedEnv.THUMBGATE_PRO_KEY;
    else delete process.env.THUMBGATE_PRO_KEY;
    if (savedEnv.HOME !== undefined) process.env.HOME = savedEnv.HOME;
    else delete process.env.HOME;
    if (savedEnv.USERPROFILE !== undefined) process.env.USERPROFILE = savedEnv.USERPROFILE;
    else delete process.env.USERPROFILE;
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
  }
}

module.exports = {
  withUnlicensedEnvironment,
};
