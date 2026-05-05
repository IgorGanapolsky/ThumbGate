'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const loadEnv = require('../scripts/social-analytics/load-env');

test('loadLocalEnv reads durable repo and home fallback env files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-load-env-'));
  const repoRoot = path.join(tmp, 'repo');
  const homeDir = path.join(tmp, 'home');
  fs.mkdirSync(path.join(repoRoot, '.thumbgate'), { recursive: true });
  fs.mkdirSync(path.join(homeDir, '.thumbgate'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '.env.local'), 'LOCAL_ONLY=repo-local\n');
  fs.writeFileSync(path.join(homeDir, '.thumbgate', '.env'), 'HOME_ONLY=home-env\n');
  fs.writeFileSync(path.join(homeDir, '.thumbgate', 'bluesky-monitor.env'), 'BLUESKY_HANDLE=iganapolsky.bsky.social\n');
  fs.writeFileSync(path.join(homeDir, '.thumbgate', 'reddit-monitor.env'), 'REDDIT_USERNAME=eazyigz123\n');

  const originalHomedir = os.homedir;
  const originalEnv = {
    LOCAL_ONLY: process.env.LOCAL_ONLY,
    HOME_ONLY: process.env.HOME_ONLY,
    BLUESKY_HANDLE: process.env.BLUESKY_HANDLE,
    REDDIT_USERNAME: process.env.REDDIT_USERNAME,
  };
  os.homedir = () => homeDir;
  delete process.env.LOCAL_ONLY;
  delete process.env.HOME_ONLY;
  delete process.env.BLUESKY_HANDLE;
  delete process.env.REDDIT_USERNAME;

  try {
    const result = loadEnv.loadLocalEnv({
      envPath: path.join(repoRoot, '.env'),
    });

    assert.equal(result.exists, true);
    assert.equal(result.paths.includes(path.join(repoRoot, '.env.local')), true);
    assert.equal(result.paths.includes(path.join(homeDir, '.thumbgate', '.env')), true);
    assert.equal(result.paths.includes(path.join(homeDir, '.thumbgate', 'bluesky-monitor.env')), true);
    assert.equal(result.paths.includes(path.join(homeDir, '.thumbgate', 'reddit-monitor.env')), true);
    assert.equal(process.env.LOCAL_ONLY, 'repo-local');
    assert.equal(process.env.HOME_ONLY, 'home-env');
    assert.equal(process.env.BLUESKY_HANDLE, 'iganapolsky.bsky.social');
    assert.equal(process.env.REDDIT_USERNAME, 'eazyigz123');
  } finally {
    os.homedir = originalHomedir;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
