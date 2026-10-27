'use strict'; // ThumbGate Cloud & Firewall Suite

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const {
  CURATED_THREAT_PACKS,
  CLOUD_SAAS_TIERS,
  compactTokenPayload,
  interceptAgentRequest,
  calculateCloudSaasEconomics,
  evaluateEntireCiTrailAndProjectSync,
  buildRlhfDpoTrainingPairFromInterception,
  buildFourPillarPositioningMatrix,
  syncTeamPolicyAndThreatPacks,
  buildEdgeTelemetryRecord,
  batchAndSignEdgeLogs,
  ingestEnterpriseCloudSinkBatch,
  auditAwsCostAnomalyZeroSpendGuard,
  evaluateAgntConMcpCon2026ProductionSecurityGate,
  evaluateSkillUpDeclarativeEvalLoop,
  convertSkillObservationToCandidateCase,
  evaluateRachelWoodsCraftAndPlaybookMiddleManagerGate,
  buildTokenBurnCircuitBreakerPlaybook,
  getSkillsShWellKnownSkillMarkdown,
  buildSkillsShWellKnownDiscoveryIndex,
  evaluateHerdrOmpPoolsideGitButlerSwarmGate,
  evaluateBrowserOsNeoProductivityGate,
  evaluateRadwareAgenticApiRiskFirewall,
  resetCloudFirewallStateForTests,
} = require('../src/cloud-token-firewall');
const { PPLPipeline } = require('../src/ppl-alert-pipeline');
const { handler: lambdaHandler } = require('../src/aws-lambda-handler');
const { repairProjectMcpConfigs } = require('../scripts/codex-self-heal');
const { startServer, __test__: serverTest } = require('../src/api/server');

test('compactTokenPayload strips duplicate system prompts, repeated turns, and bloated tool logs (>=42% reduction)', () => {
  const repeatedSys = 'You are an autonomous coding agent running in a strict verification loop. Follow all repository rules and never skip tests.';
  const bloatedLog = 'ERROR: Connection refused at 127.0.0.1:5432\n'.repeat(80);
  const messages = [
    { role: 'system', content: repeatedSys },
    { role: 'system', content: repeatedSys },
    { role: 'system', content: repeatedSys },
    { role: 'user', content: 'Run the database migration and fix errors.' },
    { role: 'assistant', content: bloatedLog },
    { role: 'assistant', content: bloatedLog },
    { role: 'user', content: 'Still failing, check port 5432.' },
  ];

  const result = compactTokenPayload({ messages, toolOutput: bloatedLog, maxToolOutputChars: 400 });
  assert.ok(result.originalTokens > result.optimizedTokens);
  assert.ok(result.reductionPct >= 42, `Expected >=42% reduction, got ${result.reductionPct}%`);
  assert.ok(result.duplicateTurnsRemoved >= 3);
  assert.ok(result.truncatedBlocks >= 2);
  assert.equal(result.compactedMessages.filter((m) => m.role === 'system').length, 1);
});

test('interceptAgentRequest kills duplicate tool-call loops on repeat #3 and dispatches startup webhook', async () => {
  resetCloudFirewallStateForTests();

  let webhookPayload = null;
  const webhookServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      webhookPayload = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => webhookServer.listen(0, '127.0.0.1', resolve));
  const webhookPort = webhookServer.address().port;
  const webhookUrl = `http://127.0.0.1:${webhookPort}/webhook`;

  try {
    const reqPayload = {
      tenantKey: 'tg_startup_test_1',
      tierId: 'cloud_startup',
      sessionId: 'sess_runaway_99',
      agentId: 'coder_loop',
      toolCall: { name: 'bash', arguments: JSON.stringify({ command: 'pytest tests/flaky.py' }) },
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Fix flaky test' },
      ],
      maxLoopRepeats: 3,
      webhookUrl,
    };

    const r1 = await interceptAgentRequest(reqPayload);
    assert.equal(r1.decision, 'ALLOW');
    assert.equal(r1.blocked, false);
    assert.equal(r1.repeatCount, 1);

    const r2 = await interceptAgentRequest(reqPayload);
    assert.equal(r2.decision, 'ALLOW');
    assert.equal(r2.blocked, false);
    assert.equal(r2.repeatCount, 2);

    const r3 = await interceptAgentRequest(reqPayload);
    assert.equal(r3.decision, 'KILL_LOOP');
    assert.equal(r3.blocked, true);
    assert.equal(r3.loopDetected, true);
    assert.equal(r3.repeatCount, 3);
    assert.equal(r3.webhook.sent, true);
    assert.ok(webhookPayload);
    assert.equal(webhookPayload.event, 'thumbgate.loop.killed');
    assert.equal(webhookPayload.sessionId, 'sess_runaway_99');
  } finally {
    await new Promise((resolve) => webhookServer.close(resolve));
  }
});

