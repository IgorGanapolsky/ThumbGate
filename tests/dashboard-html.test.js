const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboardPath = path.join(__dirname, '..', 'public', 'dashboard.html');

function readDashboard() {
  return fs.readFileSync(dashboardPath, 'utf8');
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
  assert.match(dashboard, /switchTab\('templates'\)/);
  assert.match(dashboard, /id="teamSummaryCards"/);
  assert.match(dashboard, /id="teamRiskAgents"/);
  assert.match(dashboard, /id="teamBlockedGates"/);
  assert.match(dashboard, /id="templateLibrary"/);
  assert.match(dashboard, /function renderTeam\(team, analytics\)/);
  assert.match(dashboard, /function renderTemplates\(templateLibrary\)/);
  assert.match(dashboard, /highest-ROI guardrails/i);
});

test('dashboard has noindex and meta description for SEO safety', () => {
  const dashboard = readDashboard();
  assert.match(dashboard, /noindex/, 'dashboard must have noindex to prevent Google indexing a Pro-only page');
  assert.match(dashboard, /<meta name="description"/, 'dashboard must have meta description');
  assert.match(dashboard, /rel="canonical"/, 'dashboard must have canonical URL');
});
