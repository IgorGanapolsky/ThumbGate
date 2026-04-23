const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dashboardPath = path.join(__dirname, '..', 'public', 'dashboard.html');

function readDashboard() {
  return fs.readFileSync(dashboardPath, 'utf8');
}

function readDashboardScript() {
  const dashboard = readDashboard();
  const lowerDashboard = dashboard.toLowerCase();
  const startTagIndex = lowerDashboard.indexOf('<script');
  assert.notEqual(startTagIndex, -1, 'dashboard must contain an inline script');
  const scriptBodyStart = dashboard.indexOf('>', startTagIndex);
  assert.notEqual(scriptBodyStart, -1, 'dashboard inline script must have an opening tag terminator');
  const endTagIndex = lowerDashboard.indexOf('</script', scriptBodyStart + 1);
  assert.notEqual(endTagIndex, -1, 'dashboard inline script must have a closing tag');
  return dashboard.slice(scriptBodyStart + 1, endTagIndex);
}

test('dashboard escapes tag attributes and uses data-tag buttons instead of inline handlers', () => {
  const dashboard = readDashboard();

  assert.match(dashboard, /function escAttr\(s\)/);
  assert.match(dashboard, /class="tag" data-tag="/);
  assert.match(dashboard, /title="' \+ escAttr\('Search for ' \+ t\) \+ '"/);
  assert.match(dashboard, /decodeURIComponent\(tagButton\.dataset\.tag \|\| ''\)/);
  assert.doesNotMatch(dashboard, /onclick="searchByTag\(/);
});

test('dashboard routes exception text through escaped message rendering', () => {
  const dashboard = readDashboard();

  assert.match(dashboard, /function setMessageState\(container, className, message\)/);
  assert.match(dashboard, /setMessageState\(container, 'empty', e && e\.message \? e\.message : 'Search failed'\)/);
  assert.match(dashboard, /setMessageState\(container, 'empty', 'Error: ' \+ \(e && e\.message \? e\.message : 'Unable to load feedback'\)\)/);
  assert.match(dashboard, /setMessageState\(document\.getElementById\('gatesList'\), 'empty', e && e\.message \? e\.message : 'Failed to load gates'\)/);
  assert.doesNotMatch(dashboard, /<div class="empty">' \+ e\.message \+ '<\/div>'/);
});

test('dashboard includes team metrics and gate-template tabs powered by dashboard API data', () => {
  const dashboard = readDashboard();

  assert.match(dashboard, /switchTab\('team'\)/);
  assert.match(dashboard, /switchTab\('generated'\)/);
  assert.match(dashboard, /switchTab\('settings'\)/);
  assert.match(dashboard, /switchTab\('templates'\)/);
  assert.match(dashboard, /id="teamSummaryCards"/);
  assert.match(dashboard, /id="teamRiskAgents"/);
  assert.match(dashboard, /id="teamBlockedGates"/);
  assert.match(dashboard, /id="generatedViewToolbar"/);
  assert.match(dashboard, /id="generatedViewCanvas"/);
  assert.match(dashboard, /id="settingsSummaryCards"/);
  assert.match(dashboard, /id="settingsOrigins"/);
  assert.match(dashboard, /id="templateLibrary"/);
  assert.match(dashboard, /id="predictiveSummaryCards"/);
  assert.match(dashboard, /id="predictiveAnomalies"/);
  assert.match(dashboard, /id="inventorySummaryCards"/);
  assert.match(dashboard, /id="inventoryObservedTools"/);
  assert.match(dashboard, /id="inventoryPolicySources"/);
  assert.match(dashboard, /id="actionableRemediations"/);
  assert.match(dashboard, /function renderTeam\(team, analytics\)/);
  assert.match(dashboard, /function renderPredictive\(predictive\)/);
  assert.match(dashboard, /function renderAgentInventory\(inventory\)/);
  assert.match(dashboard, /function renderGeneratedView\(spec\)/);
  assert.match(dashboard, /function loadGeneratedView\(viewName\)/);
  assert.match(dashboard, /function renderSettingsStatus\(settingsStatus\)/);
  assert.match(dashboard, /function renderTemplates\(templateLibrary\)/);
  assert.match(dashboard, /function renderActionableRemediations\(remediations\)/);
  assert.match(dashboard, /\/v1\/dashboard\/render-spec\?view=/);
  assert.match(dashboard, /Approved component catalog:/);
  assert.match(dashboard, /Forecast revenue/);
  assert.match(dashboard, /highest-ROI guardrails/i);
  assert.match(dashboard, /Agent Surface Inventory/);
  assert.match(dashboard, /Highest-ROI Next Actions/);
});

test('dashboard includes incremental review checkpoint controls', () => {
  const dashboard = readDashboard();

  assert.match(dashboard, /id="reviewDeltaPanel"/);
  assert.match(dashboard, /id="reviewCheckpointBtn"/);
  assert.match(dashboard, /id="reviewDeltaHeadline"/);
  assert.match(dashboard, /id="reviewDeltaCheckpoint"/);
  assert.match(dashboard, /id="reviewDeltaLatest"/);
  assert.match(dashboard, /function renderReviewDelta\(reviewDelta\)/);
  assert.match(dashboard, /function markReviewed\(\)/);
  assert.match(dashboard, /fetch\('\/v1\/dashboard\/review-state'/);
  assert.match(dashboard, /Mark Current Dashboard Reviewed/);
});

test('dashboard defaults to the Total Feedback card highlight on first render', () => {
  const dashboard = readDashboard();

  assert.match(dashboard, /\.stat-card\.selected\s*\{/);
  assert.match(dashboard, /data-card-action="all"/);
  assert.match(dashboard, /function setSelectedCard\(action\)/);
  assert.match(dashboard, /card\.classList\.toggle\('selected', card\.dataset\.cardAction === action\)/);
  assert.match(dashboard, /renderStats\(data\);\s+setSelectedCard\('all'\);\s+await loadDashboardData\(\);/);
  assert.match(dashboard, /document\.getElementById\('statGates'\)\.textContent = '21';\s+setSelectedCard\('all'\);/);
});

test('dashboard has noindex and meta description for SEO safety', () => {
  const dashboard = readDashboard();
  assert.match(dashboard, /noindex/, 'dashboard must have noindex to prevent Google indexing a Pro-only page');
  assert.match(dashboard, /<meta name="description"/, 'dashboard must have meta description');
  assert.match(dashboard, /rel="canonical"/, 'dashboard must have canonical URL');
});

test('dashboard inline script parses after generated-view additions', () => {
  assert.doesNotThrow(() => new vm.Script(readDashboardScript()));
});
