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

test('landing page keeps GTM and schema assets wired', () => {
  const landingPage = readText('docs/landing-page.html');
  const gtmPlan = readText('docs/GO_TO_MARKET_REVENUE_WEDGE_2026-03.md');

  assert.match(landingPage, /"@type": "SoftwareApplication"/);
  assert.match(landingPage, /"@type": "FAQPage"/);
  assert.match(landingPage, /<section id='faq'>/);
  assert.match(landingPage, /__GTM_PLAN_URL__/);
  assert.match(landingPage, /__COMPATIBILITY_REPORT_URL__/);
  assert.match(landingPage, /__AUTOMATION_REPORT_URL__/);
  assert.match(gtmPlan, /Weekly active proof-backed workflow runs\./);
  assert.match(gtmPlan, /Workflow Install Workshop/);
  assert.match(gtmPlan, /lead-to-meeting/i);
});
