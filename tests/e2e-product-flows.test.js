const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const gatesEngine = require('../scripts/gates-engine');
const { readJsonl } = require('../scripts/fs-utils');

const GOVERNED_RELEASE_VERSION_MISMATCH = '9999.0.0';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeDirWithRetries(dirPath, attempts = 5, delayMs = 80) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return;
    } catch (err) {
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(err.code)) {
        throw err;
      }
      if (i === attempts - 1) throw err;
      await sleep(delayMs * (i + 1));
    }
  }
}

async function startIsolatedServer(t, prefix) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const savedEnv = {
    feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
    apiKey: process.env.THUMBGATE_API_KEY,
    apiKeysPath: process.env._TEST_API_KEYS_PATH,
    funnelPath: process.env._TEST_FUNNEL_LEDGER_PATH,
    revenuePath: process.env._TEST_REVENUE_LEDGER_PATH,
    checkoutSessionsPath: process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  };
  const savedPaths = {
    governanceState: gatesEngine.GOVERNANCE_STATE_PATH,
    constraints: gatesEngine.CONSTRAINTS_PATH,
  };

  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.THUMBGATE_API_KEY = 'e2e-admin-key';
  process.env._TEST_API_KEYS_PATH = path.join(tmpDir, 'api-keys.json');
  process.env._TEST_FUNNEL_LEDGER_PATH = path.join(tmpDir, 'funnel-events.jsonl');
  process.env._TEST_REVENUE_LEDGER_PATH = path.join(tmpDir, 'revenue-events.jsonl');
  process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = path.join(tmpDir, 'local-checkout-sessions.json');
  delete process.env.STRIPE_SECRET_KEY;
  gatesEngine.GOVERNANCE_STATE_PATH = path.join(tmpDir, 'governance-state.json');
  gatesEngine.CONSTRAINTS_PATH = path.join(tmpDir, 'session-constraints.json');
  fs.rmSync(gatesEngine.GOVERNANCE_STATE_PATH, { force: true });
  fs.rmSync(gatesEngine.CONSTRAINTS_PATH, { force: true });

  const { startServer } = require('../src/api/server');
  const { server, port } = await startServer({ port: 0 });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await removeDirWithRetries(tmpDir);
    if (savedEnv.feedbackDir) process.env.THUMBGATE_FEEDBACK_DIR = savedEnv.feedbackDir;
    else delete process.env.THUMBGATE_FEEDBACK_DIR;
    if (savedEnv.apiKey) process.env.THUMBGATE_API_KEY = savedEnv.apiKey;
    else delete process.env.THUMBGATE_API_KEY;
    if (savedEnv.apiKeysPath) process.env._TEST_API_KEYS_PATH = savedEnv.apiKeysPath;
    else delete process.env._TEST_API_KEYS_PATH;
    if (savedEnv.funnelPath) process.env._TEST_FUNNEL_LEDGER_PATH = savedEnv.funnelPath;
    else delete process.env._TEST_FUNNEL_LEDGER_PATH;
    if (savedEnv.revenuePath) process.env._TEST_REVENUE_LEDGER_PATH = savedEnv.revenuePath;
    else delete process.env._TEST_REVENUE_LEDGER_PATH;
    if (savedEnv.checkoutSessionsPath) process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = savedEnv.checkoutSessionsPath;
    else delete process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH;
    if (savedEnv.stripeSecretKey) process.env.STRIPE_SECRET_KEY = savedEnv.stripeSecretKey;
    else delete process.env.STRIPE_SECRET_KEY;
    gatesEngine.GOVERNANCE_STATE_PATH = savedPaths.governanceState;
    gatesEngine.CONSTRAINTS_PATH = savedPaths.constraints;
  });

  return {
    tmpDir,
    port,
    adminHeaders: {
      Authorization: 'Bearer e2e-admin-key',
      'Content-Type': 'application/json',
    },
  };
}

function apiUrl(port, pathname) {
  return `http://localhost:${port}${pathname}`;
}

