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

test('dashboard canonicalizes raw Cloud Run .run.app URLs and renders Nov 2026 agent firewall demo', () => {
  const dashboard = readDashboard();

  assert.match(dashboard, /host\.endsWith\('\.run\.app'\)/);
  assert.match(dashboard, /window\.location\.replace\('https:\/\/thumbgate\.ai'/);
  assert.match(dashboard, /class="canonical-url-pill"/);
  assert.match(dashboard, /id="statTokensSaved"/);
  assert.match(dashboard, /renderFeedbackTrendChart\(\(data && data\.feedbackTimeSeries\) \|\| \{\}\)/);
  assert.match(dashboard, /Blocked runaway agent retry loop burning 48K tokens\/min/);
  assert.doesNotMatch(dashboard, /Jamie M\., Partner/);
});

test('dashboard and thumbgate.ai homepage provide SSO Login/Logout buttons and individual customer project workspaces without auto-demo', () => {
  const dashboard = readDashboard();
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const firewall = require('../src/cloud-token-firewall');

  assert.match(dashboard, /id="navSsoLoginBtn"/);
  assert.match(dashboard, /id="navSsoLogoutBtn"[^>]*style="display:none;/);
  assert.match(dashboard, /id="customerProjectsBar"/);
  assert.match(dashboard, /id="customerProjectSelect"/);
  assert.match(dashboard, /function signInWithSso\(provider\)/);
  assert.match(dashboard, /function loadCustomerProjects\(\)/);
  assert.match(dashboard, /function switchCustomerProject\(projectSlug\)/);
  assert.match(dashboard, /function createCustomerProject\(\)/);
  assert.match(dashboard, /never auto-load demo/);

  assert.match(indexHtml, /id="homeSsoSignInBtn"/);
  assert.match(indexHtml, /id="homeSsoLogoutBtn"[^>]*style="display:none;/);
  assert.doesNotMatch(indexHtml, /Customer SSO Log In \/ Log Out/);
  assert.match(indexHtml, /id="homeProjectSelect"/);
  assert.match(indexHtml, /window\.tgHomeSsoLogin = async function/);
  assert.match(indexHtml, /window\.tgCreateHomeProject = async function/);
  assert.match(indexHtml, /window\.tgHomeLogout = async function/);

  const authRes = firewall.initiateEnterpriseSso({
    provider: 'google',
    email: 'customer-sso@thumbgate.ai',
    redirectUri: '/dashboard',
  });
  assert.equal(authRes.ok, true);
  assert.ok(authRes.ssoToken.startsWith('tg_sso_'));

  const valid = firewall.validateSsoToken(authRes.ssoToken);
  assert.equal(valid.valid, true);
  assert.equal(valid.email, 'customer-sso@thumbgate.ai');

  const created = firewall.registerCustomerProject({
    email: valid.email,
    name: 'Checkout Service API',
  });
  assert.equal(created.ok, true);
  assert.equal(created.project.slug, 'checkout-service-api');

  const projects = firewall.listCustomerProjects(valid.email);
  assert.ok(projects.some((p) => p.slug === 'checkout-service-api'));
});

test('verified customer Sign Up, Log In credential checks, Checkout auto-account, OAuth enforcement, and /admin console work end-to-end', () => {
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const firewall = require('../src/cloud-token-firewall');

  assert.match(indexHtml, /id="homeSsoSignUpBtn"/);
  assert.doesNotMatch(indexHtml, /href="\/admin"/);
  assert.match(indexHtml, /v2_verified_accounts/);
  assert.match(adminHtml, /ThumbGate.*Admin/);
  assert.match(adminHtml, /id="adminLoginGate"/);
  assert.match(adminHtml, /id="adminProtectedDashboard" style="display:none;"/);
  assert.match(adminHtml, /\/v1\/admin\/login/);
  assert.match(adminHtml, /\/v1\/admin\/customers/);

  // 1. Unconfigured OAuth with requireVerifiedOauth must refuse instead of minting fake GOOGLE SSO
  const unconfiguredOauth = firewall.startSsoAuthorizationFlow({
    provider: 'google',
    email: 'unregistered@igorganapolsky.com',
    requireVerifiedOauth: true,
  });
  assert.equal(unconfiguredOauth.ok, false);
  assert.equal(unconfiguredOauth.error, 'oauth_provider_not_configured');

  // 2. Logging in with an email that has no registered account must return 404 account_not_found
  const missingLogin = firewall.authenticateCustomerAccount({
    email: `never-registered-${Date.now()}@example.com`,
    password: 'Password123!',
  });
  assert.equal(missingLogin.ok, false);
  assert.equal(missingLogin.statusCode, 404);
  assert.equal(missingLogin.error, 'account_not_found');

  // 3. Explicit Sign Up creates a password-protected account and returns session token
  const testEmail = `signup-${Date.now()}@example.com`;
  const signupRes = firewall.registerCustomerAccount({
    email: testEmail,
    password: 'StrongPassword99!',
    name: 'Test Customer',
    workspaceName: 'Acme Corp Prod',
  });
  assert.equal(signupRes.ok, true);
  assert.equal(signupRes.account.email, testEmail);
  assert.ok(signupRes.ssoToken.startsWith('tg_sso_'));

  // 4. Wrong password fails with 401 invalid_credentials; right password succeeds
  const badLogin = firewall.authenticateCustomerAccount({
    email: testEmail,
    password: 'WrongPassword!',
  });
  assert.equal(badLogin.ok, false);
  assert.equal(badLogin.statusCode, 401);

  const goodLogin = firewall.authenticateCustomerAccount({
    email: testEmail,
    password: 'StrongPassword99!',
  });
  assert.equal(goodLogin.ok, true);
  assert.equal(goodLogin.account.email, testEmail);

  // 5. Stripe Checkout auto-creates customer account and attaches license key
  const buyerEmail = `buyer-${Date.now()}@example.com`;
  const checkoutAcc = firewall.upsertCustomerAccountFromCheckout({
    email: buyerEmail,
    apiKey: 'tg_live_test_checkout_key_123456',
    tierId: 'pro',
    stripeSessionId: 'cs_test_123',
    stripeCustomerId: 'cus_test_123',
  });
  assert.equal(checkoutAcc.ok, true);
  assert.equal(checkoutAcc.account.tierId, 'pro');
  assert.ok(checkoutAcc.ssoToken.startsWith('tg_sso_'));

  // 6. Admin console lists all customers and supports account management
  const adminOverview = firewall.listAllCustomersAndAccounts({ keysByValue: {} });
  assert.equal(adminOverview.ok, true);
  assert.ok(adminOverview.summary.totalCustomers >= 2);
  assert.ok(adminOverview.customers.some((c) => c.email === testEmail));
  assert.ok(adminOverview.customers.some((c) => c.email === buyerEmail));
});

test('Procedural Graph Engineering (Zachary Blumenfeld) 6-pillar workflow executes deterministically end-to-end', () => {
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const {
    NODE_TYPES,
    ingestUnifiedContextNode,
    discoverCanonicalPath,
    compileSkillToGraphYaml,
    executeProceduralGraph,
    recommendModelDowngrade,
    auditGraphGovernance,
  } = require('../src/procedural-graph-engine');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-proc-graph-'));
  const graphFile = path.join(tmpDir, 'context-graph.json');

  const ingest1 = ingestUnifiedContextNode(
    {
      shortTermTurn: {
        sessionId: 'sess_loan_1',
        role: 'user',
        content: 'Evaluate policy compliance and checkout recovery for enterprise buyer',
      },
      longTermEntity: {
        id: 'ent_policy_soc2',
        entityType: 'compliance_policy',
        name: 'SOC2 Pre-Tool Verification Policy',
        systemOfRecord: 'snowflake',
        attributes: { maxRiskScore: 0.7, requireIsolatedVerifier: true },
      },
      decisionTrace: {
        id: 'trace_run_1_noisy',
        taskType: 'policy_compliance',
        outcome: 'PASS',
        entityIds: ['ent_policy_soc2'],
        steps: [
          { action: 'query_snowflake_policy', tool: 'execute_sql_readonly' },
          { action: 'query_snowflake_policy', tool: 'execute_sql_readonly' },
          { action: 'validate_isolated_verifier', tool: 'run_verifier' },
          { action: 'validate_isolated_verifier', tool: 'run_verifier' },
          { action: 'route_approval_gate', tool: 'gate_router' },
        ],
      },
    },
    graphFile
  );
  assert.equal(ingest1.ok, true);

  ingestUnifiedContextNode(
    {
      decisionTrace: {
        id: 'trace_run_2_clean',
        taskType: 'policy_compliance',
        outcome: 'PASS',
        entityIds: ['ent_policy_soc2'],
        steps: [
          { action: 'query_snowflake_policy', tool: 'execute_sql_readonly' },
          { action: 'validate_isolated_verifier', tool: 'run_verifier' },
          { action: 'route_approval_gate', tool: 'gate_router' },
        ],
      },
    },
    graphFile
  );

  const discovery = discoverCanonicalPath('policy_compliance', graphFile);
  assert.equal(discovery.ok, true);
  assert.equal(discovery.canonicalPath.stepCount, 3);

  const sampleSkillMd = [
    '---',
    'name: enterprise-policy-gate',
    'description: Deterministic compliance & risk gate',
    '---',
    '# Enterprise Policy Gate',
    '1. Run hard-rule preflight script `bin/agent-loop --health --json` before any mutation.',
    '2. Validate schema and test suite with `npm run verify:isolated`.',
    '3. If risk score >= 0.7 or policy check fails, refuse and escalate to human reviewer.',
    '4. Classify residual edge-case intent using calibrated rubric model.',
  ].join('\n');

  const compiled = compileSkillToGraphYaml(
    {
      skillMarkdown: sampleSkillMd,
      skillPath: 'skills/enterprise-policy-gate/SKILL.md',
      taskType: 'policy_compliance',
    },
    graphFile
  );
  assert.equal(compiled.ok, true);
  assert.match(compiled.yaml, /schema_version: "1\.0"/);
  assert.match(compiled.yaml, /recommended_execution_model: "claude-haiku-4-5"/);

  const nodeTypes = compiled.compiledGraph.nodes.map((n) => n.type);
  assert.ok(nodeTypes.includes(NODE_TYPES.HARD_RULE_SCRIPT));
  assert.ok(nodeTypes.includes(NODE_TYPES.VALIDATION_LINT_LOOP));
  assert.ok(nodeTypes.includes(NODE_TYPES.ESCALATION_ROUTER));

  const downgrade = recommendModelDowngrade(compiled.compiledGraph.nodes);
  assert.equal(downgrade.canDowngradeToSlm, true);
  assert.equal(downgrade.recommendedExecutionModel, 'claude-haiku-4-5');

  const passRun = executeProceduralGraph(
    {
      graphId: compiled.graphId,
      context: { policyCompliant: true, riskScore: 0.15, validationPassed: true },
      entityIds: ['ent_policy_soc2'],
    },
    graphFile
  );
  assert.equal(passRun.ok, true);
  assert.equal(passRun.run.verdict, 'ALLOW');

  const blockRun = executeProceduralGraph(
    {
      graphId: compiled.graphId,
      context: { policyCompliant: false, riskScore: 0.92 },
      entityIds: ['ent_policy_soc2'],
    },
    graphFile
  );
  assert.equal(blockRun.ok, true);
  assert.equal(blockRun.run.verdict, 'BLOCK');

  const audit = auditGraphGovernance({ graphId: compiled.graphId }, graphFile);
  assert.equal(audit.ok, true);
  assert.equal(audit.totalPersistedRuns, 2);

  const cliOut = execFileSync(
    process.execPath,
    [
      path.join(__dirname, '..', 'scripts', 'procedural-graph-cli.js'),
      'audit',
      '--graph-id',
      compiled.graphId,
      '--graph-store',
      graphFile,
      '--json',
    ],
    { encoding: 'utf8' }
  );
  assert.equal(JSON.parse(cliOut).ok, true);
});

test('Deslopify 9 Habits, Herjavec Closer, YouSpot Pro, HarnessSQL, Zou Group Shelf-Life, Soft-MTP, Skool/Jarvis HUD, qwenGPU, LinkedIn OTel, and Grok Data Bot execute deterministically', () => {
  const deslopify = require('../src/deslopify-engine');
  const herjavec = require('../src/herjavec-closer-engine');

  // 1. Deslopify Pre-Execution POV Gate blocks empty prompt and passes voice brain-dump + confidence pushback
  const blockedPov = deslopify.evaluatePreExecutionPovGate({ whatYouThink: 'short' });
  assert.equal(blockedPov.ok, false);
  assert.equal(blockedPov.verdict, 'BLOCK_MISSING_POV');

  const allowedPov = deslopify.evaluatePreExecutionPovGate({
    voiceTranscript:
      'I think our onboarding drops off when technical buyers see 4 clicks before Stripe checkout, and I worry they bounce on pricing complexity.',
    confidencePct: 60,
  });
  assert.equal(allowedPov.ok, true);
  assert.equal(allowedPov.verdict, 'ALLOW_WITH_POV');
  assert.equal(allowedPov.requiresPushback, true);
  assert.ok(allowedPov.opposingSteelman.length >= 3);

  // 2. Deslopify 6 Divergent Angles & 4-Persona Review Board & 5-Sentence Read Budget
  const angles = deslopify.generateSixDivergentAngles('Enterprise PreToolUse Governance');
  assert.equal(angles.angles.length, 6);
  assert.ok(angles.angles.some((a) => a.id === 'angle_1_game_designer'));

  const reviewBoard = deslopify.runFourPersonaReviewBoard(
    'We shipped a 1ms PreToolUse firewall that cut repeat CI failures by 68% ($49 bundle).',
    { maxSentences: 5 }
  );
  assert.equal(reviewBoard.personas.length, 4);
  assert.equal(reviewBoard.verdict, 'SHIP_APPROVED');

  const budgetPass = deslopify.enforceReadBudgetAndLabelGate(
    'Sentence one sets context. Sentence two proves the metric. Sentence three shows the fix. Sentence four gives the link. Sentence five closes.',
    { maxSentences: 5 }
  );
  assert.equal(budgetPass.ok, true);
  assert.equal(budgetPass.verdict, 'PASS_READ_BUDGET');

  const rawDump = deslopify.enforceReadBudgetAndLabelGate('Unedited dump. '.repeat(12), {
    maxSentences: 5,
    isRawAiResearchDump: true,
  });
  assert.equal(rawDump.verdict, 'LABELED_RAW_AI_DUMP');
  assert.match(rawDump.outputText, /^\[AI-GENERATED RESEARCH DUMP — UNEDITED\]/);

  // 3. Robert Herjavec Chase-the-No CTO/CISO Objection Closer & 4-Clicks-to-1-Click Audit
  const procurementObj = herjavec.resolveTechnicalBuyerObjection({
    buyerStatement: 'We cannot put a recurring monthly subscription on a corporate card without procurement review.',
  });
  assert.equal(procurementObj.ok, true);
  assert.equal(procurementObj.matchedObjection.id, 'procurement_subscription_blocker');
  assert.equal(procurementObj.matchedObjection.priceDollars, 49);

  const clickAudit = herjavec.auditFourClicksToOneClick();
  assert.equal(clickAudit.ok, true);
  assert.equal(clickAudit.totalClicksEliminated, 12);

  // 4. YouSpot Pro Solo-Builder Conversion & Promo Unlocks
  const youspotPromo = herjavec.evaluateYouSpotProConversionPack({ promoCode: 'FOUNDER49' });
  assert.equal(youspotPromo.ok, true);
  assert.equal(youspotPromo.promoApplied, true);
  assert.equal(youspotPromo.promoDetails.priceDollars, 49);

  // 5. HKUST + DeepSeek HarnessSQL 4-Tool Read-Only Sandbox & Tool-Observation Loss Masking
  const mutatingBlocked = herjavec.executeHarnessSqlFourToolStep({
    tool: 'execute_query',
    sql: 'DROP TABLE customer_accounts;',
  });
  assert.equal(mutatingBlocked.ok, false);
  assert.equal(mutatingBlocked.verdict, 'BLOCK_MUTATING_SQL');

  const selectAllowed = herjavec.executeHarnessSqlFourToolStep({
    tool: 'execute_query',
    sql: 'SELECT tier_id, COUNT(*) FROM customer_accounts GROUP BY tier_id;',
  });
  assert.equal(selectAllowed.ok, true);
  assert.equal(selectAllowed.lossMaskForObservation, 0);

  const exportedTrajectory = herjavec.exportHarnessTrajectoryWithObservationMasking([
    { role: 'assistant', content: 'Let us inspect customer_accounts schema.' },
    { role: 'tool', content: 'columns: email, role, tier_id' },
    { role: 'assistant', content: 'SELECT COUNT(*) FROM customer_accounts;' },
  ]);
  assert.equal(exportedTrajectory.ok, true);
  assert.equal(exportedTrajectory.trajectoryStats.trainedActionTurns, 2);
  assert.equal(exportedTrajectory.trajectoryStats.maskedObservationTurns, 1);

  // 6. Stanford Zou Group LLM Claims Shelf-Life & Prevention-Rule Pruner
  const shelfLife = herjavec.evaluateLlmClaimShelfLife();
  assert.equal(shelfLife.ok, true);
  assert.equal(shelfLife.empiricalBaseline.totalDecayedPct, 78);
  assert.ok(shelfLife.auditSummary.prunableRuleIds.includes('rule_cot_json_workaround_2024'));
  assert.ok(shelfLife.auditSummary.hardGatePromotions.includes('rule_observation_loss_masking_rl'));

  // 7. MIT Jayden Teoh Soft-MTP (arXiv:2610.38331) Exact KL Gradient Recovery
  const softMtp = herjavec.evaluateSoftMtpGradientRouting({
    sequenceLengthT: 2048,
    numMtpHeadsK: 2,
    lambdaMtp: 0.3,
    modelScaleParamsM: 1200,
  });
  assert.equal(softMtp.ok, true);
  assert.equal(softMtp.exactDecompositionVerification.exactRecoveryVerified, true);
  assert.equal(softMtp.headRescalingFactors.length, 2);

  // 8. Skool Julian Goldie AI Money Lab (94,392 members) Monetizer & Jarvis HUD (31 Bots, 1 Screen)
  const skoolPack = herjavec.evaluateSkoolJulianGoldieMonetizer();
  assert.equal(skoolPack.ok, true);
  assert.equal(skoolPack.community.totalMembers, 94392);
  assert.equal(skoolPack.readyToPostAssets.length, 3);

  const jarvisHud = herjavec.evaluateJarvisHudDecisionQueue({
    decisionId: 'dec_magnet_checkout_49',
    action: 'APPROVE',
  });
  assert.equal(jarvisHud.ok, true);
  assert.equal(jarvisHud.fleetSummary.totalBotsMonitored, 31);
  assert.ok(jarvisHud.waitingOnYouQueue.some((d) => d.status === 'APPROVED_AND_DISPATCHED'));

  // 9. qwenGPU 4-Lane SIMT Compiled Weight Circuit ([1, 2, 3] @ [4, 5, 6] === 32)
  const qwenGpu = herjavec.evaluateQwenGpuSimtCompiledCircuit({
    vectorA: [1, 2, 3, 0],
    vectorB: [4, 5, 6, 0],
  });
  assert.equal(qwenGpu.ok, true);
  assert.equal(qwenGpu.executionTrace.exactResult, 32);
  assert.equal(qwenGpu.textTokenMutingGuard.teslaT4KernelParity, '49/49 exact');

  // 10. LinkedIn OpenTelemetry pageForestId Tap-to-Backend Journey & Grok Team Data Bot
  const otelForest = herjavec.evaluateLinkedInOtelJourneyForest({ appMovedToBackground: true });
  assert.equal(otelForest.ok, true);
  assert.equal(otelForest.coordinatedHeadSampling.debugVolumeShedPct, 90);
  assert.equal(otelForest.coordinatedHeadSampling.redactedSensitiveAttributesCount, 1);
  assert.equal(otelForest.revenueJourneyDiagnosis.dropOffDetected, true);

  const dataBot = herjavec.evaluateGrokTeamDataBot({ persona: 'marketer' });
  assert.equal(dataBot.ok, true);
  assert.equal(dataBot.botHealthAudit.archetypeClassification, 'BROAD_AND_STICKY');
  assert.equal(dataBot.botHealthAudit.meets60PctEmbeddedRule, true);

  // 11. Gartner 90/10 Open-Weight Agentic Harness Router (20x guarded vs ~5.7x unguarded savings + 90% M&A perimeter retention)
  const gartnerGuarded = herjavec.evaluateGartnerOpenModelHarnessRouter({ thumbgateGuardrailsEnabled: true });
  assert.equal(gartnerGuarded.ok, true);
  assert.equal(gartnerGuarded.workflowRoutingSummary.routineSharePct, 90);
  assert.equal(gartnerGuarded.workflowRoutingSummary.routineStepCostReductionMultiple, 20);
  assert.equal(gartnerGuarded.maValuationPerimeterMoat.workflowHistoryRetainedInPerimeterPct, 90);

  const gartnerUnguarded = herjavec.evaluateGartnerOpenModelHarnessRouter({ thumbgateGuardrailsEnabled: false });
  assert.equal(gartnerUnguarded.workflowRoutingSummary.routineStepCostReductionMultiple, 5.71);

  // 12. Kanzo AI-Agent Kanban Process & Human-Only Guardrail Engine (backlog agent-safe zone, humanOnly lock, ~900 token tool spec)
  const kanzoAllowed = herjavec.evaluateKanzoAgentBoardProcess({
    actor: 'agent',
    action: 'take_next_task',
  });
  assert.equal(kanzoAllowed.ok, true);
  assert.equal(kanzoAllowed.verdict, 'KANZO_PROCESS_APPLIED');
  assert.equal(kanzoAllowed.tokenEfficiencySpec.sessionToolListTokens, 900);

  const kanzoBacklogBlocked = herjavec.evaluateKanzoAgentBoardProcess({
    actor: 'agent',
    cardId: 'card_101',
  });
  assert.equal(kanzoBacklogBlocked.ok, false);
  assert.equal(kanzoBacklogBlocked.verdict, 'BLOCK_AGENT_BACKLOG_ACCESS');

  const kanzoHumanOnlyBlocked = herjavec.evaluateKanzoAgentBoardProcess({
    actor: 'agent',
    cardId: 'card_102',
  });
  assert.equal(kanzoHumanOnlyBlocked.ok, false);
  assert.equal(kanzoHumanOnlyBlocked.verdict, 'BLOCK_HUMAN_ONLY_TASK');

  const firewall = require('../src/cloud-token-firewall');
  const kanzoGate = firewall.evaluateDanKornasKanzoAgentKanbanSteal({
    actor: 'agent',
    action: 'take_next_task',
    gitRemoteUrl: 'https://github.com/IgorGanapolsky/ThumbGate.git',
  });
  assert.equal(kanzoGate.ok, true);
  assert.equal(kanzoGate.projectDetection.detectedProjectSlug, 'ThumbGate');
  assert.equal(kanzoGate.activeTask.column, 'doing');
  assert.equal(
    firewall.evaluateDanKornasKanzoAgentKanbanSteal({ actor: 'agent', taskId: 'task_backlog_1' }).ok,
    false
  );
  assert.equal(
    firewall.evaluateDanKornasKanzoAgentKanbanSteal({ actor: 'agent', taskId: 'task_todo_human_1' }).ok,
    false
  );
  assert.equal(
    firewall.evaluateDanKornasKanzoAgentKanbanSteal({ actor: 'agent', vendorAgplCode: true }).ok,
    false
  );
});

test('FinOps Phase 4 Intervention: Direct Cloud Indie/Startup alias slugs and Cancel-page buyer-email recovery capture work end-to-end', async () => {
  const prevInsecure = process.env.THUMBGATE_ALLOW_INSECURE;
  process.env.THUMBGATE_ALLOW_INSECURE = 'true';
  const serverMod = require('../src/api/server');
  assert.equal(serverMod.__test__.CHECKOUT_FEATURE_FLAGS.directCloudTierCheckoutEnabled, true);
  const srv = serverMod.createApiServer();
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const port = srv.address().port;
  try {
    const indieRes = await fetch(`http://127.0.0.1:${port}/go/cloud-indie-49`, {
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/130.0' },
    });
    assert.equal(indieRes.status, 302);
    assert.match(indieRes.headers.get('location') || '', /plan_id=cloud_indie/);

    const startupRes = await fetch(`http://127.0.0.1:${port}/go/cloud-startup-199`, {
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/130.0' },
    });
    assert.equal(startupRes.status, 302);
    assert.match(startupRes.headers.get('location') || '', /plan_id=cloud_startup/);

    const cancelRes = await fetch(`http://127.0.0.1:${port}/checkout/cancel?customer_email=cto%40acme.io`);
    assert.equal(cancelRes.status, 200);
    const cancelHtml = await cancelRes.text();
    assert.match(cancelHtml, /id="buyer-email"/);
    assert.match(cancelHtml, /customerEmail:\s*buyerEmail/);
    assert.match(cancelHtml, /Start 7-Day Free Pro Trial/);
  } finally {
    if (prevInsecure === undefined) delete process.env.THUMBGATE_ALLOW_INSECURE;
    else process.env.THUMBGATE_ALLOW_INSECURE = prevInsecure;
    await new Promise((resolve) => srv.close(resolve));
  }
});

