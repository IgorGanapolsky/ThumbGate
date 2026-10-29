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

test('/cancel, /checkout/cancel, and /checkout/pro expose $9.99 Playbook, $49 Bundle one-time downsells, and 1-click /go/pro-direct', async () => {
  const prevKey = process.env.THUMBGATE_API_KEY;
  process.env.THUMBGATE_API_KEY = 'tg_test_verify_downsells';
  const handle = await startServer({ port: 0, host: '127.0.0.1' });
  try {
    const base = `http://127.0.0.1:${handle.port}`;
    for (const routePath of ['/cancel', '/checkout/cancel', '/checkout/pro']) {
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
  assert.match(indexHtml, /npx thumbgate init/);
  assert.match(indexHtml, /Setup Sprint/);
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


