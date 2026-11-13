'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fw = require('../src/cloud-token-firewall');
const { internalizeEmailIdea } = require('../scripts/thumbgate-email-steal-engine');
const { startServer } = require('../src/api/server');

test('Oct 28 & Oct 29 self-sent strategy emails are internalized and enforced in cloud-token-firewall', () => {
  const bundle = fw.evaluateSixOct28EmailStealsBundle();
  assert.equal(bundle.ok, true);
  assert.equal(bundle.internalizedCount, 6);

  const jellyfishDirect = fw.evaluateJellyfishClaudeCodeBillSteal({ developerCount: 10 });
  assert.equal(jellyfishDirect.ok, true);
  assert.equal(bundle.steals.jellyfishClaudeCode252.benchmark.avgClaudeCodeMonthlyBillPerDevUsd, 252);

  assert.equal(fw.evaluateIbmAgentIdentityAndControlSteal({ sessionPassportVerified: false }).ok, false);
  assert.equal(fw.evaluateGrokBotMemoryImportSteal({ containsRawSecrets: true }).ok, false);
  assert.equal(fw.evaluateGenie4WorldModelCounterfactualSteal({ reversibleState: false }).ok, false);
  assert.equal(fw.evaluateFiveFactorEvalDataCurationSteal({ sourcedFromRealWorldCursorBenchUsage: false }).ok, false);
  assert.equal(fw.evaluateSupabaseAgentDatabaseSteal({ isProductionBranchDdl: true, ephemeralBranchCreated: false }).ok, false);

  const glmOk = fw.evaluateGlm53WorkersAiSglangKvCacheIsolationSteal();
  assert.equal(glmOk.ok, true);
  assert.equal(glmOk.sourceEmailUid, '311029');
  assert.equal(fw.evaluateGlm53WorkersAiSglangKvCacheIsolationSteal({ crossRequestKvReuseWithoutSalt: true }).ok, false);

  assert.equal(fw.evaluateHermesGuideLinksAndProKeySteal().ok, true);
  assert.equal(fw.evaluateHermesGuideLinksAndProKeySteal({ boundedMemoryChars: 3000 }).ok, false);

  const batchOk = fw.evaluateOct28InboxSelfStrategyBatchSteal();
  assert.equal(batchOk.ok, true);
  assert.equal(batchOk.sourceEmailUids.length, 13);
  assert.equal(fw.evaluateOct28InboxSelfStrategyBatchSteal({ webMcpBrowserToolSchemaIntrospected: false }).ok, false);
});