test('interceptAgentRequest enforces 1M monthly token cap on $49/mo Cloud Indie tier', async () => {
  resetCloudFirewallStateForTests();
  const { getOrCreateTenantUsage } = require('../src/cloud-token-firewall');
  const usage = getOrCreateTenantUsage('tg_indie_capped', 'cloud_indie');
  usage.tokensOptimizedMonthly = CLOUD_SAAS_TIERS.cloud_indie.tokensOptimizedCapMonthly;

  const res = await interceptAgentRequest({
    tenantKey: 'tg_indie_capped',
    tierId: 'cloud_indie',
    sessionId: 'sess_cap',
    messages: [{ role: 'user', content: 'hello' }],
  });
  assert.equal(res.blocked, true);
  assert.equal(res.decision, 'QUOTA_EXCEEDED');
  assert.match(res.reason, /1,000,000 tokens/);
});

test('calculateCloudSaasEconomics, AWS Cost Anomaly Guard (aws.pdf), AGNTCon/MCPCon 2026 Gate, and Alibaba skill-up Eval Loop work end-to-end', () => {
  const serverless = calculateCloudSaasEconomics({
    indieSubscribers: 0,
    startupSubscribers: 20,
    architecture: 'serverless_lambda_dynamodb_sqs',
    developerMonthlyApiBillUsd: 500,
    compactionReductionPct: 42,
  });
  assert.equal(serverless.revenue.startupMrrUsd, 3980);
  assert.ok(serverless.profitability.netMarginPct >= 95);

  const awsGuardOk = auditAwsCostAnomalyZeroSpendGuard({
    accountId: '035074951001',
    anomalyThresholdUsd: 0.01,
    subscriptionChannel: 'EMAIL',
    frequency: 'DAILY',
  });
  assert.equal(awsGuardOk.ok, true);
  assert.equal(awsGuardOk.monthlyCostForMonitoringUsd, 0);

  const awsGuardBad = auditAwsCostAnomalyZeroSpendGuard({
    anomalyThresholdUsd: 100,
    subscriptionChannel: 'SNS',
    zeroSpendBudgetActive: false,
  });
  assert.equal(awsGuardBad.ok, false);
  assert.equal(awsGuardBad.blockers.length, 3);

  const agntConOk = evaluateAgntConMcpCon2026ProductionSecurityGate();
  assert.equal(agntConOk.ok, true);
  assert.ok(agntConOk.aaifProjectsSupported.includes('OpenSandbox'));
  assert.ok(agntConOk.aaifProjectsSupported.includes('Agent Skills'));
  assert.ok(agntConOk.tokenomics.costPerVerifiedOutcomeUsd > 0);

  const agntConBad = evaluateAgntConMcpCon2026ProductionSecurityGate({
    toolSchemas: [{ name: 'bloated', sizeBytes: 5000, annotations: {} }],
    serverInstructions: 'x'.repeat(1200),
    agentIdentity: { agentId: '', canReadDirectMessages: true },
  });
  assert.equal(agntConBad.ok, false);
  assert.equal(agntConBad.blockers.length, 4);

  const skillUp = evaluateSkillUpDeclarativeEvalLoop({
    skillName: 'thumbgate-pretool-firewall',
    runtime: 'opensandbox',
    judgeType: 'rule',
    withSkillPassRate: 0.96,
    withoutSkillPassRate: 0.58,
  });
  assert.equal(skillUp.ok, true);
  assert.equal(skillUp.passRateDelta, 0.38);
  assert.match(skillUp.evalYaml, /opensandbox/);

  assert.equal(skillUp.evaluationJson.aggregation.strategy, 'all_required');
  assert.equal(skillUp.evaluationJson.aggregation.status, 'PASS');
  assert.equal(skillUp.evolutionAction, 'promote_candidate');

  const skillUpExpectShortCircuit = evaluateSkillUpDeclarativeEvalLoop({
    expectGatePassed: false,
    judges: [{ id: 'j1', type: 'script', status: 'PASS' }, { id: 'j2', type: 'agent_judge', status: 'PASS' }],
  });
  assert.equal(skillUpExpectShortCircuit.ok, false);
  assert.equal(skillUpExpectShortCircuit.evaluationJson.aggregation.status, 'FAIL');
  assert.equal(skillUpExpectShortCircuit.evaluationJson.judge_results[0].status, 'SKIP');
  assert.equal(skillUpExpectShortCircuit.gradingJson.pass_rate, 0);
  assert.equal(skillUpExpectShortCircuit.evolutionAction, 'keep_original');

  const skillUpJudgeFail = evaluateSkillUpDeclarativeEvalLoop({
    expectGatePassed: true,
    judges: [{ id: 'j1', type: 'script', status: 'FAIL' }, { id: 'j2', type: 'agent_judge', status: 'PASS' }],
  });
  assert.equal(skillUpJudgeFail.evaluationJson.aggregation.status, 'FAIL');
  assert.equal(skillUpJudgeFail.gradingJson.pass_rate, 0.5);

  const skillUpJudgeError = evaluateSkillUpDeclarativeEvalLoop({
    expectGatePassed: true,
    judges: [{ id: 'j1', type: 'script', status: 'ERROR' }],
  });
  assert.equal(skillUpJudgeError.evaluationJson.aggregation.status, 'ERROR');

  const obsInferred = convertSkillObservationToCandidateCase({ attribution: 'inferred' });
  assert.equal(obsInferred.ok, false);
  assert.equal(obsInferred.statusCode, 400);

  const obsPending = convertSkillObservationToCandidateCase({ attribution: 'explicit', approvedByMaintainer: false });
  assert.equal(obsPending.statusCode, 202);
  assert.equal(obsPending.state, 'candidate_pending_approval');

  const obsRollback = convertSkillObservationToCandidateCase({ attribution: 'instrumented', approvedByMaintainer: true, suiteValidationPassed: false });
  assert.equal(obsRollback.statusCode, 422);

  const obsPromoted = convertSkillObservationToCandidateCase({
    observationId: 'obs_sec_1',
    attribution: 'explicit',
    prompt: 'Block token leak ghp_1234567890abcdefghijklmnopqrstuvwx',
    approvedByMaintainer: true,
    suiteValidationPassed: true,
  });
  assert.equal(obsPromoted.statusCode, 201);
  assert.ok(!obsPromoted.caseYaml.includes('ghp_1234567890'));
  const playbook = buildTokenBurnCircuitBreakerPlaybook();
  assert.equal(playbook.ok, true);
  assert.match(playbook.templates.redditDiscordReply, /42%/);
});

