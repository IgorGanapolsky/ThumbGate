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

const ROOT = path.join(__dirname, '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'publish-npm.yml');

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
  assert.match(workflow, /trusted publishing needs npm >= 11\.5\.1/);
});
