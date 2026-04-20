'use strict';

const fs = require('fs');
const path = require('path');
const { wireCodexHooks } = require('./auto-wire-hooks');

function codexDir(homeDir) {
  return path.join(homeDir, '.codex');
}

function codexConfigPath(homeDir) {
  return path.join(codexDir(homeDir), 'config.json');
}

function shouldAttemptCodexSelfHeal(options = {}) {
  const env = options.env || process.env;
  const homeDir = options.homeDir || env.HOME || env.USERPROFILE || '';
  if (!homeDir) return false;
  if (env.THUMBGATE_DISABLE_CODEX_SELF_HEAL === '1') return false;
  return fs.existsSync(codexDir(homeDir));
}

function repairCodexHooks(options = {}) {
  const env = options.env || process.env;
  const homeDir = options.homeDir || env.HOME || env.USERPROFILE || '';
  if (!shouldAttemptCodexSelfHeal({ env, homeDir })) {
    return { changed: false, skipped: true, reason: 'codex-not-detected' };
  }

  const settingsPath = options.settingsPath || codexConfigPath(homeDir);
  try {
    return wireCodexHooks({ settingsPath, dryRun: options.dryRun });
  } catch (error) {
    return { changed: false, skipped: true, reason: 'repair-failed', error };
  }
}

module.exports = {
  codexConfigPath,
  repairCodexHooks,
  shouldAttemptCodexSelfHeal,
};