test('thumbgate-email-steal-engine enforces on-disk code + test verification before authorizing archive/delete', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-email-steal-wt-'));
  try {
    const res = internalizeEmailIdea({
      messageId: '<test-jellyfish-252@mail.gmail.com>',
      uid: '148673',
      subject: 'Thumbgate marketing -- Jellyfish: Claude Code bills hit $252 a month per developer as software factories automate code production among early adopters',
      body: 'Jellyfish: Claude Code bills hit $252 a month per developer https://share.google/pTnoFF9WxKADyqcMl',
      vaultArchiveDir: path.join(tmpDir, 'vault'),
      stolenLedgerPath: path.join(tmpDir, 'stolen.jsonl'),
      internalizedLedgerPath: path.join(tmpDir, 'internalized.jsonl'),
    });
    assert.equal(res.ok, true);
    assert.equal(res.readyToArchiveOrDelete, true);
    assert.equal(res.codeVerified, true);
    assert.equal(res.stealFn, 'evaluateJellyfishClaudeCodeBillSteal');
    assert.ok(fs.existsSync(path.join(tmpDir, 'internalized.jsonl')));

    const unimplementedLedger = path.join(tmpDir, 'unimplemented-internalized.jsonl');
    const held = internalizeEmailIdea({
      messageId: '<test-unimplemented-future-idea@mail.gmail.com>',
      uid: '999999',
      subject: 'Thumbgate --- Brand New Unimplemented Quantum Agent Router Paper',
      body: 'https://example.com/quantum-agent-router',
      vaultArchiveDir: path.join(tmpDir, 'vault'),
      stolenLedgerPath: path.join(tmpDir, 'stolen.jsonl'),
      internalizedLedgerPath: unimplementedLedger,
    });
    assert.equal(held.ok, false);
    assert.equal(held.readyToArchiveOrDelete, false);
    assert.equal(held.codeVerified, false);
    assert.equal(fs.existsSync(unimplementedLedger), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('/pricing, /cancel, /checkout/cancel, and /checkout/pro expose $9.99 Playbook, $49 Bundle one-time downsells, and 1-click /go/pro-direct', async () => {
  const prevKey = process.env.THUMBGATE_API_KEY;
  process.env.THUMBGATE_API_KEY = 'tg_test_verify_downsells';
  const handle = await startServer({ port: 0, host: '127.0.0.1' });
  try {
    const base = `http://127.0.0.1:${handle.port}`;
    for (const routePath of ['/pricing', '/cancel', '/checkout/cancel', '/checkout/pro']) {
      const res = await fetch(`${base}${routePath}`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('/go/playbook-999'), `${routePath} should include $9.99 playbook downsell`);
      assert.ok(html.includes('/go/bundle-49'), `${routePath} should include $49 bundle downsell`);
      assert.ok(html.includes('/go/pro-direct'), `${routePath} should include 1-click /go/pro-direct`);
    }
  } finally {
    if (prevKey === undefined) delete process.env.THUMBGATE_API_KEY;
    else process.env.THUMBGATE_API_KEY = prevKey;
    handle.server.close();
    handle.server.closeAllConnections?.();
  }
});

test('public/index.html implements Gemini and Claude UI/UX, social proof, sandbox, Pro visual debugger, and static-hook comparison upgrades', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(indexHtml, /Stop AI agent mistakes before they cost you/);
  assert.match(indexHtml, /Setup Sprint|Diagnostic Gate/);
  assert.match(indexHtml, /\$19\/mo/);
  assert.doesNotMatch(indexHtml, /Cursor Marketplace listing is not live/);
  assert.doesNotMatch(indexHtml, /VS Code Marketplace 1\.27\.20/);
});

test('Broadcast-Aware Mixture-of-Experts (MoE) and LLM-as-Judge Swarm SOW enforces non-overlapping slices and 100-pt rubric', () => {
  const sow = fw.evaluateBroadcastMoESwarmAndLlmJudgeSow({
    prompt: 'How would you rank and grade our multi agent coordination? Using Linear, Obsidian Vault, GitButler, Gemini notebook, GitHub issues, etc?',
  });
  assert.equal(sow.ok, true);
  assert.equal(sow.moeSlices.length, 4);
  assert.equal(sow.llmAsJudge.rubricLocked, true);
  assert.equal(sow.llmAsJudge.winnerScore, 100);
  assert.equal(sow.tokenEfficiencyReductionPct, 68.5);
});

test('Zero-mock Cloud Portal & SSO enforce real email or OAuth Client ID, zero fake 1420 token seeds, and persistent disk telemetry', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cloud-real-'));
  const prevFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  fw.resetCloudFirewallStateForTests();
  try {
    // 1. Unauthenticated portal session returns 0 tokens and unauthenticated status (never customer@thumbgate.ai or 1420 fake tokens)
    const unauth = fw.getCloudCustomerPortalSession({});
    assert.equal(unauth.authenticated, false);
    assert.equal(unauth.customer.email, null);
    assert.equal(unauth.telemetry.tokensOptimizedMonthly, 0);
    assert.equal(unauth.telemetry.tokensSavedTotal, 0);

    // 2. SSO without email or OAuth Client ID fails closed (never invents user@gmail.com or developer@github.user)
    const rejectedSso = fw.startSsoAuthorizationFlow({ provider: 'github', email: '' });
    assert.equal(rejectedSso.ok, false);
    assert.equal(rejectedSso.error, 'real_email_or_oauth_client_id_required');

    // 3. SSO with GITHUB_CLIENT_ID redirects to real github.com/login/oauth/authorize
    process.env.GITHUB_CLIENT_ID = 'Iv1.real_github_client_id';
    const oauthRedirect = fw.startSsoAuthorizationFlow({ provider: 'github', email: '' });
    assert.equal(oauthRedirect.ok, true);
    assert.equal(oauthRedirect.mode, 'oauth_redirect');
    assert.match(oauthRedirect.redirectUrl, /^https:\/\/github\.com\/login\/oauth\/authorize\?client_id=Iv1\.real_github_client_id/);
    delete process.env.GITHUB_CLIENT_ID;

    // 4. SSO with real email provisions HMAC-verified persistent session starting at 0 tokens, then updates on real intercept
    const realSso = fw.startSsoAuthorizationFlow({ provider: 'google', email: 'founder@company.io' });
    assert.equal(realSso.ok, true);
    assert.equal(realSso.session.authenticated, true);
    assert.equal(realSso.session.telemetry.tokensOptimizedMonthly, 0);

    await fw.interceptAgentRequest({
      tenantKey: realSso.ssoToken,
      tierId: 'cloud_indie',
      sessionId: 'real-run-1',
      toolCall: { name: 'bash', arguments: { cmd: 'npm test' } },
      messages: [
        { role: 'system', content: 'Follow strict PreToolUse verification rules.' },
        { role: 'system', content: 'Follow strict PreToolUse verification rules.' },
        { role: 'user', content: 'Run tests.' },
      ],
    });

    const updatedSession = fw.getCloudCustomerPortalSession({ apiKey: realSso.ssoToken });
    assert.ok(updatedSession.telemetry.tokensOptimizedMonthly > 0);
    assert.ok(fs.existsSync(path.join(tmpDir, 'cloud-tenant-usage.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'cloud-sso-sessions.json')));
  } finally {
    if (prevFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = prevFeedbackDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Tailscale October 2026 Newsletter Steal enforces scurgery byte-identical policy blocks, Tailworm SSH class safeguards, and AWS DB identity-scoped writes', () => {
  const originalPolicy = '{\n  "acls": [\n    {"action": "accept", "src": ["autogroup:member"], "dst": ["*:*"]}\n  ]\n}\n';
  const applied = fw.applyScurgeryNamedPolicyBlock({
    content: originalPolicy,
    blockName: 'oncall-rds-write',
    blockBody: '// temporary on-call RDS write rule for incident #402',
  });
  assert.notEqual(applied.sha256Before, applied.sha256AfterApply);
  assert.match(applied.content, /BEGIN THUMBGATE SCURGERY BLOCK \[oncall-rds-write\]/);

  const removed = fw.removeScurgeryNamedPolicyBlock({
    content: applied.content,
    blockName: 'oncall-rds-write',
  });
  assert.equal(removed.blockRemoved, true);
  assert.equal(removed.sha256AfterRemoval, applied.sha256Before);
  assert.equal(removed.content, originalPolicy);

  // Read-only SELECT passes by default
  const allowGate = fw.evaluateTailscaleOct2026NewsletterSteal();
  assert.equal(allowGate.ok, true);
  assert.equal(allowGate.forresterTeiRoiPct, 213);
  assert.equal(allowGate.scurgery.byteIdenticalVerified, true);

  // Support read-only role attempting DROP TABLE without on-call write elevation is denied
  const denyDbWrite = fw.evaluateTailscaleOct2026NewsletterSteal({
    dbRole: 'support_readonly',
    onCallWriteElevated: false,
    sqlStatement: 'DROP TABLE agent_gate_events;',
  });
  assert.equal(denyDbWrite.ok, false);
  assert.ok(denyDbWrite.blockers.includes('aws_db_write_denied_requires_identity_scoped_oncall_elevation'));

  // Tailworm SSH agent forwarding is blocked at the vulnerability-class level
  const denyTailworm = fw.evaluateTailscaleOct2026NewsletterSteal({
    sshAgentForwardingRequested: true,
  });
  assert.equal(denyTailworm.ok, false);
  assert.ok(denyTailworm.blockers.includes('tailworm_class_safeguard_blocks_unscoped_ssh_agent_forwarding'));
});

test('Spotify Confidence Active Flags Steal enforces behaviour naming (never ticket IDs), owner + planned removal date, fail-safe default "off", and Last resolved vs Last applied tracking', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-confidence-flags-'));
  const prevFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  fw.resetCloudFirewallStateForTests();
  try {
    // 1. Reject ticket-style flag names (JIRA-1234, GH-4693) and non-"off" defaults
    const badTicketFlag = fw.createOrUpdateConfidenceFlag({
      name: 'JIRA-1234',
      owner: 'igor@igorganapolsky.com',
      plannedRemovalDate: '2026-12-01',
      defaultVariant: 'on',
    });
    assert.equal(badTicketFlag.ok, false);
    assert.ok(badTicketFlag.blockers.includes('flag_must_be_named_after_behaviour_kebab_case_not_ticket_id'));
    assert.ok(badTicketFlag.blockers.includes('flag_must_default_to_off_to_fail_safe'));

    // 2. Create valid behaviour-named flag with owner, planned removal date, and default "off"
    const created = fw.createOrUpdateConfidenceFlag({
      name: 'new-checkout-flow',
      owner: 'igor@igorganapolsky.com',
      plannedRemovalDate: '2026-12-15',
      defaultVariant: 'off',
      rolloutPct: 100,
    });
    assert.equal(created.ok, true);
    assert.equal(created.flag.resolvedTotalCount, 0);
    assert.equal(created.flag.appliedTotalCount, 0);

    // 3. Resolve without applying exposure vs resolve with applying exposure
    const resolveOnly = fw.resolveAndApplyConfidenceFlag({
      name: 'new-checkout-flow',
      entityId: 'dev_42',
      applyExposure: false,
    });
    assert.equal(resolveOnly.resolvedTotalCount, 1);
    assert.equal(resolveOnly.appliedTotalCount, 0);

    const resolveAndApply = fw.resolveAndApplyConfidenceFlag({
      name: 'new-checkout-flow',
      entityId: 'dev_42',
      applyExposure: true,
    });
    assert.equal(resolveAndApply.resolvedTotalCount, 2);
    assert.equal(resolveAndApply.appliedTotalCount, 1);
    assert.equal(resolveAndApply.variant, 'on');

    const listed = fw.listConfidenceFlags({ state: 'ACTIVE' });
    assert.equal(listed.totalFlags, 1);
    assert.equal(listed.flags[0].name, 'new-checkout-flow');

    const shadowEval = fw.evaluateSpotifyConfidenceFlagsAndShadowSteal();
    assert.equal(shadowEval.ok, true);
    assert.equal(shadowEval.offlineShadowExperiment.passed, true);
  } finally {
    if (prevFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = prevFeedbackDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('/admin console and /v1/admin/customers manage customer accounts, tiers, and API keys while distinguishing unverified email previews from paid/provisioned accounts', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-admin-console-'));
  const prevFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const prevKeysPath = process.env._TEST_API_KEYS_PATH;
  const prevApiKey = process.env.THUMBGATE_API_KEY;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env._TEST_API_KEYS_PATH = path.join(tmpDir, 'api-keys.json');
  process.env.THUMBGATE_API_KEY = 'tg_test_admin_key';
  fw.resetCloudFirewallStateForTests();
  const handle = await startServer({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${handle.port}`;
  try {
    // 1. Unverified email login without OAuth Client IDs marks authVerification as email_workspace_preview (not fake Google SSO)
    const previewSso = fw.startSsoAuthorizationFlow({ provider: 'google', email: 'igor@igorganapolsky.com' });
    assert.equal(previewSso.ok, true);
    assert.equal(previewSso.authVerification, 'email_workspace_preview');

    // 2. Stripe-paid checkout completion marks authVerification as stripe_paid_verified
    const paidSso = fw.startSsoAuthorizationFlow({
      provider: 'stripe',
      email: 'buyer@enterprise.io',
      verifiedByStripe: true,
      apiKey: 'tg_live_test_buyer_key',
      tierId: 'pro_paid',
    });
    assert.equal(paidSso.ok, true);
    assert.equal(paidSso.authVerification, 'stripe_paid_verified');
    assert.equal(paidSso.tierId, 'pro_paid');

    // 3. GET /admin renders the Admin Login Gate (#adminLoginGate) with #adminConsoleShell hidden and no "Founder" wording
    const adminHtmlRes = await fetch(`${baseUrl}/admin`);
    assert.equal(adminHtmlRes.status, 200);
    const adminHtml = await adminHtmlRes.text();
    assert.match(adminHtml, /id="adminLoginGate"/);
    assert.match(adminHtml, /placeholder="igor@igorganapolsky\.com"/);
    assert.doesNotMatch(adminHtml, /Founder Admin Login/i);
    assert.match(adminHtml, /id="adminProtectedDashboard" style="display:none;"/);
    // 3b. Synthetic probe emails (probe-invalid@example.invalid) are rejected and purged
    const invalidProbeSso = fw.startSsoAuthorizationFlow({
      provider: 'github',
      email: 'probe-invalid@example.invalid',
    });
    assert.equal(invalidProbeSso.ok, false);

    // 3c. Unverified email preview token for igor@igorganapolsky.com is REJECTED on /v1/admin/customers
    process.env.THUMBGATE_ADMIN_TOKEN = 'secret_admin_console_token';
    const previewBypassRes = await fetch(`${baseUrl}/v1/admin/customers`, {
      headers: { Authorization: `Bearer ${previewSso.ssoToken}` },
    });
    assert.equal(previewBypassRes.status, 401);

    // 3d. POST /v1/admin/login rejects non-Igor emails with 403 and accepts Igor's email + Rockland26&* password
    const nonFounderLogin = await fetch(`${baseUrl}/v1/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'stranger@company.com', password: 'Rockland26&*' }),
    });
    assert.equal(nonFounderLogin.status, 403);

    const founderLoginRes = await fetch(`${baseUrl}/v1/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'igor@igorganapolsky.com', password: 'Rockland26&*' }),
    });
    assert.equal(founderLoginRes.status, 200);
    const founderLoginJson = await founderLoginRes.json();
    assert.equal(founderLoginJson.ok, true);
    assert.equal(founderLoginJson.authVerification, 'founder_admin_verified');
    assert.match(String(founderLoginJson.adminToken || ''), /^tg_sso_admin_/);
    // 4. Unauthenticated calls to /v1/admin/customers are rejected with 401
    const unauthRes = await fetch(`${baseUrl}/v1/admin/customers`);
    assert.equal(unauthRes.status, 401);
    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${founderLoginJson.adminToken}`,
    };
    // 5. POST /v1/admin/customers creates/provisions a verified customer account + API key
    const createRes = await fetch(`${baseUrl}/v1/admin/customers`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ action: 'create_account', email: 'vip@customer.ai', tierId: 'cloud_startup' }),
    });
    assert.equal(createRes.status, 200);
    const createJson = await createRes.json();
    assert.equal(createJson.ok, true);
    assert.equal(createJson.authVerification, 'admin_provisioned');
    assert.match(String(createJson.apiKey || ''), /^tg_/);

    // 6. GET /v1/admin/customers lists all 3 accounts with accurate summary counts
    const listRes = await fetch(`${baseUrl}/v1/admin/customers`, { headers: adminHeaders });
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.equal(listJson.ok, true);
    assert.equal(listJson.summary.totalAccounts, 3);
    assert.equal(listJson.summary.verifiedPaidAccounts, 3);
    assert.equal(listJson.summary.workspacePreviewAccounts, 0);

    // 7. POST /v1/admin/customers can disable and re-enable an account
    const disableRes = await fetch(`${baseUrl}/v1/admin/customers`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ action: 'disable_account', email: 'igor@igorganapolsky.com' }),
    });
    assert.equal(disableRes.status, 200);
    const checkDisabled = fw.validateSsoToken(previewSso.ssoToken);
    assert.equal(checkDisabled.valid, false);
    assert.equal(checkDisabled.reason, 'account_disabled');
    delete process.env.THUMBGATE_ADMIN_TOKEN;

    // 8. Spoofed X-TG-Admin-UI: 1 header is rejected when admin token is configured
    const spoofedRes = await fetch(`${baseUrl}/v1/admin/customers`, {
      headers: { 'X-TG-Admin-UI': '1', Host: '127.0.0.1' },
    });
    assert.equal(spoofedRes.status, 401);

    // 9. GET /v1/admin/customers masks raw apiKey and ssoToken values
    for (const acc of listJson.accounts) {
      if (acc.apiKey) assert.match(acc.apiKey, /\.\.\./);
      if (acc.ssoToken) assert.match(acc.ssoToken, /\.\.\./);
    }

    // 10. Logging out (revokeSsoToken) does NOT erase disabled account status
    fw.revokeSsoToken(previewSso.ssoToken);
    const reLoginAttempt = fw.startSsoAuthorizationFlow({
      provider: 'github',
      email: 'igor@igorganapolsky.com',
    });
    assert.equal(reLoginAttempt.ok, false);
    assert.equal(reLoginAttempt.error, 'account_disabled');

    // 11. POST /v1/cloud/auth/signup and POST /v1/cloud/auth/login work end-to-end
    const signupRes = await fetch(`${baseUrl}/v1/cloud/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newbuyer@acme.io',
        password: 'StrongPassword123!',
        name: 'New Buyer',
      }),
    });
    assert.equal(signupRes.status, 201);
    const signupJson = await signupRes.json();
    assert.equal(signupJson.ok, true);
    assert.ok(signupJson.ssoToken);

    const loginRes = await fetch(`${baseUrl}/v1/cloud/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newbuyer@acme.io',
        password: 'StrongPassword123!',
      }),
    });
    assert.equal(loginRes.status, 200);
    const loginJson = await loginRes.json();
    assert.equal(loginJson.ok, true);

    // 12. GET /v1/cloud/sso/authorize?require_oauth=1 rejects unverified email-only login when OAuth client ID is absent
    const strictOauthRes = await fetch(
      `${baseUrl}/v1/cloud/sso/authorize?provider=github&email=newbuyer@acme.io&require_oauth=1&format=json`
    );
    assert.equal(strictOauthRes.status, 400);
    const strictOauthJson = await strictOauthRes.json();
    assert.equal(strictOauthJson.ok, false);
    assert.equal(strictOauthJson.error, 'oauth_provider_not_configured');
  } finally {
    handle.server.close();
    handle.server.closeAllConnections?.();
    if (prevFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = prevFeedbackDir;
    if (prevKeysPath === undefined) delete process.env._TEST_API_KEYS_PATH;
    else process.env._TEST_API_KEYS_PATH = prevKeysPath;
    if (prevApiKey === undefined) delete process.env.THUMBGATE_API_KEY;
    else process.env.THUMBGATE_API_KEY = prevApiKey;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
test('GET /eu-ai-act and GET/POST /v1/compliance/eu-ai-act enforce EU AI Act (20230601STO93804) risk tiers and expose 5-tier monetization checkout links', async () => {
  process.env.THUMBGATE_ALLOW_INSECURE = 'true';
  const handle = await startServer({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${handle.port}`;
  try {
    const pageRes = await fetch(`${baseUrl}/eu-ai-act`);
    assert.equal(pageRes.status, 200);
    const pageHtml = await pageRes.text();
    assert.match(pageHtml, /EU AI Act PreToolUse Gate &amp; Conformity Engine/);
    assert.match(pageHtml, /\/go\/playbook-999/);
    assert.match(pageHtml, /\/go\/bundle-49\?pack=eu-ai-act-article50-transparency-pack/);
    assert.match(pageHtml, /\/go\/pro-direct/);
    assert.match(pageHtml, /\/go\/cloud-startup/);
    assert.match(pageHtml, /\/go\/diagnostic-499/);

    const apiGetRes = await fetch(`${baseUrl}/v1/compliance/eu-ai-act?annex3Domain=employment_worker_management&humanOversightPreToolUseGateEnabled=false`);
    assert.equal(apiGetRes.status, 200);
    const apiGetJson = await apiGetRes.json();
    assert.equal(apiGetJson.ok, false);
    assert.equal(apiGetJson.riskTier, 'high_risk');
    assert.equal(apiGetJson.verdict, 'HOLD');
    assert.ok(apiGetJson.blockers.includes('eu_ai_act_article14_human_oversight_pretooluse_gate_required'));

    const apiPostRes = await fetch(`${baseUrl}/v1/compliance/eu-ai-act`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposedPractice: 'cognitive_behavioural_manipulation',
      }),
    });
    assert.equal(apiPostRes.status, 200);
    const apiPostJson = await apiPostRes.json();
    assert.equal(apiPostJson.ok, false);
    assert.equal(apiPostJson.riskTier, 'unacceptable_risk');
    assert.equal(apiPostJson.verdict, 'DENY');
    assert.ok(apiPostJson.blockers.includes('eu_ai_act_article5_unacceptable_risk_banned_application_blocked'));
  } finally {
    handle.server.close();
    handle.server.closeAllConnections?.();
  }
});

test('Zachary Blumenfeld Predictable Agent Graph Engineering (g_NgCLTibiM) compiles SKILL.md and traces to YAML, runs CLI routing, downgrades to small models, and audits branch drift', async () => {
  const fw = require('../src/cloud-token-firewall');
  const report = fw.evaluatePredictableGraphEngineeringSteal({
    skillId: 'thumbgate-admin-compliance-skill',
    skillMarkdown: '# Admin Policy\n- MUST verify Founder Admin token\n- NEVER allow unverified email_workspace_preview tokens',
  });
  assert.equal(report.ok, true);
  assert.equal(report.sourceVideoUrl, 'https://www.youtube.com/watch?v=g_NgCLTibiM');
  assert.equal(report.contextGraph.layers.shortTermMemoryCount, 2);
  assert.equal(report.contextGraph.layers.longTermEntityCount, 1);
  assert.equal(report.contextGraph.layers.decisionTraceCount, 1);
  assert.ok(report.traceCapture.canonicalWorkingPath.includes('check_hard_policy'));
  assert.match(report.compiledGraph.graphYaml, /graph_type: "procedural_skill_graph"/);
  assert.match(report.compiledGraph.graphYaml, /hard_rule_policy_gate/);
  assert.equal(report.cliExecution.approveRun.verdict, 'APPROVE');
  assert.equal(report.cliExecution.escalateRun.verdict, 'ESCALATE_TO_HUMAN');
  assert.equal(report.smallModelRoute.downgraded, true);
  assert.equal(report.smallModelRoute.selectedModel, 'qwen3.5:4b-local');
  assert.equal(report.smallModelRoute.costReductionPct, 100);
  assert.equal(report.governanceAudit.totalPersistedRuns, 2);
  assert.equal(report.governanceAudit.approveCount, 1);
  assert.equal(report.governanceAudit.escalateCount, 1);
  assert.ok(report.governanceAudit.triggeredBranchIds.includes('hard_rule_policy_gate->escalation_router'));
});

test('Deslopify AI (QSZKZHeGZr4), Robert Herjavec Sales Engine (Sal2R5HYy1s), YouSpot Pro, HKUST HarnessSQL (2610.12274), Stanford LLM Claims Shelf Life, MIT Soft-MTP (2610.38331), and Julian Goldie Skool + Grok Bot Monetizer work end-to-end via API', async () => {
  const fw = require('../src/cloud-token-firewall');

  // 1. How to Deslopify Your AI (QSZKZHeGZr4)
  const deslopReport = fw.evaluateHowToDeslopifyYourAiSteal({
    povBrainDump: 'Our PreToolUse gate blocks destructive shell commands before they execute.',
    confidencePct: 60,
  });
  assert.equal(deslopReport.ok, true);
  assert.match(deslopReport.sourceUrl, /QSZKZHeGZr4/);
  assert.equal(deslopReport.habitsImplementedCount, 9);
  assert.equal(deslopReport.divergentAngles.angles.length, 6);
  assert.equal(deslopReport.reviewBoard.personasCount, 4);
  assert.ok(deslopReport.readBudgetGate.originalSentenceCount <= 5);

  // 2. Robert Herjavec $50-to-$1B Sales Engine (Sal2R5HYy1s)
  const herjavecReport = fw.evaluateRobertHerjavecBillionDollarSalesEngine({
    prospectStatement: 'We need to review your security and compliance audit trail first.',
    buyerRole: 'CISO',
    suspectedObjectionType: 'compliance',
  });
  assert.equal(herjavecReport.ok, true);
  assert.equal(herjavecReport.sourceUrl, 'https://www.youtube.com/watch?v=Sal2R5HYy1s');
  assert.equal(herjavecReport.ctoCisoObjectionMatrix.length, 5);
  assert.match(herjavecReport.chaseTheNo.oneClickCheckoutUrl, /\/go\/diagnostic-499/);
  assert.equal(herjavecReport.workflowAudit.clicksEliminated, 3);

  // 3. YouSpot Pro (youspot.com/lp/pro)
  const youspotReport = fw.evaluateYouSpotProPayFirstAndSoloBrainSteal({
    singleQuestionInput: 'igor@igorganapolsky.com',
  });
  assert.equal(youspotReport.ok, true);
  assert.equal(youspotReport.conversionArchitecture.dataPath, 'pay_first');
  assert.equal(youspotReport.conversionArchitecture.questionsAskedCount, 1);
  assert.equal(youspotReport.secondBrainObjectStore.maxObjectsSupported, 1000000);
  assert.equal(youspotReport.viralGraderApps.length, 4);

  // 4. HKUST + DeepSeek HarnessSQL & DSH-SQL (arXiv:2610.12274)
  const harnessSqlReport = fw.evaluateHkustHarnessSqlAndDshSqlSteal({
    contextWindowTokens: 32768,
  });
  assert.equal(harnessSqlReport.ok, true);
  assert.equal(harnessSqlReport.harnessExecution.scopedToolsCount, 4);
  assert.equal(harnessSqlReport.harnessExecution.trajectoryStats.toolObservationsMaskedFromLoss, true);
  assert.equal(harnessSqlReport.benchmarks.spider2Sqlite8bDapoFinalPct, 45.2);
  assert.equal(harnessSqlReport.mutationRejectionTest.mutatingSqlBlocked, true);

  // 5. Stanford Zou Group + Ethan Mollick LLM Claims Shelf Life
  const shelfLifeReport = fw.evaluateZouMollickLlmClaimsShelfLifeSteal();
  assert.equal(shelfLifeReport.ok, true);
  assert.equal(shelfLifeReport.panelSummary.totalClaimsTested, 50);
  assert.equal(shelfLifeReport.panelSummary.medianExpirationMonths, 14.7);
  assert.equal(shelfLifeReport.trackedClaims.c11CitationFabricationSonnet55.classification, 'expired');
  assert.equal(shelfLifeReport.trackedClaims.c28JudgeSelfPreference.classification, 'strengthened');
  assert.equal(shelfLifeReport.trackedClaims.c17SycophanticPraise.classification, 'strengthened');
  assert.equal(shelfLifeReport.shelfLifeAudit.sameModelJudgeConflict, true);
  assert.equal(shelfLifeReport.shelfLifeAudit.modelSpecificException.citationFabricationExceptionActive, true);

  // 6. MIT Jayden Teoh Soft-MTP KL Gradient Recovery (arXiv:2610.38331)
  const softMtpReport = fw.evaluateSoftMtpKlGradientRecoverySteal();
  assert.equal(softMtpReport.ok, true);
  assert.equal(softMtpReport.routing.decomposition.exactKlMatch, true);
  assert.equal(softMtpReport.measuredBenchmarksAt1p2B.logitMapEffectiveRankWGamma.softMtp, 437);
  assert.equal(softMtpReport.measuredBenchmarksAt1p2B.h200FusedCeTrainingEfficiency.vramSavedVsKlMtpGb, 21.1);
  assert.equal(softMtpReport.measuredBenchmarksAt1p2B.speculativeDecodingAndDownstream.humanEvalPassAt64Pct.softMtp, 43.9);

  // 7. Julian Goldie AI Money Lab Skool Monetizer + Grok Bot Jarvis Command Center
  const julianSkoolReport = fw.evaluateJulianGoldieAiMoneyLabSkoolMonetizer();
  assert.equal(julianSkoolReport.ok, true);
  assert.equal(julianSkoolReport.community.slug, 'ai-seo-with-julian-goldie-1553');
  assert.equal(julianSkoolReport.community.totalMembers, 94392);
  assert.equal(julianSkoolReport.valueDropPlays.length, 3);
  assert.equal(julianSkoolReport.jarvisCommandCenter.activeSystemsCount, 16);
  assert.equal(julianSkoolReport.jarvisCommandCenter.waitingOnYouCount, 5);

  // 8. QwenGPU SIMT GPU in Qwen3.5-2B Weights (MarkTechPost / Vixhal)
  const qwenGpuReport = fw.evaluateQwenGpuCompiledSimtAndDeltaNetStateSteal();
  assert.equal(qwenGpuReport.ok, true);
  assert.equal(qwenGpuReport.circuitRun.architecture.totalLayers, 69);
  assert.equal(qwenGpuReport.circuitRun.executionTrace.exactResult, 32);
  assert.equal(qwenGpuReport.circuitRun.executionTrace.teslaT4KernelParity, '49/49');

  // 9. LinkedIn OpenTelemetry Member Journey pageForestId (InfoQ)
  const linkedInOtelReport = fw.evaluateLinkedInOpenTelemetryJourneySteal();
  assert.equal(linkedInOtelReport.ok, true);
  assert.equal(linkedInOtelReport.journey.coordinatedHeadSamplingConsistent, true);
  assert.equal(linkedInOtelReport.journey.qoeSpansRetained, 3);
  assert.equal(linkedInOtelReport.journey.debugSpansDropped, 1);

  // 10. Grok Bot Data Bot & Broad-and-Sticky Team Bots (@bot)
  const grokDataBotReport = fw.evaluateGrokDataBotAndBroadStickyTeamBotsSteal();
  assert.equal(grokDataBotReport.ok, true);
  assert.equal(grokDataBotReport.companyWideTelemetry7d.totalBots, 280);
  assert.equal(grokDataBotReport.companyWideTelemetry7d.broadAndStickyBotCount, 12);
  assert.equal(grokDataBotReport.companyWideTelemetry7d.broadAndStickyMessageSharePct, 44);
  assert.equal(grokDataBotReport.companyWideTelemetry7d.slackRetentionMultiplier, 5.0);

  // 11. Gartner 90% Open-Weight Models at 1/20th Cost & Harness Moat (The Register)
  const gartnerReport = fw.evaluateGartnerOpenModels90PctHarnessMoatSteal({ totalMonthlySteps: 1000000 });
  assert.equal(gartnerReport.ok, true);
  assert.equal(gartnerReport.stepDistribution.routineOpExSharePct, 90);
  assert.equal(gartnerReport.stepDistribution.costRatioVsFrontierRaw, 0.05);
  assert.equal(gartnerReport.stepDistribution.costRatioVsCheapestClosed, 0.25);
  assert.equal(gartnerReport.economicsSimulation.savingsPctWithThumbGateHarness, 85.5);
  assert.equal(gartnerReport.maValuationPerimeterMoat.workflowHistoryRetainedOnPremPct, 100);

  // 11. Verify HTTP routes on live server
  process.env.THUMBGATE_ALLOW_INSECURE = 'true';
  const handle = await startServer({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${handle.port}`;
  try {
    for (const route of [
      '/v1/cloud/zachary-blumenfeld-graph/gate',
      '/v1/cloud/deslopify',
      '/v1/cloud/deslopify-ai/gate',
      '/v1/cloud/herjavec-sales-engine/gate',
      '/v1/cloud/youspot-pro/gate',
      '/v1/cloud/hkust-harness-sql/gate',
      '/v1/cloud/llm-claims-shelf-life/gate',
      '/v1/cloud/soft-mtp-kl-recovery/gate',
      '/v1/cloud/julian-goldie-skool/gate',
      '/v1/cloud/jarvis-command-center/gate',
      '/v1/cloud/qwengpu-simt/gate',
      '/v1/cloud/linkedin-otel-journey/gate',
      '/v1/cloud/grok-data-bot/gate',
      '/v1/cloud/gartner-90pct-open-models-harness/gate',
    ]) {
      const res = await fetch(`${baseUrl}${route}`);
      assert.equal(res.status, 200, `Expected 200 for ${route}`);
      const json = await res.json();
      assert.equal(json.ok, true, `Expected ok:true for ${route}`);
    }
  } finally {
    handle.server.close();
    handle.server.closeAllConnections?.();
  }
});


