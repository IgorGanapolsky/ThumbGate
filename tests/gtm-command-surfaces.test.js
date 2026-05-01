'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('package scripts expose direct GTM pack refresh commands for shipped revenue assets', () => {
  const scripts = readJson('package.json').scripts || {};

  assert.equal(scripts['gtm:claude'], 'node scripts/claude-workflow-hardening-pack.js');
  assert.equal(scripts['gtm:cursor'], 'node scripts/cursor-marketplace-revenue-pack.js');
  assert.equal(scripts['gtm:codex-plugin'], 'node scripts/codex-plugin-revenue-pack.js');
  assert.equal(scripts['gtm:gemini'], 'node scripts/gemini-cli-demand-pack.js');
  assert.equal(scripts['gtm:mcp'], 'node scripts/mcp-directory-revenue-pack.js');
});

test('customer discovery sprint documents the direct pack refresh commands', () => {
  const discovery = readText('docs/CUSTOMER_DISCOVERY_SPRINT.md');

  assert.match(discovery, /Refresh one pack without rewriting the full queue:/);
  assert.match(discovery, /npm run gtm:claude/);
  assert.match(discovery, /npm run gtm:cursor/);
  assert.match(discovery, /npm run gtm:codex-plugin/);
  assert.match(discovery, /npm run gtm:gemini/);
  assert.match(discovery, /npm run gtm:mcp/);
});
