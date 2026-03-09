const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

test('package version matches MCP manifests', () => {
  const packageJson = readJson('package.json');
  const serverManifest = readJson('server.json');
  const serverCard = readJson('.well-known/mcp/server-card.json');

  assert.equal(serverManifest.version, packageJson.version);
  assert.equal(serverManifest.packages[0].version, packageJson.version);
  assert.equal(serverCard.version, packageJson.version);
});

test('public docs render the current package version', () => {
  const packageJson = readJson('package.json');
  const landingPage = readText('docs/landing-page.html');
  const mcpSubmission = readText('docs/mcp-hub-submission.md');

  assert.match(landingPage, /v__PACKAGE_VERSION__/);
  assert.match(landingPage, /Start Cloud Pro for \$10\/mo/);
  assert.match(mcpSubmission, new RegExp(`## Version\\s+${packageJson.version}`));
});