test('E2E: public checkout -> paid local session -> usable dashboard key -> admin billing summary', async (t) => {
  const { tmpDir, port, adminHeaders } = await startIsolatedServer(t, 'thumbgate-e2e-checkout-');

  const checkoutRes = await fetch(apiUrl(port, '/v1/billing/checkout'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      planId: 'team',
      seatCount: 4,
      customerEmail: 'team@example.com',
      source: 'youtube',
      utmSource: 'youtube',
      utmCampaign: 'e2e_team_rollout',
      creator: 'reach_vb',
      ctaId: 'pricing_team',
    }),
  });
  assert.equal(checkoutRes.status, 200);
  const checkoutBody = await checkoutRes.json();
  assert.equal(checkoutBody.localMode, true);
  assert.equal(checkoutBody.planId, 'team');
  assert.equal(checkoutBody.seatCount, 4);
  assert.equal(checkoutBody.price, 396);
  assert.equal(checkoutBody.priceLabel, '$99/seat/mo');
  assert.ok(checkoutBody.sessionId);
  assert.ok(checkoutBody.traceId);

  const sessionRes = await fetch(apiUrl(
    port,
    `/v1/billing/session?sessionId=${encodeURIComponent(checkoutBody.sessionId)}&traceId=${encodeURIComponent(checkoutBody.traceId)}`
  ));
  assert.equal(sessionRes.status, 200);
  const sessionBody = await sessionRes.json();
  assert.equal(sessionBody.found, true);
  assert.equal(sessionBody.paid, true);
  assert.equal(sessionBody.localMode, true);
  assert.equal(sessionBody.planId, 'team');
  assert.ok(sessionBody.apiKey);
  assert.ok(sessionBody.nextSteps.env.includes('THUMBGATE_API_KEY='));

  const renderRes = await fetch(apiUrl(port, '/v1/dashboard/render-spec?view=workflow-rollout&window=lifetime'), {
    headers: {
      Authorization: `Bearer ${sessionBody.apiKey}`,
    },
  });
  assert.equal(renderRes.status, 200);
  const renderBody = await renderRes.json();
  assert.equal(renderBody.view, 'workflow-rollout');
  assert.ok(Array.isArray(renderBody.components));
  assert.ok(renderBody.components.some((component) => component.type === 'hero'));
  assert.ok(renderBody.availableViews.some((view) => view.id === 'team-review'));

  const summaryRes = await fetch(apiUrl(port, '/v1/billing/summary?window=lifetime'), {
    headers: adminHeaders,
  });
  assert.equal(summaryRes.status, 200);
  const summaryBody = await summaryRes.json();
  assert.ok(summaryBody.funnel.stageCounts.acquisition >= 1);
  assert.ok(summaryBody.keys.active >= 1);
  assert.equal(summaryBody.revenue.paidOrders, 0);
  assert.equal(summaryBody.revenue.bookedRevenueCents, 0);

  const funnelLedger = readJsonl(path.join(tmpDir, 'funnel-events.jsonl'));
  assert.ok(funnelLedger.some((entry) => entry.event === 'checkout_session_created'));
});

test('E2E: localhost dashboard bootstraps Local Pro while forwarded hosts stay unbootstrapped', async (t) => {
  const { port } = await startIsolatedServer(t, 'thumbgate-e2e-dashboard-bootstrap-');
  const previousProMode = process.env.THUMBGATE_PRO_MODE;
  process.env.THUMBGATE_PRO_MODE = '1';

  t.after(() => {
    if (previousProMode === undefined) {
      delete process.env.THUMBGATE_PRO_MODE;
    } else {
      process.env.THUMBGATE_PRO_MODE = previousProMode;
    }
  });

  const localRes = await fetch(apiUrl(port, '/dashboard'));
  assert.equal(localRes.status, 200);
  const localBody = await localRes.text();
  assert.match(localBody, /const BOOTSTRAP_API_KEY = "e2e-admin-key";/);
  assert.match(localBody, /const LOCAL_PRO_BOOTSTRAP = true;/);
  assert.match(localBody, /Local Pro is active on this machine/);

  const forwardedRes = await fetch(apiUrl(port, '/dashboard'), {
    headers: {
      'x-forwarded-host': 'thumbgate.example.com',
      'x-forwarded-proto': 'https',
    },
  });
  assert.equal(forwardedRes.status, 200);
  const forwardedBody = await forwardedRes.text();
  assert.match(forwardedBody, /const BOOTSTRAP_API_KEY = "";/);
  assert.match(forwardedBody, /const LOCAL_PRO_BOOTSTRAP = false;/);
  assert.doesNotMatch(forwardedBody, /const BOOTSTRAP_API_KEY = "e2e-admin-key";/);
});

