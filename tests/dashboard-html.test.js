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

test('dashboard hides unavailable team controls and retains gate-template tabs', () => {
  const dashboard = readDashboard();

  assert.match(dashboard, /class="quick-nav-link" hidden style="display:none" onclick="switchTab\('team'\)"/);
  assert.match(dashboard, /class="tab" hidden style="display:none" onclick="switchTab\('team'\)"/);
  assert.match(dashboard, /id="tab-team" hidden style="display:none !important"/);
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
  assert.match(dashboard, /id="backgroundAgentSummaryCards"/);
  assert.match(dashboard, /id="backgroundAgentHighlights"/);
  assert.match(dashboard, /id="backgroundAgentRunTypes"/);
  assert.match(dashboard, /id="regulatedProofSummaryCards"/);
  assert.match(dashboard, /id="regulatedProofDetails"/);
  assert.match(dashboard, /id="regulatedProofArtifacts"/);
  assert.match(dashboard, /id="actionableRemediations"/);
  assert.match(dashboard, /function renderTeam\(team, analytics\)/);
  assert.match(dashboard, /function renderPredictive\(predictive\)/);
  assert.match(dashboard, /function renderAgentInventory\(inventory\)/);
  assert.match(dashboard, /function renderBackgroundAgents\(backgroundAgents\)/);
  assert.match(dashboard, /function renderRegulatedProof\(regulatedProof\)/);
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
  assert.match(dashboard, /Background Agent Mode/);
  assert.match(dashboard, /Regulated Buyer Proof/);
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
  assert.match(dashboard, /<body data-revenue-assist="off">/);
  assert.match(dashboard, /function disconnectKey\(\)\s*\{\s*pauseDashboardHydration\(\);\s*dashboardDataPromise = null;/);
  assert.match(
    dashboard,
    /renderStats\(data\);\s+setSelectedCard\('all'\);[\s\S]*?scheduleDashboardHydration\(10000\);/,
    'first render should select Total Feedback before deferring dashboard hydration',
  );
  assert.match(dashboard, /document\.getElementById\('statGates'\)\.textContent = '14';\s+setSelectedCard\('all'\);/);
});

test('dashboard paints Active Gates from feedback/stats so the hero card is never stuck on —', () => {
  // Match against full HTML (dashboard may have multiple <script> tags; the
  // first is not always the main app script).
  const dashboard = readDashboard();

  // Connect path only calls /v1/feedback/stats → renderStats first. That path
  // must set #statGates from activeGateCount/gateStats, not leave the HTML "—".
  assert.match(dashboard, /function resolveActiveGateCount\(data\)/);
  assert.match(dashboard, /function renderStats\(data\)/);
  assert.match(dashboard, /activeGateCount/);
  assert.match(dashboard, /document\.getElementById\('statGates'\)\.textContent = gateCount/);
  // On /v1/dashboard failure, never leave the placeholder dash if still blank.
  assert.match(dashboard, /gatesEl\.textContent === '—'/);
  assert.match(dashboard, /gatesEl\.textContent = '0'/);
  // Dashboard payload path uses resolveActiveGateCount (not `length || totalGates`
  // which mis-handles zeros).
  assert.match(dashboard, /function renderDashboardData\(data\)/);
  assert.match(dashboard, /resolveActiveGateCount\(data\)/);
  assert.doesNotMatch(
    dashboard,
    /statGates'\)\.textContent = gates\.length \|\| gateStats\.totalGates \|\| 0/,
  );
  assert.match(dashboard, /id="statGates"/);
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

test('dashboard demo keeps paid and revenue placeholders evidence-safe', () => {
  const dashboard = readDashboard();

  assert.match(dashboard, /Sample demo data below\./);
  assert.match(dashboard, /Paid and revenue fields stay hidden until hosted evidence loads\./);
  assert.match(dashboard, /Awaiting evidence/);
  assert.match(dashboard, /demo mode never invents forecast dollars/);
  assert.doesNotMatch(dashboard, /\$128\.00/);
  assert.doesNotMatch(dashboard, /1 paid order/);
  assert.doesNotMatch(dashboard, /opportunity \$49\.00/);
  assert.doesNotMatch(dashboard, /Live demo data below\./);
});

test('dashboard hides sign-in button and sign-in copy when signed in and renders a single Finish setup bar keyed on first block', () => {
  const dashboard = readDashboard();
  const installHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'install.html'), 'utf8');

  assert.match(dashboard, /function syncAuthBarVisibility\(state, options\)/);
  assert.equal((dashboard.match(/id="upNextCard"/g) || []).length, 1, 'must have exactly one Finish setup bar');
  assert.equal((dashboard.match(/data-finish-setup-bar="true"/g) || []).length, 1, 'no second setup banner');
  assert.match(dashboard, /id="upNextActionBtn" href="\/install#quickstart"/);
  assert.match(dashboard, /npx thumbgate quickstart/);
  assert.match(installHtml, /id="quickstart"/);
  assert.match(installHtml, /npx thumbgate quickstart/);
  assert.match(dashboard, /id="gateStatusChips"/);
  assert.match(dashboard, /data-chip-count="blocked-today"/);
  assert.match(dashboard, /data-chip-count="warned-today"/);
  assert.match(dashboard, /data-chip-count="active-gates"/);
  assert.match(dashboard, /function chatRenderModelRoute\(data\)/);
  assert.match(dashboard, /id="lessonStorageFooter"/);
  assert.match(dashboard, /100% On-Device Private Memory/);
});


test('unavailable team selection falls back to the visible search pane', () => {
  const script = readDashboard();
  const start = script.indexOf('function switchTab(name) {');
  const end = script.indexOf('\nfunction ', start + 1);
  const switchTabSource = script.slice(start, end);
  const active = new Set();
  const pane = {
    classList: { add: (name) => active.add(name) },
    scrollIntoView() {},
  };
  let selectedPane;
  let selectedTab;
  let selectedHash;
  const context = {
    document: {
      querySelectorAll: () => [{ classList: { remove: (name) => active.delete(name) } }],
      querySelector: (selector) => { selectedTab = selector; return pane; },
      getElementById: (id) => { selectedPane = id; return pane; },
    },
    window: { location: { hash: '#team' } },
    history: { replaceState: (_state, _title, hash) => { selectedHash = hash; } },
    hasActiveAuth: () => false,
  };
  vm.runInNewContext(switchTabSource + "\nswitchTab('team');", context);
  assert.equal(selectedPane, 'tab-search');
  assert.equal(selectedTab, '.tab[onclick*="search"]');
  assert.equal(selectedHash, '#search');
  assert.equal(active.has('active'), true);
});
