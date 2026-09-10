'use strict';

/**
 * Sept 2026 npm GAT / trusted-publishing contract.
 *
 * Sources (fetched 2026-09-10):
 *   - https://docs.npmjs.com/trusted-publishers/
 *   - https://docs.npmjs.com/about-access-tokens/
 *   - https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/
 *
 * Banner on npmjs.com: "tokens that bypass 2FA are being restricted —
 * account changes (Aug 2026) and direct publishing (Jan 2027)."
 *
 * This is not a Trusted Publisher clone. It pins our existing publish-npm.yml
 * to the process: OIDC-first, npm >= 11.5.1, no release cache, no default
 * NODE_AUTH_TOKEN, post-2026-09-03 allow-direct-publish opt-in.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'publish-npm.yml');
const FLOOR_CLI = path.join(ROOT, 'scripts', 'npm-oidc-cli-floor.js');
const {
  meetsNpmOidcCliFloor,
  parseNpmVersion,
  evaluateNpmOidcCliFloor,
  ERROR_PREFIX,
} = require('../scripts/npm-oidc-cli-floor');

function loadWorkflow() {
  return fs.readFileSync(WORKFLOW, 'utf8');
}

test('publish workflow filename stays publish-npm.yml (Trusted Publisher field)', () => {
  assert.equal(path.basename(WORKFLOW), 'publish-npm.yml');
});

test('OIDC trusted publishing is the default publish path', () => {
  const workflow = loadWorkflow();
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /Publishing via GitHub Actions OIDC trusted publisher/);
  assert.match(workflow, /unset NODE_AUTH_TOKEN/);
  assert.match(workflow, /npm publish --tag "\$\{NPM_TAG\}" --provenance/);
  assert.doesNotMatch(
    workflow,
    /run:\s*\n\s+npm publish --tag "\$\{\{ steps\.plan\.outputs\.npm_tag/,
    'must not inject NODE_AUTH_TOKEN via setup-node env on the publish step by default',
  );
});

test('GAT bypass-2FA fallback is opt-in and named as dying Jan 2027', () => {
  const workflow = loadWorkflow();
  assert.match(workflow, /token_fallback:/);
  assert.match(workflow, /THUMBGATE_NPM_TOKEN_FALLBACK/);
  assert.match(workflow, /die Jan 2027/);
  assert.match(
    workflow,
    /github\.event\.inputs\.token_fallback == 'true' && '1' \|\| vars\.THUMBGATE_NPM_TOKEN_FALLBACK/,
  );
});

test('post-2026-09-03 Trusted Publisher configs must allow direct npm publish', () => {
  const workflow = loadWorkflow();
  assert.match(workflow, /Allow npm publish/);
  assert.match(workflow, /npm stage publish/);
});

test('release job disables package-manager cache and requires npm >= 11.5.1', () => {
  const workflow = loadWorkflow();
  assert.match(workflow, /package-manager-cache:\s*false/);
  assert.doesNotMatch(workflow, /cache:\s*'npm'/);
  assert.match(workflow, /Trusted publishing needs npm >= 11\.5\.1/);
  assert.match(workflow, /node scripts\/npm-oidc-cli-floor\.js --version=/);
  assert.doesNotMatch(
    workflow,
    /maj === 11 && min >= 5/,
    'must not accept npm 11.5.0 via major.minor-only compare',
  );
});

test('OIDC npm CLI floor rejects 11.5.0 and accepts 11.5.1+', () => {
  assert.equal(meetsNpmOidcCliFloor('11.5.0'), false);
  assert.equal(meetsNpmOidcCliFloor('11.5.1'), true);
  assert.equal(meetsNpmOidcCliFloor('11.6.0'), true);
  assert.equal(meetsNpmOidcCliFloor('12.0.0'), true);
  assert.equal(meetsNpmOidcCliFloor('11.4.2'), false);
  assert.equal(meetsNpmOidcCliFloor('10.9.2'), false);
  assert.equal(meetsNpmOidcCliFloor('11.5'), false);
  assert.equal(meetsNpmOidcCliFloor('11.5.1-rc.0'), false);
  assert.equal(meetsNpmOidcCliFloor('11.5.1-beta'), false);
  assert.equal(meetsNpmOidcCliFloor('12.0.0-rc.1'), false);
  assert.equal(meetsNpmOidcCliFloor('11.5.1+build.1'), true);
  assert.equal(meetsNpmOidcCliFloor('not-a-version'), false);
  assert.equal(parseNpmVersion('11.5.0').patch, 0);
  assert.equal(evaluateNpmOidcCliFloor('11.5.0').ok, false);
  assert.match(evaluateNpmOidcCliFloor('11.5.0').message, new RegExp(ERROR_PREFIX));
});

test('OIDC npm CLI floor helper exits 2 for 11.5.0', () => {
  const fail = spawnSync(process.execPath, [FLOOR_CLI, '--version=11.5.0'], {
    encoding: 'utf8',
  });
  assert.equal(fail.status, 2);
  assert.match(fail.stderr, /trusted publishing needs npm >= 11\.5\.1, got 11\.5\.0/);

  const pass = spawnSync(process.execPath, [FLOOR_CLI, '--version=11.5.1'], {
    encoding: 'utf8',
  });
  assert.equal(pass.status, 0);
  assert.match(pass.stdout, /meets OIDC floor 11\.5\.1/);

  const pre = spawnSync(process.execPath, [FLOOR_CLI, '--version=11.5.1-rc.0'], {
    encoding: 'utf8',
  });
  assert.equal(pre.status, 2);
  assert.match(pre.stderr, /got 11\.5\.1-rc\.0/);
});