test('E2E: rotated billing key disables the old key and keeps dashboard access alive', async (t) => {
  const { port } = await startIsolatedServer(t, 'thumbgate-e2e-rotate-');

  const checkoutRes = await fetch(apiUrl(port, '/v1/billing/checkout'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      planId: 'pro_monthly',
      customerEmail: 'pro@example.com',
      source: 'x',
      utmSource: 'x',
      utmCampaign: 'e2e_rotate',
    }),
  });
  assert.equal(checkoutRes.status, 200);
  const checkoutBody = await checkoutRes.json();

  const sessionRes = await fetch(apiUrl(
    port,
    `/v1/billing/session?sessionId=${encodeURIComponent(checkoutBody.sessionId)}&traceId=${encodeURIComponent(checkoutBody.traceId)}`
  ));
  assert.equal(sessionRes.status, 200);
  const sessionBody = await sessionRes.json();
  const originalKey = sessionBody.apiKey;
  assert.ok(originalKey);

  const rotateRes = await fetch(apiUrl(port, '/v1/billing/rotate-key'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${originalKey}`,
    },
  });
  assert.equal(rotateRes.status, 200);
  const rotateBody = await rotateRes.json();
  assert.ok(rotateBody.newKey);
  assert.notEqual(rotateBody.newKey, originalKey);

  const oldKeyRes = await fetch(apiUrl(port, '/v1/dashboard'), {
    headers: {
      Authorization: `Bearer ${originalKey}`,
    },
  });
  assert.equal(oldKeyRes.status, 401);

  const newKeyRes = await fetch(apiUrl(port, '/v1/dashboard'), {
    headers: {
      Authorization: `Bearer ${rotateBody.newKey}`,
    },
  });
  assert.equal(newKeyRes.status, 200);
  const dashboardBody = await newKeyRes.json();
  assert.ok(dashboardBody.analytics);
});

test('E2E: governance task scope and protected approvals persist over the HTTP surface', async (t) => {
  const { port, adminHeaders } = await startIsolatedServer(t, 'ThumbGate-e2e-governance-');

  const scopeRes = await fetch(apiUrl(port, '/v1/gates/task-scope'), {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      taskId: '1733520',
      summary: 'prove hard enforcement',
      allowedPaths: ['scripts/**', 'tests/**'],
      protectedPaths: ['AGENTS.md'],
      localOnly: true,
    }),
  });
  assert.equal(scopeRes.status, 200);
  const scopeBody = await scopeRes.json();
  assert.equal(scopeBody.scope.taskId, '1733520');
  assert.equal(scopeBody.scope.localOnly, true);

  const approvalRes = await fetch(apiUrl(port, '/v1/gates/protected-approval'), {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      pathGlobs: ['AGENTS.md'],
      reason: 'CEO approved protected-file edit',
      evidence: 'hard enforcement proof',
      taskId: '1733520',
      ttlMs: 120000,
    }),
  });
  assert.equal(approvalRes.status, 200);
  const approvalBody = await approvalRes.json();
  assert.equal(approvalBody.approved, true);
  assert.deepEqual(approvalBody.approval.pathGlobs, ['AGENTS.md']);

  const branchRes = await fetch(apiUrl(port, '/v1/gates/branch-governance'), {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      branchName: 'feat/thumbgate-hardening',
      baseBranch: 'main',
      prRequired: true,
      prNumber: '999',
      queueRequired: true,
      releaseVersion: GOVERNED_RELEASE_VERSION_MISMATCH,
    }),
  });
  assert.equal(branchRes.status, 200);
  const branchBody = await branchRes.json();
  assert.equal(branchBody.branchGovernance.prNumber, '999');

  const stateRes = await fetch(apiUrl(port, '/v1/gates/task-scope'), {
    headers: { Authorization: 'Bearer e2e-admin-key' },
  });
  assert.equal(stateRes.status, 200);
  const stateBody = await stateRes.json();
  assert.equal(stateBody.taskScope.summary, 'prove hard enforcement');
  assert.equal(stateBody.protectedApprovals.length, 1);
  assert.equal(stateBody.branchGovernance.branchName, 'feat/thumbgate-hardening');
  assert.equal(gatesEngine.loadConstraints().local_only.value, true);

  const integrityRes = await fetch(apiUrl(port, '/v1/ops/integrity?command=npm%20publish'), {
    headers: { Authorization: 'Bearer e2e-admin-key' },
  });
  assert.equal(integrityRes.status, 200);
  const integrityBody = await integrityRes.json();
  assert.equal(integrityBody.ok, false);
  assert.ok(integrityBody.blockers.some((blocker) => blocker.code === 'release_version_mismatch'));

  const clearRes = await fetch(apiUrl(port, '/v1/gates/task-scope'), {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ clear: true }),
  });
  assert.equal(clearRes.status, 200);

  const clearedStateRes = await fetch(apiUrl(port, '/v1/gates/task-scope'), {
    headers: { Authorization: 'Bearer e2e-admin-key' },
  });
  assert.equal(clearedStateRes.status, 200);
  const clearedState = await clearedStateRes.json();
  assert.equal(clearedState.taskScope, null);
  assert.equal(clearedState.protectedApprovals.length, 1);
  assert.equal(clearedState.branchGovernance.prNumber, '999');
});

test('E2E: vague thumbs-down distills a lesson and preserves linked follow-up context', async (t) => {
  const { tmpDir, port, adminHeaders } = await startIsolatedServer(t, 'thumbgate-e2e-distill-');

  const captureRes = await fetch(apiUrl(port, '/v1/feedback/capture'), {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      signal: 'down',
      context: 'thumbs down',
      chatHistory: [
        { author: 'user', text: 'Do not use Tailwind in this repo.' },
        { author: 'assistant', text: 'I used Tailwind classes in the hero rewrite.' },
      ],
      tags: ['ui', 'e2e'],
    }),
  });
  assert.equal(captureRes.status, 200);
  const captureBody = await captureRes.json();
  assert.equal(captureBody.accepted, true);
  assert.ok(captureBody.feedbackEvent.id);
  assert.match(captureBody.feedbackEvent.context, /History-aware distillation/i);
  assert.match(captureBody.feedbackEvent.whatWentWrong, /ignored a prior instruction/i);
  assert.equal(captureBody.feedbackEvent.conversationWindow.length, 2);
  assert.ok(captureBody.feedbackEvent.distillation);

  const followUpRes = await fetch(apiUrl(port, '/feedback/quick/context'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      signal: 'down',
      context: 'Also ignored the design-system rule in the same pass.',
      relatedFeedbackId: captureBody.feedbackEvent.id,
    }),
  });
  assert.equal(followUpRes.status, 200);
  const followUpBody = await followUpRes.json();
  assert.equal(followUpBody.ok, true);
  assert.equal(followUpBody.relatedFeedbackId, captureBody.feedbackEvent.id);
  assert.equal(followUpBody.detailField, 'whatWentWrong');
  assert.match(followUpBody.updated.whatWentWrong, /Also ignored the design-system rule/);
  assert.match(followUpBody.updated.tags.join(','), /follow-up-context/);

  const statsRes = await fetch(apiUrl(port, '/v1/feedback/stats'), {
    headers: adminHeaders,
  });
  assert.equal(statsRes.status, 200);
  const statsBody = await statsRes.json();
  assert.equal(statsBody.total, 1);
  assert.equal(statsBody.totalNegative, 1);

  const summaryRes = await fetch(apiUrl(port, '/v1/feedback/summary'), {
    headers: adminHeaders,
  });
  assert.equal(summaryRes.status, 200);
  const summaryBody = await summaryRes.json();
  assert.match(summaryBody.summary, /Negative:\s+1/);

  const feedbackLog = readJsonl(path.join(tmpDir, 'feedback-log.jsonl'));
  assert.equal(feedbackLog.length, 1);
  assert.ok(feedbackLog[0].distillation);

  const lessonPageRes = await fetch(apiUrl(port, `/lessons/${encodeURIComponent(captureBody.feedbackEvent.id)}`));
  assert.equal(lessonPageRes.status, 200);
  const lessonPageHtml = await lessonPageRes.text();
  assert.match(lessonPageHtml, /Also ignored the design-system rule in the same pass\./);
});

test('E2E: learn hub and article pages serve live over HTTP', async (t) => {
  const { port } = await startIsolatedServer(t, 'thumbgate-e2e-learn-');

  const learnRes = await fetch(apiUrl(port, '/learn'));
  assert.equal(learnRes.status, 200);
  const learnHtml = await learnRes.text();
  assert.match(learnHtml, /CollectionPage/);
  assert.match(learnHtml, /Persistent Memory Across Sessions/);
  assert.match(learnHtml, /data-domain="thumbgate-production\.up\.railway\.app"/);

  const articleRes = await fetch(apiUrl(port, '/learn/agent-harness-pattern'));
  assert.equal(articleRes.status, 200);
  const articleHtml = await articleRes.text();
  assert.match(articleHtml, /The Agent Harness Pattern/);
  assert.match(articleHtml, /"@type":\s*"TechArticle"/);
  assert.match(articleHtml, /npx thumbgate init/);
});

test('E2E: workflow sprint intake progresses to paid team and surfaces in dashboard analytics', async (t) => {
  const { tmpDir, port, adminHeaders } = await startIsolatedServer(t, 'thumbgate-e2e-sprint-');

  const intakeRes = await fetch(apiUrl(port, '/v1/intake/workflow-sprint'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'pilot@example.com',
      company: 'North Star Systems',
      workflow: 'PR review hardening',
      owner: 'Platform lead',
      blocker: 'Review regressions keep repeating across agent rollouts.',
      runtime: 'Claude Code',
      note: 'Need proof before team rollout.',
      utmSource: 'linkedin',
      creator: 'reach_vb',
      ctaId: 'workflow_sprint_intake',
    }),
  });
  assert.equal(intakeRes.status, 201);
  const intakeBody = await intakeRes.json();
  assert.equal(intakeBody.ok, true);
  assert.ok(intakeBody.leadId);

  const transitions = [
    { status: 'qualified', actor: 'ops' },
    { status: 'named_pilot', actor: 'ops', workflowId: 'pr_review_hardening', teamId: 'north_star_systems' },
    {
      status: 'proof_backed_run',
      actor: 'ops',
      reviewedBy: 'buyer@example.com',
      proofArtifacts: ['docs/VERIFICATION_EVIDENCE.md'],
    },
    { status: 'paid_team', actor: 'ops' },
  ];

  for (const transition of transitions) {
    const advanceRes = await fetch(apiUrl(port, '/v1/intake/workflow-sprint/advance'), {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        leadId: intakeBody.leadId,
        ...transition,
      }),
    });
    assert.equal(advanceRes.status, 200);
    const advanceBody = await advanceRes.json();
    assert.equal(advanceBody.ok, true);
    assert.equal(advanceBody.lead.status, transition.status);
  }

  const dashboardRes = await fetch(apiUrl(port, '/v1/dashboard?window=lifetime'), {
    headers: adminHeaders,
  });
  assert.equal(dashboardRes.status, 200);
  const dashboardBody = await dashboardRes.json();
  assert.ok(dashboardBody.analytics.northStar.namedPilotAgreements >= 1);
  assert.ok(dashboardBody.analytics.northStar.paidTeamRuns >= 1);
  assert.equal(dashboardBody.analytics.northStar.customerProofReached, true);

  const workflowRuns = readJsonl(path.join(tmpDir, 'workflow-runs.jsonl'));
  assert.equal(workflowRuns.length, 3);
  assert.deepEqual(workflowRuns.map((entry) => entry.customerType), ['named_pilot', 'named_pilot', 'paid_team']);
});

test('E2E: promoted lesson can be viewed, updated, searched, and deleted through the HTTP surface', async (t) => {
  const { tmpDir, port, adminHeaders } = await startIsolatedServer(t, 'thumbgate-e2e-lessons-');

  const captureRes = await fetch(apiUrl(port, '/v1/feedback/capture'), {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      signal: 'down',
      context: 'Never merge without checking exact main CI on the merge commit.',
      whatWentWrong: 'Merged before verifying exact merge SHA status.',
      whatToChange: 'Always verify exact main CI before claiming completion.',
      tags: ['git', 'ci', 'e2e'],
    }),
  });
  assert.equal(captureRes.status, 200);
  const captureBody = await captureRes.json();
  const lessonId = captureBody.feedbackEvent.id;
  assert.ok(lessonId);

  const initialSearchRes = await fetch(apiUrl(port, '/v1/lessons/search?q=merged%20before%20verifying%20exact%20merge%20SHA'), {
    headers: adminHeaders,
  });
  assert.equal(initialSearchRes.status, 200);
  const initialSearchBody = await initialSearchRes.json();
  const lessonRecord = initialSearchBody.results.find((result) => result.sourceFeedbackId === lessonId);
  assert.ok(lessonRecord);
  const memoryId = lessonRecord.id;

  const lessonPageRes = await fetch(apiUrl(port, `/lessons/${encodeURIComponent(memoryId)}`));
  assert.equal(lessonPageRes.status, 200);
  const lessonPageHtml = await lessonPageRes.text();
  assert.match(lessonPageHtml, /Lesson Detail/);
  assert.match(lessonPageHtml, /Merged before verifying exact merge SHA status/);

  const updateRes = await fetch(apiUrl(port, `/lessons/${encodeURIComponent(memoryId)}/update`), {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      title: 'Verify exact main CI before merge',
      content: 'Check the exact main merge SHA before saying the work is done.',
      tags: ['git', 'release', 'e2e'],
      whatWorked: 'Linked the merge commit to the final CI runs.',
    }),
  });
  assert.equal(updateRes.status, 200);
  const updateBody = await updateRes.json();
  assert.equal(updateBody.ok, true);
  assert.equal(updateBody.updated.title, 'Verify exact main CI before merge');

  const searchRes = await fetch(apiUrl(port, '/v1/lessons/search?q=Verify%20exact%20main%20CI'), {
    headers: adminHeaders,
  });
  assert.equal(searchRes.status, 200);
  const searchBody = await searchRes.json();
  assert.ok(searchBody.results.some((result) => result.id === memoryId && result.sourceFeedbackId === lessonId));

  const deleteRes = await fetch(apiUrl(port, `/lessons/${encodeURIComponent(memoryId)}/delete`), {
    method: 'POST',
    headers: adminHeaders,
  });
  assert.equal(deleteRes.status, 200);
  const deleteBody = await deleteRes.json();
  assert.equal(deleteBody.ok, true);
  assert.equal(deleteBody.deleted, memoryId);

  const deletedPageRes = await fetch(apiUrl(port, `/lessons/${encodeURIComponent(memoryId)}`));
  assert.equal(deletedPageRes.status, 404);

  const feedbackLog = readJsonl(path.join(tmpDir, 'feedback-log.jsonl'));
  const memoryLog = readJsonl(path.join(tmpDir, 'memory-log.jsonl'));
  assert.equal(feedbackLog.length, 1);
  assert.equal(memoryLog.length, 0);
});

test('E2E: contradictory feedback drives uncertainty through the MCP tool surface', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-e2e-uncertainty-'));
  const savedFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  t.after(async () => {
    if (savedFeedbackDir) process.env.THUMBGATE_FEEDBACK_DIR = savedFeedbackDir;
    else delete process.env.THUMBGATE_FEEDBACK_DIR;
    await removeDirWithRetries(tmpDir);
  });

  const { captureFeedback, readJSONL } = require('../scripts/feedback-loop');
  const { callTool } = require('../adapters/mcp/server-stdio');

  captureFeedback({
    signal: 'up',
    context: 'The user explicitly wants tabs for indentation in this project.',
    tags: ['formatting', 'e2e'],
  });
  captureFeedback({
    signal: 'down',
    context: 'The user now says spaces are required and tabs are no longer acceptable.',
    tags: ['formatting', 'e2e'],
  });
  captureFeedback({
    signal: 'up',
    context: 'The user has changed their mind again and confirms tabs are preferred.',
    tags: ['formatting', 'e2e'],
  });

  const memories = readJSONL(path.join(tmpDir, 'memory-log.jsonl'));
  assert.equal(memories.length, 3);

  const result = await callTool('estimate_uncertainty', { tags: ['formatting'] });
  const data = JSON.parse(result.content[0].text);
  assert.ok(data.averageUncertainty > 0);
  assert.deepEqual(data.tags, ['formatting']);
  assert.equal(data.matches, 3);
});