test('Entire CI Trail engine, 4-Pillar Positioning, RLHF DPO Pair, and 5-Layer Cloud Sink work end-to-end', () => {
  const trail = evaluateEntireCiTrailAndProjectSync({
    trailId: 'trail_101',
    branch: 'entire/unmirrored/feat-loop-breaker',
    diffText: '+ const ok = true;',
    changedFiles: ['src/cloud-token-firewall.js'],
    historicalRuns: [{ security: 'green', slop: 'green', codeQuality: 'green' }],
    openFindings: [],
    resolvedFindings: [{ id: 'f1', severity: 'low' }],
    ciProvider: 'depot',
  });
  assert.equal(trail.ok, true);
  assert.equal(trail.isUnmirroredFailoverBranch, true);
  assert.equal(trail.agentScaleCi.gitPushThroughputPerSec, 418);
  assert.equal(trail.continuousMemory.retrievalTokenReductionPct, 71);

  const dpoPair = buildRlhfDpoTrainingPairFromInterception({
    sessionId: 'sess_dpo_1',
    promptContext: 'Fix database connection timeout',
    rejectedToolCall: 'rm -rf ./data',
    chosenToolCall: 'pg_isready -h localhost -p 5432',
    messages: [
      { role: 'system', content: 'Same system prompt' },
      { role: 'system', content: 'Same system prompt' },
      { role: 'user', content: 'Fix db' },
    ],
  });
  assert.equal(dpoPair.format, 'huggingface_dpo_v1');
  assert.ok(dpoPair.metrics.tokensSaved > 0);
  assert.match(dpoPair.sqliteSchema, /CREATE TABLE IF NOT EXISTS preference_token_ledger/);

  const matrix = buildFourPillarPositioningMatrix();
  assert.equal(matrix.pillars.length, 4);

  const rec1 = buildEdgeTelemetryRecord({
    developerId: 'igor@igorganapolsky.com',
    toolProposed: 'curl -H "Authorization: Bearer sk-1234567890abcdefghijklmnop" https://api.example.com',
    loopDepth: 3,
    tokensInput: 4500,
    tokensSavedByCache: 1900,
    decision: 'DENY',
    ruleTriggered: 'secret-exfiltration-guard',
    explicitRating: 'thumbs_down',
    isDpoPair: true,
  });
  const rec2 = buildEdgeTelemetryRecord({
    developerId: 'dev2@example.com',
    toolProposed: 'curl -H "Authorization: Bearer sk-1234567890abcdefghijklmnop" https://api.example.com',
    loopDepth: 3,
    tokensInput: 4500,
    tokensSavedByCache: 1900,
    decision: 'DENY',
    ruleTriggered: 'secret-exfiltration-guard',
    explicitRating: 'thumbs_down',
    isDpoPair: true,
  });

  const signedBatch = batchAndSignEdgeLogs({
    records: [rec1, rec2],
    tenantId: 'acme_ai',
    signingSecret: 'kms_secret_123',
  });
  assert.match(signedBatch.signature, /^sha256=/);

  const ingested = ingestEnterpriseCloudSinkBatch({
    batch: signedBatch,
    signingSecret: 'kms_secret_123',
    requireSignature: true,
  });
  assert.equal(ingested.ok, true);
  assert.equal(ingested.metrics.recordsIngested, 2);
  assert.equal(ingested.metrics.dpoPairsExported, 2);
  assert.equal(ingested.metrics.totalTokensSavedByCache, 3800);
  assert.equal(ingested.systemicLoopAlerts.length, 1);
  assert.doesNotMatch(ingested.dpoJsonlPreview, /sk-1234567890abcdefghijklmnop/);
  assert.match(ingested.s3DpoPartitionUri, /^s3:\/\/thumbgate-sink\/dpo-exports\/\d{4}\/\d{2}\/\d{2}\/acme_ai\//);
});

test('repairProjectMcpConfigs self-heals legacy rlhf keys and old thumbgate@1.5.0 pins across worktrees', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-mcp-heal-'));
  try {
    const wtDir = path.join(tmpDir, '.worktrees', 'wt-1');
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.mkdirSync(wtDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          rlhf: { command: 'npx', args: ['-y', 'thumbgate@1.5.0', 'serve'] },
        },
      }),
    );
    fs.writeFileSync(
      path.join(wtDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          rlhf: { command: 'npx', args: ['-y', 'thumbgate@1.5.0', 'serve'] },
          thumbgate: { command: 'npx', args: ['-y', 'thumbgate@1.39.0', 'serve'] },
        },
      }),
    );
    fs.writeFileSync(
      path.join(tmpDir, '.claude', 'settings.local.json'),
      JSON.stringify({ enabledMcpjsonServers: ['rlhf'], mcpServers: { rlhf: { command: 'npx' } } }),
    );
    fs.writeFileSync(
      path.join(tmpDir, '.claude', 'settings.json'),
      JSON.stringify({ enabledMcpjsonServers: ['rlhf', 'thumbgate'] }),
    );

    const dryRes = repairProjectMcpConfigs({ projectDir: tmpDir, dryRun: true });
    assert.equal(dryRes.changed, true);

    const res = repairProjectMcpConfigs({ projectDir: tmpDir });
    assert.equal(res.changed, true);
    const healedMcp = JSON.parse(fs.readFileSync(path.join(tmpDir, '.mcp.json'), 'utf8'));
    assert.equal(healedMcp.mcpServers.rlhf, undefined);
    assert.equal(healedMcp.mcpServers.thumbgate.args[1], 'thumbgate@latest');
    const healedLocal = JSON.parse(fs.readFileSync(path.join(tmpDir, '.claude', 'settings.local.json'), 'utf8'));
    assert.deepEqual(healedLocal.enabledMcpjsonServers, ['thumbgate']);
    const healedSettings = JSON.parse(fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf8'));
    assert.deepEqual(healedSettings.enabledMcpjsonServers, ['thumbgate']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('AWS Lambda handler routes all GET, POST, and OPTIONS requests cleanly', async () => {
  resetCloudFirewallStateForTests();

  const optRes = await lambdaHandler({ httpMethod: 'OPTIONS', rawPath: '/v1/cloud/intercept' });
  assert.equal(optRes.statusCode, 204);

  for (const p of ['/cloud', '/.well-known/agent-skills/index.json', '/.well-known/skills/index.json', '/.well-known/agent-skills/thumbgate/SKILL.md', '/Formula/thumbgate.rb', '/install/homebrew.rb', '/install.sh', '/install/macos.command', '/install/linux.sh', '/install.ps1', '/install/windows.bat', '/v1/cloud/portal/session', '/v1/cloud/threat-packs', '/v1/cloud/policy-sync', '/v1/cloud/positioning', '/v1/cloud/roi-calculator', '/v1/cloud/calculator', '/v1/cloud/integration-guide.md', '/unknown-meta']) {
    const r = await lambdaHandler({ httpMethod: 'GET', rawPath: p, headers: { Authorization: 'Bearer tg_live_1' } });
    assert.equal(r.statusCode, 200, `Expected 200 on GET ${p}`);
  }

  const ssoLambda = await lambdaHandler({ httpMethod: 'GET', rawPath: '/v1/cloud/sso/authorize', queryStringParameters: { provider: 'google', cli_port: '45123' } });
  assert.equal(ssoLambda.statusCode, 302);
  assert.match(ssoLambda.headers.Location, /127\.0\.0\.1:45123/);

  const badJson = await lambdaHandler({ httpMethod: 'POST', rawPath: '/v1/cloud/intercept', body: '{bad' });
  assert.equal(badJson.statusCode, 400);

  for (const [p, payload] of [
    ['/v1/cloud/portal/demo-intercept', { email: 'demo@thumbgate.ai' }],
    ['/v1/cloud/portal/subscription', { action: 'switch_tier', targetTierId: 'cloud_startup' }],
    ['/v1/cloud/portal/feedback', { title: 'Lambda feedback', description: 'works' }],
    ['/v1/cloud/bdm/register-deal', { bdmEmail: 'bdm@example.com', prospectDomain: 'client.io', collectedCashUsd: 500 }],
    ['/v1/cloud/ci-trail-eval', { trailId: 't1' }],
    ['/v1/cloud/sink/ingest', { tenant_id: 't1', records: [] }],
    ['/v1/cloud/dpo-sync', { sessionId: 's1' }],
    ['/v1/cloud/policy-sync', { orgId: 'org_1', enabledPackIds: ['aws-production-safeguards'], customRules: [{ id: 'r1', pattern: 'rm -rf' }] }],
    ['/v1/cloud/playbook/craft', { playbookName: 'nitpicking-playbook', triggerWord: 'nitpicking' }],
    ['/v1/cloud/skill-up/eval', { skillName: 'thumbgate-pretool-firewall', runtime: 'opensandbox', judgeType: 'rule_based' }],
    ['/v1/cloud/skill-up/observation', { observationId: 'obs_1', attribution: 'explicit', approvedByMaintainer: true }],
    ['/v1/cloud/swarm/herdr-gitbutler', { workerCount: 4, requiresSharedLiveDevServerOrRuntime: true }],
    ['/v1/cloud/browseros-neo/gate', { cdpEndpoint: 'http://127.0.0.1:9111', snapshotFormat: 'accessibility_tree_ref_ids' }],
    ['/v1/cloud/radware-agent-risk/gate', { securesLocalDeveloperAgents: true, securesApiGatewayPerimeter: true }],
    ['/v1/cloud/intercept', { sessionId: 's1', messages: [{ role: 'user', content: 'hi' }] }],
  ]) {
    const r = await lambdaHandler({
      httpMethod: 'POST',
      rawPath: p,
      headers: { Authorization: 'Bearer tg_startup_1' },
      body: JSON.stringify(payload),
    });
    assert.ok(r.statusCode === 200 || r.statusCode === 201, `Expected 200/201 on POST ${p}, got ${r.statusCode}`);
  }
});

test('syncTeamPolicyAndThreatPacks and evaluateRachelWoodsCraftAndPlaybookMiddleManagerGate enforce B2B governance and CRAFT rules', () => {
  assert.equal(CURATED_THREAT_PACKS.length, 3);
  const syncRes = syncTeamPolicyAndThreatPacks({ orgId: 'org_test' });
  assert.equal(syncRes.ok, true);
  assert.equal(syncRes.totalRulesSynced, 59);

  const craftGood = evaluateRachelWoodsCraftAndPlaybookMiddleManagerGate();
  assert.equal(craftGood.ok, true);

  const craftBad = evaluateRachelWoodsCraftAndPlaybookMiddleManagerGate({
    triggerWord: 'feedback',
    outline: { trigger: '', inputs: '', steps: [], output: '' },
    storedInGitRepoNotProprietaryUi: false,
    lockInSpontaneousWinsToPlaybook: false,
    hasLocalBackupBeforeSelfEdit: false,
    selfEditDiffLines: 50,
  });
  assert.equal(craftBad.ok, false);
  assert.equal(craftBad.blockers.length, 5);
  assert.equal(craftBad.selfEditingGuardrail.requiresHumanApprovalForMajorRewrite, true);

  const discovery = buildSkillsShWellKnownDiscoveryIndex();
  assert.equal(discovery.$schema, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json');
  assert.equal(discovery.skills.length, 5);
  assert.match(getSkillsShWellKnownSkillMarkdown('thumbgate'), /name: thumbgate/);
  assert.equal(getSkillsShWellKnownSkillMarkdown('nonexistent'), null);

  const swarmShared = evaluateHerdrOmpPoolsideGitButlerSwarmGate({
    workerCount: 4,
    requiresSharedLiveDevServerOrRuntime: true,
  });
  assert.equal(swarmShared.ok, true);
  assert.equal(swarmShared.executionRouting.routingMode, 'gitbutler_shared_workspace');

  const swarmIsolated = evaluateHerdrOmpPoolsideGitButlerSwarmGate({
    workerCount: 6,
    requiresSharedLiveDevServerOrRuntime: false,
    remoteHost: 'vps.thumbgate.ai',
  });
  assert.equal(swarmIsolated.ok, true);
  assert.equal(swarmIsolated.executionRouting.routingMode, 'herdr_worktree_isolation');
  assert.match(swarmIsolated.workers.remoteAttachCommand, /herdr --remote vps\.thumbgate\.ai --session agents/);

  const swarmBad = evaluateHerdrOmpPoolsideGitButlerSwarmGate({
    captainWritesCode: true,
    decisionsLedgerPath: 'wrong.md',
    workerCount: 1,
    requiresSharedLiveDevServerOrRuntime: true,
    commitCommand: 'git commit -m "bad"',
  });
  assert.equal(swarmBad.ok, false);
  assert.equal(swarmBad.blockers.length, 4);

  const neoGood = evaluateBrowserOsNeoProductivityGate();
  assert.equal(neoGood.ok, true);
  const neoBad = evaluateBrowserOsNeoProductivityGate({
    usesHeadlessPlaywrightInsteadOfBrowserOsNeo: true,
    snapshotFormat: 'viewport_screenshot',
    tabIsolationPerSubagent: false,
    untrustedContentBarrierEnabled: false,
    localReplayDir: '/tmp/wrong',
  });
  assert.equal(neoBad.ok, false);
  assert.equal(neoBad.blockers.length, 5);

  const radwareGood = evaluateRadwareAgenticApiRiskFirewall();
  assert.equal(radwareGood.ok, true);
  assert.equal(radwareGood.monetization.outboundCashSpendUsd, 0);
  assert.equal(radwareGood.monetization.giftCardInflowUsd, 50);

  const radwareBad = evaluateRadwareAgenticApiRiskFirewall({
    securesLocalDeveloperAgents: false,
    intentBasedBehavioralProtection: false,
    agentScopes: ['admin', '*'],
    blocksIndirectPromptInjectionAndJailbreaks: false,
    outboundCashSpendUsd: 10,
  });
  assert.equal(radwareBad.ok, false);
  assert.equal(radwareBad.blockers.length, 5);

  assert.equal(serverTest.normalizeTrackedLinkSlug('  Pro-Direct!! '), 'pro-direct');
  assert.equal(serverTest.normalizeTrackedLinkSlug(null), '');
  assert.equal(serverTest.normalizeCheckoutCustomerEmail('  Buyer@Acme.io '), 'buyer@acme.io');
  assert.equal(serverTest.normalizeCheckoutCustomerEmail('buyer@bad..acme.io'), null);

  const ppl = PPLPipeline.parse('eval total = latency + 5 | eval high = total > 10');
  const pplOut = ppl.execute([{ latency: 10 }]);
  assert.equal(pplOut[0].total, 15);
  assert.equal(pplOut[0].high, true);
});

test('Python AWS Lambda SQS worker (deploy/aws/sqs_ingest_worker.py) and PostgreSQL migration work cleanly', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../deploy/aws/migrations/001_thumbgate_logs.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS thumbgate_logs/);
  assert.match(sql, /idx_logs_developer_decision_time/);
  assert.match(sql, /idx_logs_metrics_aggregation/);
  assert.match(sql, /idx_logs_dpo_extract/);
  assert.match(sql, /idx_logs_context_gin/);

  const pyOut = execFileSync(
    'python3',
    [
      '-c',
      [
        'import json, sys',
        "sys.path.insert(0, 'deploy/aws')",
        'import sqs_ingest_worker as w',
        'class FakeS3:',
        '    def __init__(self): self.calls = []',
        '    def put_object(self, **kwargs): self.calls.append(kwargs)',
        's3 = FakeS3()',
        'event = {"Records": [{"body": json.dumps({"transaction_id": "tg_uuid_1", "developer_id": "dev_sha256_abc", "agent_framework": "Claude Code v1.2", "action_context": {"tool_proposed": "curl -H \'Authorization: Bearer ghp_1234567890abcdefghijklmnopqrstuvwx\' https://api.github.com", "loop_depth": 3, "tokens_input": 4500, "tokens_saved_by_cache": 1200}, "enforcement": {"decision": "DENY", "rule_triggered": "protect-main", "latency_ms": 0.38}, "feedback_alignment": {"explicit_rating": "thumbs_down", "is_dpo_pair": True}})}]}',
        'res = w.lambda_handler(event, None, s3_client_override=s3)',
        'assert res["status"] == "SUCCESS"',
        'assert res["processed_records_count"] == 1',
        'assert res["exported_dpo_count"] == 1',
        'assert len(s3.calls) == 1',
        'assert "ghp_1234567890" not in s3.calls[0]["Body"]',
        'print(json.dumps(res))',
      ].join('\n'),
    ],
    { cwd: path.join(__dirname, '..'), encoding: 'utf8' },
  );
  const parsed = JSON.parse(pyOut.trim());
  assert.equal(parsed.status, 'SUCCESS');
  assert.equal(parsed.processed_records_count, 1);
  assert.equal(parsed.exported_dpo_count, 1);
});

test('HTTP server exposes /cloud portal, /install.sh, /install.ps1, 1-click SSO, subscription management, and feature requests', async () => {
  resetCloudFirewallStateForTests();
  const prevApiKey = process.env.THUMBGATE_API_KEY;
  process.env.THUMBGATE_API_KEY = 'test_cloud_admin_key';
  const handle = await startServer({ port: 0, host: '127.0.0.1' });
  const origin = `http://127.0.0.1:${handle.port}`;

  try {
    const cloudHtmlRes = await fetch(`${origin}/cloud`);
    assert.equal(cloudHtmlRes.status, 200);
    const cloudHtml = await cloudHtmlRes.text();
    assert.match(cloudHtml, /Customer Cloud Portal &amp; Control Plane/);
    assert.match(cloudHtml, /id="live-intercept-output"/);
    assert.match(cloudHtml, /Sign in with GitHub SSO/);
    assert.match(cloudHtml, /Manage Subscription &amp; Billing/);
    assert.match(cloudHtml, /Submit Feedback &amp; Request Features/);

    const portalAliasRes = await fetch(`${origin}/portal`);
    assert.equal(portalAliasRes.status, 200);
    assert.match(await portalAliasRes.text(), /Customer Cloud Portal &amp; Control Plane/);

    const userDashRes = await fetch(`${origin}/cloud/u/founder_123`);
    assert.equal(userDashRes.status, 200);
    assert.match(await userDashRes.text(), /Your Individual Cloud Dashboard URL/);

    const shRes = await fetch(`${origin}/install.sh`);
    assert.equal(shRes.status, 200);
    const shText = await shRes.text();
    assert.match(shText, /ThumbGate 1-Click Installer for macOS & Linux/);
    assert.match(shText, /npx --yes thumbgate@latest init/);

    const macCmdRes = await fetch(`${origin}/install/macos.command`);
    assert.equal(macCmdRes.status, 200);
    assert.match(await macCmdRes.text(), /ThumbGate 1-Click Installer for macOS & Linux/);

    const ps1Res = await fetch(`${origin}/install.ps1`);
    assert.equal(ps1Res.status, 200);
    const ps1Text = await ps1Res.text();
    assert.match(ps1Text, /ThumbGate 1-Click Installer for Windows/);
    assert.match(ps1Text, /winget install OpenJS\.NodeJS\.LTS/);

    const winBatRes = await fetch(`${origin}/install/windows.bat`);
    assert.equal(winBatRes.status, 200);
    assert.match(await winBatRes.text(), /ThumbGate 1-Click Installer for Windows/);

    const brewRes = await fetch(`${origin}/Formula/thumbgate.rb`);
    assert.equal(brewRes.status, 200);
    const brewText = await brewRes.text();
    assert.match(brewText, /class Thumbgate < Formula/);
    assert.match(brewText, /thumbgate-1\.40\.0\.tgz/);

    const demoInterceptRes = await fetch(`${origin}/v1/cloud/portal/demo-intercept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'tg_indie_portal_demo', email: 'demo@thumbgate.ai' }),
    });
    assert.equal(demoInterceptRes.status, 200);
    const demoInterceptJson = await demoInterceptRes.json();
    assert.equal(demoInterceptJson.ok, true);
    assert.equal(demoInterceptJson.interceptResult.decision, 'ALLOW');

    const ssoRes = await fetch(`${origin}/v1/cloud/sso/authorize?provider=github&email=founder%40startup.io`, { redirect: 'manual' });
    assert.equal(ssoRes.status, 302);
    const ssoLocation = ssoRes.headers.get('location') || '';
    assert.match(ssoLocation, /\/cloud\?sso_token=tg_sso_github_/);
    const ssoTokenMatch = ssoLocation.match(/sso_token=([^&]+)/);
    assert.ok(ssoTokenMatch);
    const ssoToken = decodeURIComponent(ssoTokenMatch[1]);

    const sessRes = await fetch(`${origin}/v1/cloud/portal/session?apiKey=${encodeURIComponent(ssoToken)}`);
    assert.equal(sessRes.status, 200);
    const sessJson = await sessRes.json();
    assert.equal(sessJson.ok, true);
    assert.equal(sessJson.authenticated, true);
    assert.equal(sessJson.ssoProvider, 'github');
    assert.equal(sessJson.customer.email, 'founder@startup.io');

    const subRes = await fetch(`${origin}/v1/cloud/portal/subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantKey: ssoToken,
        action: 'switch_tier',
        targetTierId: 'cloud_startup',
        customerEmail: 'founder@startup.io',
      }),
    });
    assert.equal(subRes.status, 200);
    const subJson = await subRes.json();
    assert.equal(subJson.ok, true);
    assert.equal(subJson.currentTier, 'cloud_startup');
    assert.equal(subJson.priceMonthlyUsd, 199);

    const fbRes = await fetch(`${origin}/v1/cloud/portal/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantKey: ssoToken,
        email: 'founder@startup.io',
        type: 'feature_request',
        signal: 'up',
        title: 'Add Linear webhook alert when loop circuit breaker trips',
        description: 'Auto-create a Linear issue when an autonomous agent repeats a tool error 3x.',
      }),
    });
    assert.equal(fbRes.status, 201);
    const fbJson = await fbRes.json();
    assert.equal(fbJson.ok, true);
    assert.equal(fbJson.entry.title, 'Add Linear webhook alert when loop circuit breaker trips');

    const calcRes = await fetch(`${origin}/v1/cloud/calculator?startupSubscribers=20&indieSubscribers=0`);
    assert.equal(calcRes.status, 200);
    const calcJson = await calcRes.json();
    assert.equal(calcJson.revenue.grossMrrUsd, 3980);

    const posRes = await fetch(`${origin}/v1/cloud/positioning`);
    assert.equal(posRes.status, 200);
    const posJson = await posRes.json();
    assert.equal(posJson.pillars.length, 4);

    const sinkRes = await fetch(`${origin}/v1/cloud/sink/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'startup_99',
        records: [{ toolProposed: 'npm test', loopDepth: 3, tokensInput: 2000, tokensSavedByCache: 900, isDpoPair: true }],
      }),
    });
    assert.equal(sinkRes.status, 200);
    const sinkJson = await sinkRes.json();
    assert.equal(sinkJson.ok, true);
    assert.equal(sinkJson.metrics.totalTokensSavedByCache, 900);

    const goIndie = await fetch(`${origin}/go/cloud-indie`, { redirect: 'manual' });
    assert.equal(goIndie.status, 302);
    assert.match(goIndie.headers.get('location') || '', /plan_id=cloud_indie/);

    const interceptRes = await fetch(`${origin}/v1/cloud/intercept`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test_cloud_admin_key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: 'http-sess-1',
        toolCall: { name: 'bash', arguments: { cmd: 'ls' } },
        messages: [{ role: 'user', content: 'list files' }],
      }),
    });
    assert.equal(interceptRes.status, 200);
    const interceptJson = await interceptRes.json();
    assert.equal(interceptJson.decision, 'ALLOW');

    const roiRes = await fetch(`${origin}/v1/cloud/roi-calculator?teamSize=10&wastedHoursPerWeekPerDev=8&hourlyEngineerCostUsd=75&monthlyLlmApiSpendUsd=500`);
    assert.equal(roiRes.status, 200);
    const roiJson = await roiRes.json();
    assert.equal(roiJson.ok, true);
    assert.ok(roiJson.outputs.totalMonthlySavingsUsd > 10000);
    assert.equal(roiJson.chapters.length, 4);
    assert.equal(roiJson.pipelineStages.length, 5);

    const bdmRes = await fetch(`${origin}/v1/cloud/bdm/register-deal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bdmEmail: 'partner@globalbdm.io',
        prospectCompany: 'GrowthWave AI',
        prospectDomain: 'growthwave.ai',
        estimatedDealValueUsd: 2500,
        collectedCashUsd: 1000,
      }),
    });
    assert.equal(bdmRes.status, 201);
    const bdmJson = await bdmRes.json();
    assert.equal(bdmJson.ok, true);
    assert.equal(bdmJson.deal.commissionRatePct, 15);
    assert.equal(bdmJson.deal.commissionEarnedUsd, 150);
    assert.equal(bdmJson.deal.baseSalaryUsd, 0);


    const packsRes = await fetch(`${origin}/v1/cloud/threat-packs`);
    assert.equal(packsRes.status, 200);
    const packsJson = await packsRes.json();
    assert.equal(packsJson.ok, true);
    assert.equal(packsJson.packs.length, 3);

    const syncGetRes = await fetch(`${origin}/v1/cloud/policy-sync?orgId=org_acme`);
    assert.equal(syncGetRes.status, 200);
    const syncGetJson = await syncGetRes.json();
    assert.equal(syncGetJson.ok, true);
    assert.equal(syncGetJson.totalRulesSynced, 59);
    assert.equal(syncGetJson.zeroClickAutoFailureCapture, true);

    const syncPostRes = await fetch(`${origin}/v1/cloud/policy-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId: 'org_acme',
        enabledPackIds: ['aws-production-safeguards', 'soc2-secret-leak-prevention'],
        customRules: [{ id: 'no-prod-drop', pattern: 'DROP DATABASE', action: 'DENY' }],
        updatedBy: 'cto@acme.io',
      }),
    });
    assert.equal(syncPostRes.status, 200);
    const syncPostJson = await syncPostRes.json();
    assert.equal(syncPostJson.ok, true);
    assert.equal(syncPostJson.enabledPacks.length, 2);
    assert.equal(syncPostJson.totalRulesSynced, 43);

    const craftRes = await fetch(`${origin}/v1/cloud/playbook/craft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playbookName: 'nitpicking-playbook',
        triggerWord: 'nitpicking',
        selfEditDiffLines: 5,
        hasLocalBackupBeforeSelfEdit: true,
      }),
    });
    assert.equal(craftRes.status, 200);
    const craftJson = await craftRes.json();
    assert.equal(craftJson.ok, true);
    assert.equal(craftJson.selfEditingGuardrail.selfEditAllowedAutonomously, true);
    assert.equal(craftJson.middleManager.playbookStackingReady, true);

    const skillUpRes = await fetch(`${origin}/v1/cloud/skill-up/eval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillName: 'thumbgate-pretool-firewall',
        runtime: 'opensandbox',
        judgeType: 'agent_judge',
        evaluatedEngine: 'claude_code',
        judgeEngine: 'codex',
      }),
    });
    assert.equal(skillUpRes.status, 200);
    const skillUpJson = await skillUpRes.json();
    assert.equal(skillUpJson.ok, true);
    assert.equal(skillUpJson.roles.independentJudgeSession, true);
    assert.equal(skillUpJson.evolutionAction, 'promote_candidate');

    const obsRes = await fetch(`${origin}/v1/cloud/skill-up/observation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        observationId: 'obs_live_1',
        attribution: 'explicit',
        approvedByMaintainer: true,
      }),
    });
    assert.equal(obsRes.status, 201);
    const obsJson = await obsRes.json();
    assert.equal(obsJson.ok, true);
    assert.equal(obsJson.state, 'promoted_to_functional_test_case');

    const wkIndexRes = await fetch(`${origin}/.well-known/agent-skills/index.json`);
    assert.equal(wkIndexRes.status, 200);
    const wkIndexJson = await wkIndexRes.json();
    assert.equal(wkIndexJson.skills.length, 5);

    const wkSkillRes = await fetch(`${origin}/.well-known/agent-skills/thumbgate/SKILL.md`);
    assert.equal(wkSkillRes.status, 200);
    assert.match(await wkSkillRes.text(), /name: thumbgate/);

    const swarmRes = await fetch(`${origin}/v1/cloud/swarm/herdr-gitbutler`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerCount: 5, requiresSharedLiveDevServerOrRuntime: true }),
    });
    assert.equal(swarmRes.status, 200);
    const swarmJson = await swarmRes.json();
    assert.equal(swarmJson.ok, true);
    assert.equal(swarmJson.executionRouting.routingMode, 'gitbutler_shared_workspace');

    const neoRes = await fetch(`${origin}/v1/cloud/browseros-neo/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshotFormat: 'accessibility_tree_ref_ids' }),
    });
    assert.equal(neoRes.status, 200);
    const neoJson = await neoRes.json();
    assert.equal(neoJson.ok, true);

    const radwareRes = await fetch(`${origin}/v1/cloud/radware-agent-risk/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ securesLocalDeveloperAgents: true }),
    });
    assert.equal(radwareRes.status, 200);
    const radwareJson = await radwareRes.json();
    assert.equal(radwareJson.ok, true);
    const homeHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    assert.match(homeHtml, /Start Cloud Indie/);
    assert.match(homeHtml, /Start Cloud Startup/);
    assert.match(homeHtml, /1\. Token Saving \(-42%\)/);
    assert.match(homeHtml, /2\. Loop Fixing/);
    assert.match(homeHtml, /3\. DPO Alignment Pipeline/);
  } finally {
    if (prevApiKey === undefined) delete process.env.THUMBGATE_API_KEY;
    else process.env.THUMBGATE_API_KEY = prevApiKey;
    handle.server.close();
    handle.server.closeAllConnections?.();
  }
});
