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

test('dashboard hides setup bar for paid/owner accounts and shows Connect your local ThumbGate (never Finish setup) only for unheard-from Free sign-ups', async (t) => {
  const os = require('node:os');
  const crypto = require('node:crypto');
  const { startServer, __test__: serverTestHooks } = require('../src/api/server');
  const { provisionApiKey } = require('../scripts/billing');
  const dashboard = readDashboard();
  const installHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'install.html'), 'utf8');

  assert.match(dashboard, /function syncAuthBarVisibility\(state, options\)/);
  assert.equal((dashboard.match(/id="upNextCard"/g) || []).length, 1, 'must have at most one setup card');
  assert.equal((dashboard.match(/data-finish-setup-bar="true"/g) || []).length, 1, 'no second setup banner');
  assert.doesNotMatch(dashboard, /Finish setup/i, 'dashboard HTML/JS must never render Finish setup');
  assert.match(dashboard, /Connect your local ThumbGate/);
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

  // HTTP session contract: Pro, Enterprise, and owner emails NEVER receive upNext; unheard-from Free gets Connect your local ThumbGate
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-finish-setup-'));
  const savedEnv = {};
  for (const k of [
    'THUMBGATE_FEEDBACK_DIR',
    'THUMBGATE_API_KEY',
    'THUMBGATE_OPERATOR_KEY',
    'THUMBGATE_OWNER_EMAILS',
    'STRIPE_SECRET_KEY',
    '_TEST_API_KEYS_PATH',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
  ]) {
    savedEnv[k] = process.env[k];
  }
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.THUMBGATE_API_KEY = 'tg_admin_setup_test_01';
  process.env.THUMBGATE_OPERATOR_KEY = 'tg_op_setup_test_01';
  delete process.env.THUMBGATE_OWNER_EMAILS;
  process.env.STRIPE_SECRET_KEY = '';
  process.env._TEST_API_KEYS_PATH = path.join(tmpDir, 'api-keys.json');
  process.env.GOOGLE_CLIENT_ID = 'setup-test-google.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'setup-test-google-secret';

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const googleJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'setup-kid-1', alg: 'RS256', use: 'sig' };
  let nextEmail = '';
  serverTestHooks.setGoogleOAuthFetchForTests(async (url) => {
    if (String(url).includes('certs')) {
      return { ok: true, status: 200, json: async () => ({ keys: [googleJwk] }) };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'setup-kid-1', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: process.env.GOOGLE_CLIENT_ID,
      sub: `sub_${nextEmail}`,
      email: nextEmail,
      email_verified: true,
      iat: nowSec - 5,
      exp: nowSec + 300,
    })).toString('base64url');
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${hdr}.${payload}`), privateKey).toString('base64url');
    return { ok: true, status: 200, json: async () => ({ id_token: `${hdr}.${payload}.${sig}` }) };
  });

  const { server, port } = await startServer({ port: 0, host: '127.0.0.1' });
  t.after(async () => {
    serverTestHooks.setGoogleOAuthFetchForTests(null);
    await new Promise((resolve) => server.close(resolve));
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${port}`;

  async function googleSignIn(email) {
    nextEmail = email;
    const startRes = await fetch(`${origin}/v1/cloud/sso/authorize?provider=google`, { redirect: 'manual' });
    const stateCookie = (startRes.headers.get('set-cookie') || '').split(';')[0];
    const state = new URL(startRes.headers.get('location')).searchParams.get('state');
    const cbRes = await fetch(`${origin}/v1/cloud/sso/callback?provider=google&code=code_${encodeURIComponent(email)}&state=${state}`, {
      redirect: 'manual',
      headers: { cookie: stateCookie },
    });
    const authCookie = (cbRes.headers.get('set-cookie') || '').split(';')[0];
    const sessionRes = await fetch(`${origin}/v1/auth/session`, { headers: { cookie: authCookie } });
    return { authCookie, session: await sessionRes.json() };
  }

  // 1. Unheard-from Free sign-up gets "Connect your local ThumbGate" + real command, never "Finish setup"
  const freeUnheard = await googleSignIn('brandnew@example.com');
  assert.equal(freeUnheard.session.tier, 'Free');
  assert.equal(freeUnheard.session.firstBlockRecorded, false);
  assert.ok(freeUnheard.session.upNext);
  assert.equal(freeUnheard.session.upNext.title, 'Connect your local ThumbGate');
  assert.equal(freeUnheard.session.upNext.command, 'npx thumbgate quickstart');
  assert.match(freeUnheard.session.upNext.detail, /npx thumbgate quickstart/);
  assert.doesNotMatch(JSON.stringify(freeUnheard.session.upNext), /Finish setup/i);

  // 2. Free sign-up the site HAS heard from (feedback/memory/audit present) hides the bar
  const freeTenantHash = `sso_free_${crypto.scryptSync('brandnew@example.com', 'thumbgate-sso_free-data-identity-v1', 16, { N: 16384, r: 8, p: 1 }).toString('hex').slice(0, 24)}`;
  const freeTenantDir = path.join(tmpDir, 'tenants', freeTenantHash);
  fs.mkdirSync(freeTenantDir, { recursive: true });
  fs.writeFileSync(path.join(freeTenantDir, 'feedback-log.jsonl'), `${JSON.stringify({ signal: 'up', timestamp: '2026-11-12T22:00:00Z' })}\n`);
  const freeHeardRes = await fetch(`${origin}/v1/auth/session`, { headers: { cookie: freeUnheard.authCookie } });
  const freeHeard = await freeHeardRes.json();
  assert.equal(freeHeard.firstBlockRecorded, true);
  assert.equal(freeHeard.upNext, null);

  // 3. Owner email never sees the bar even when THUMBGATE_OWNER_EMAILS is unset (tier === 'Free')
  const ownerUnpaid = await googleSignIn('iganapolsky@gmail.com');
  assert.equal(ownerUnpaid.session.firstBlockRecorded, true);
  assert.equal(ownerUnpaid.session.upNext, null);

  // 4. Paid Pro subscriber with empty hosted tenant folder NEVER sees the bar
  provisionApiKey('cus_setup_pro_1', {
    customerEmail: 'paidpro@example.com',
    entitlementKind: 'subscription',
    subscriptionId: 'sub_setup_pro_1',
    source: 'stripe_webhook_checkout_completed',
  });
  const proSession = await googleSignIn('paidpro@example.com');
  assert.equal(proSession.session.tier, 'Pro');
  assert.equal(proSession.session.firstBlockRecorded, true);
  assert.equal(proSession.session.upNext, null);

  // 5. Enterprise session NEVER sees the bar
  const entLogin = await fetch(`${origin}/v1/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: 'tg_admin_setup_test_01' }),
  });
  const entCookie = (entLogin.headers.get('set-cookie') || '').split(';')[0];
  const entSession = await (await fetch(`${origin}/v1/auth/session`, { headers: { cookie: entCookie } })).json();
  assert.equal(entSession.tier, 'Enterprise');
  assert.equal(entSession.firstBlockRecorded, true);
  assert.equal(entSession.upNext, null);
});
