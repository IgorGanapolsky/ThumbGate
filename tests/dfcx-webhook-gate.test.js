'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const gates = require(path.join(__dirname, '..', 'scripts', 'gates-engine'));
// Isolate the same-session repeat store to a per-file temp path so concurrent
// test files (and coverage re-runs) can't contaminate each other via the global
// ~/.thumbgate/session-actions.json. See dfcx-gate-server.test.js for rationale.
gates.SESSION_ACTIONS_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dfcx-wh-')), 'session-actions.json');
const {
  DEFAULT_PLAYBOOK_MODEL,
  DEFAULT_VOICE_REWRITER_MODEL,
  resolveDialogflowModel,
  mapDfcxToAction,
  evaluateDfcxFulfillment,
  buildBlockResponse,
  guardDfcxWebhook,
  createHttpHandler,
  auditIntentTrainingPhrases,
  buildPlaybookInstructionSpec,
  buildPostRagWrapperPageConfig,
  createSessionsClientPool,
  evaluateLoadTestRamp,
  createDfcxTestDouble,
  fetchWithExponentialBackoff,
  stableStringify,
} = require(path.join(__dirname, '..', 'adapters', 'gcp', 'dfcx-webhook-gate'));

// A representative DFCX WebhookRequest for a refund fulfillment.
function dfcxRequest(tag, params, session) {
  return {
    fulfillmentInfo: { tag },
    sessionInfo: { session: session || 'projects/p/locations/l/agents/a/sessions/s1', parameters: params || {} },
    languageCode: 'en',
  };
}

function resetSession() {
  if (typeof gates.clearSessionActions === 'function') {
    try { gates.clearSessionActions(); } catch (_) { /* ignore */ }
  }
}

test('mapDfcxToAction: extracts tag + params into a ThumbGate action', () => {
  const a = mapDfcxToAction(dfcxRequest('process-refund', { account_id: '42', amount: 500 }));
  assert.equal(a.tag, 'process-refund');
  assert.equal(a.toolName, 'dfcx:process-refund');
  assert.deepEqual(a.toolInput, { account_id: '42', amount: 500 });
  assert.match(a.sessionId, /sessions\/s1$/);
});

test('mapDfcxToAction: tolerates a missing/empty body', () => {
  const a = mapDfcxToAction(undefined);
  assert.equal(a.tag, 'unknown');
  assert.equal(a.toolName, 'dfcx:unknown');
  assert.deepEqual(a.toolInput, {});
});

test('mapDfcxToAction: extracts tag + params when request uses snake_case keys', () => {
  const req = {
    fulfillment_info: { tag: 'process-refund' },
    session_info: { session: 'projects/p/locations/l/agents/a/sessions/s1', parameters: { account_id: '42' } }
  };
  const a = mapDfcxToAction(req);
  assert.equal(a.tag, 'process-refund');
  assert.equal(a.toolName, 'dfcx:process-refund');
  assert.deepEqual(a.toolInput, { account_id: '42' });
  assert.equal(a.sessionId, 'projects/p/locations/l/agents/a/sessions/s1');
});

test('stableStringify: order-independent for repeat keying', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
});

test('allow path: with no matching gate, the real fulfillment runs and response is annotated', async () => {
  resetSession();
  let fulfillCalled = false;
  const fulfill = async () => {
    fulfillCalled = true;
    return { fulfillment_response: { messages: [{ text: { text: ['ok'] } }] } };
  };
  const { blocked, response, evaluation } = await guardDfcxWebhook(
    dfcxRequest('lookup-balance', { account_id: 'A1' }),
    fulfill,
  );
  assert.equal(blocked, false);
  assert.equal(fulfillCalled, true, 'fulfillment must run when allowed');
  assert.equal(evaluation.allowed, true);
  assert.equal(response.session_info.parameters.thumbgate_blocked, false);
  assert.deepEqual(response.fulfillment_response.messages[0].text.text, ['ok']);
});

test('repeat-block path: the same action twice — second is blocked, fulfillment does NOT run', async () => {
  const evaluateGates = gates.evaluateGates;
  gates.evaluateGates = () => null;
  try {
    resetSession();
    let calls = 0;
    const fulfill = async () => { calls += 1; return { fulfillment_response: { messages: [] } }; };
    const req = dfcxRequest('delete-account', { account_id: 'DUP-1' });

    const first = await guardDfcxWebhook(req, fulfill);
    assert.equal(first.blocked, false, 'first attempt allowed');
    assert.equal(calls, 1);

    const second = await guardDfcxWebhook(req, fulfill);
    assert.equal(second.blocked, true, 'repeat attempt blocked');
    assert.equal(calls, 1, 'fulfillment must NOT run on the blocked repeat');
    assert.equal(second.response.session_info.parameters.thumbgate_blocked, true);
    // Reason is surfaced to the flow/logs via params, NOT leaked in the caller-facing
    // message (which stays a generic safe string by design).
    assert.equal(second.response.session_info.parameters.thumbgate_gate, 'dfcx-repeat-action');
    assert.equal(second.evaluation.message, 'This action was already attempted in this session and is blocked as a repeat.');
    const userMsg = second.response.fulfillment_response.messages[0].text.text[0];
    assert.equal(typeof userMsg, 'string');
    assert.ok(userMsg.length > 0 && !/repeat|gate/i.test(userMsg), 'caller-facing message must not leak internals');
  } finally {
    gates.evaluateGates = evaluateGates;
  }
});

test('blockOnRepeat=false disables the repeat block', async () => {
  const evaluateGates = gates.evaluateGates;
  gates.evaluateGates = () => null;
  try {
    resetSession();
    let calls = 0;
    const fulfill = async () => { calls += 1; return { fulfillment_response: { messages: [] } }; };
    const req = dfcxRequest('send-receipt', { account_id: 'OK-2' });
    await guardDfcxWebhook(req, fulfill, { blockOnRepeat: false });
    const second = await guardDfcxWebhook(req, fulfill, { blockOnRepeat: false });
    assert.equal(second.blocked, false);
    assert.equal(calls, 2, 'both attempts run when repeat-blocking is off');
  } finally {
    gates.evaluateGates = evaluateGates;
  }
});

test('buildBlockResponse: valid DFCX WebhookResponse with safe defaults', () => {
  const resp = buildBlockResponse({ gate: 'g1', severity: 'critical' });
  assert.equal(resp.session_info.parameters.thumbgate_blocked, true);
  assert.equal(resp.session_info.parameters.thumbgate_gate, 'g1');
  assert.equal(resp.session_info.parameters.thumbgate_severity, 'critical');
  assert.ok(Array.isArray(resp.fulfillment_response.messages));
  assert.equal(typeof resp.fulfillment_response.messages[0].text.text[0], 'string');
});

test('createHttpHandler: writes the guarded response to res (Cloud Run / Functions shape)', async () => {
  resetSession();
  const handler = createHttpHandler(async () => ({ fulfillment_response: { messages: [{ text: { text: ['done'] } }] } }));
  const req = { body: dfcxRequest('greet', { name: 'X' }) };
  let statusCode = 0;
  let payload = '';
  const res = {
    setHeader() {},
    set statusCode(v) { statusCode = v; },
    get statusCode() { return statusCode; },
    end(b) { payload = b; },
  };
  await handler(req, res);
  assert.equal(statusCode, 200);
  const parsed = JSON.parse(payload);
  assert.deepEqual(parsed.fulfillment_response.messages[0].text.text, ['done']);
  assert.equal(parsed.session_info.parameters.thumbgate_blocked, false);
});

test('unsafe parameter value (shell metacharacters) is blocked before the gate engine', async () => {
  resetSession();
  let calls = 0;
  const fulfill = async () => { calls += 1; return { fulfillment_response: { messages: [] } }; };
  const { blocked, response, evaluation } = await guardDfcxWebhook(
    dfcxRequest('process-refund', { account_id: 'A-1; rm -rf /' }),
    fulfill,
  );
  assert.equal(blocked, true);
  assert.equal(calls, 0, 'fulfillment must NOT run on unsafe input');
  assert.equal(evaluation.gate, 'dfcx-unsafe-input');
  assert.equal(evaluation.severity, 'critical');
  assert.equal(response.session_info.parameters.thumbgate_blocked, true);
});

test('an unsafe fulfillment tag is blocked', async () => {
  resetSession();
  const { blocked, evaluation } = await guardDfcxWebhook(
    dfcxRequest('refund;reboot', { account_id: 'A-1' }),
    async () => ({ fulfillment_response: { messages: [] } }),
  );
  assert.equal(blocked, true);
  assert.equal(evaluation.gate, 'dfcx-unsafe-input');
});

test('ordinary values (ids, amounts, hyphens) are NOT treated as unsafe', () => {
  const evaluateGates = gates.evaluateGates;
  gates.evaluateGates = () => null;
  try {
    resetSession();
    const r = evaluateDfcxFulfillment(dfcxRequest('lookup-balance', { account_id: 'A-100', amount: 500, name: 'Jane Doe' }));
    assert.notEqual(r.gate, 'dfcx-unsafe-input');
    assert.equal(r.allowed, true);
  } finally {
    gates.evaluateGates = evaluateGates;
  }
});

test('evaluateDfcxFulfillment: never throws on a malformed request', () => {
  resetSession();
  const r = evaluateDfcxFulfillment({ fulfillmentInfo: null, sessionInfo: null });
  assert.equal(typeof r.allowed, 'boolean');
});

test('Model Isolation: Playbooks default to gemini-2.5-flash and voice/rewriter tasks route to gemini-2.5-flash-lite', () => {
  assert.equal(resolveDialogflowModel({ task: 'playbook' }, {}), DEFAULT_PLAYBOOK_MODEL);
  assert.equal(resolveDialogflowModel({}, {}), 'gemini-2.5-flash');
  assert.equal(resolveDialogflowModel({ task: 'rewriter' }, {}), DEFAULT_VOICE_REWRITER_MODEL);
  assert.equal(resolveDialogflowModel({ channel: 'voice' }, {}), 'gemini-2.5-flash-lite');
  assert.equal(resolveDialogflowModel({ channel: 'telephony' }, {}), 'gemini-2.5-flash-lite');
});

test('Wrapper Page Pattern: blocks global Vertex AI Search data store and active RAG page transaction drift', async () => {
  resetSession();
  let calls = 0;
  const fulfill = async () => { calls += 1; return { fulfillment_response: { messages: [] } }; };

  // 1) Global data store scope is rejected
  const globalDsReq = Object.assign(dfcxRequest('lookup-policy', { account_id: 'A-1' }), {
    dataStoreScope: 'global',
  });
  const globalRes = await guardDfcxWebhook(globalDsReq, fulfill);
  assert.equal(globalRes.blocked, true);
  assert.equal(globalRes.evaluation.gate, 'dfcx-rag-wrapper-page-isolation');
  assert.equal(calls, 0);

  // 2) Active Informational Handling Page drifting into transaction is blocked
  const driftReq = Object.assign(dfcxRequest('confirm-appointment', { account_id: 'A-1', rag_wrapper_page_active: true }), {
    pageInfo: { displayName: 'Informational Handling Page' },
  });
  const driftRes = await guardDfcxWebhook(driftReq, fulfill);
  assert.equal(driftRes.blocked, true);
  assert.equal(driftRes.evaluation.gate, 'dfcx-rag-wrapper-page-isolation');
  assert.equal(calls, 0);

  // 3) Exiting the Wrapper Page deterministically permits the transaction
  const evaluateGates = gates.evaluateGates;
  gates.evaluateGates = () => null;
  try {
    const exitedReq = Object.assign(
      dfcxRequest('confirm-appointment', {
        account_id: 'A-1',
        rag_wrapper_page_active: true,
        wrapper_page_exit_approved: true,
      }),
      { pageInfo: { displayName: 'Informational Handling Page' } },
    );
    const exitedRes = await guardDfcxWebhook(exitedReq, fulfill);
    assert.equal(exitedRes.blocked, false);
    assert.equal(calls, 1);
  } finally {
    gates.evaluateGates = evaluateGates;
  }

  const wrapperCfg = buildPostRagWrapperPageConfig({ dataStoreId: 'ds-123' });
  assert.equal(wrapperCfg.globalDataStoreEnabled, false);
  assert.equal(wrapperCfg.dataStoreScope, 'page-sandboxed');
  assert.equal(wrapperCfg.followupHandling.stayOnWrapperPage, true);
});

test('Authorization Rule: blocks generative Playbook transactions without external system validation', async () => {
  const evaluateGates = gates.evaluateGates;
  gates.evaluateGates = () => null;
  try {
    resetSession();
    let calls = 0;
    const fulfill = async () => { calls += 1; return { fulfillment_response: { messages: [] } }; };

    const unverifiedPlaybookReq = Object.assign(
      dfcxRequest('process-refund', { account_id: 'A-500', amount: 250, source_mode: 'playbook' }),
      { playbookInfo: { playbook: 'projects/p/locations/l/agents/a/playbooks/pb1' } },
    );
    const blockedTurn = await guardDfcxWebhook(unverifiedPlaybookReq, fulfill);
    assert.equal(blockedTurn.blocked, true);
    assert.equal(blockedTurn.evaluation.gate, 'dfcx-authorization-rule-unverified');
    assert.equal(calls, 0);

    const verifiedPlaybookReq = Object.assign(
      dfcxRequest('process-refund', {
        account_id: 'A-500',
        amount: 250,
        source_mode: 'playbook',
        external_auth_verified: true,
      }),
      { playbookInfo: { playbook: 'projects/p/locations/l/agents/a/playbooks/pb1' } },
    );
    const allowedTurn = await guardDfcxWebhook(verifiedPlaybookReq, fulfill);
    assert.equal(allowedTurn.blocked, false);
    assert.equal(calls, 1);

    const spec = buildPlaybookInstructionSpec({ playbookName: 'RefundPlaybook' });
    assert.equal(spec.modelIsolation.playbookModel, 'gemini-2.5-flash');
    assert.equal(spec.modelIsolation.voiceAndRewriterModel, 'gemini-2.5-flash-lite');
    assert.equal(spec.authorizationRule.businessLogicInWebhookOnly, true);
  } finally {
    gates.evaluateGates = evaluateGates;
  }
});

test('Banned Phrase Tuning: Full Match blocks exact word boundaries without breaking legitimate substrings', () => {
  const evaluateGates = gates.evaluateGates;
  gates.evaluateGates = () => null;
  try {
    resetSession();
    const bannedPhrases = [
      { phrase: 'ass', matchMode: 'full' },
      { phrase: 'kill', matchMode: 'full' },
      { phrase: 'forbidden-token', matchMode: 'partial' },
    ];

    // Legitimate words containing "ass" or "kill" as substrings must pass Full Match
    const benignReq = Object.assign(dfcxRequest('lookup-balance', { account_id: 'A-1' }), {
      text: 'Please pass my class and upgrade my skill assessment',
    });
    const benignEval = evaluateDfcxFulfillment(benignReq, { bannedPhrases });
    assert.equal(benignEval.allowed, true);

    // Exact whole-word match must be blocked
    const exactBannedReq = Object.assign(dfcxRequest('lookup-balance', { account_id: 'A-2' }), {
      text: 'Please kill the active billing job now',
    });
    const exactEval = evaluateDfcxFulfillment(exactBannedReq, { bannedPhrases });
    assert.equal(exactEval.allowed, false);
    assert.equal(exactEval.gate, 'dfcx-banned-phrase');
    assert.equal(exactEval.matchMode, 'full');

    // Legacy partial match still triggers when explicitly configured
    const partialBannedReq = Object.assign(dfcxRequest('lookup-balance', { account_id: 'A-3' }), {
      text: 'prefix_forbidden-token_suffix',
    });
    const partialEval = evaluateDfcxFulfillment(partialBannedReq, { bannedPhrases });
    assert.equal(partialEval.allowed, false);
    assert.equal(partialEval.gate, 'dfcx-banned-phrase');
    assert.equal(partialEval.matchMode, 'partial');
  } finally {
    gates.evaluateGates = evaluateGates;
  }
});

test('Modern NLU Auditor: enforces 20-50 phrase density, detects keyword intent bias, and checks annotation consistency', () => {
  const variedVerbs = [
    'Check', 'Review', 'Inspect', 'Show', 'Display', 'Fetch', 'Retrieve', 'Look up',
    'Find', 'Verify', 'Confirm', 'See', 'Open', 'Query', 'Pull', 'Get',
    'examine', 'view', 'audit', 'report', 'summarize', 'list', 'detail', 'provide',
  ];
  const variedNouns = [
    'account balance', 'current statement', 'monthly invoice', 'billing ledger',
    'payment history', 'recent charges', 'credit total', 'subscription fee',
    'wallet funds', 'outstanding amount', 'transaction summary', 'plan cost',
  ];
  const healthyPhrases = variedVerbs.map((verb, i) => ({
    text: `${verb} ${variedNouns[i % variedNouns.length]} #${i + 1}`,
    annotations: [{ parameterId: 'account_type', entityType: '@sys.any' }],
    autoGenerated: i >= 12,
  }));
  const healthyAudit = auditIntentTrainingPhrases({ intentName: 'billing.inquiry', phrases: healthyPhrases });
  assert.equal(healthyAudit.valid, true);
  assert.equal(healthyAudit.densityOk, true);
  assert.equal(healthyAudit.intentBiasDetected, false);
  assert.equal(healthyAudit.annotationConsistent, true);

  // Biased + under-dense + inconsistent annotation intent
  const badPhrases = [
    { text: 'refund my order now', annotations: [{ parameterId: 'order_id', entityType: '@sys.number' }] },
    { text: 'refund the order today', annotations: [{ parameterId: 'order_id', entityType: '@sys.any' }], autoGenerated: true },
    { text: 'refund this order immediately' },
    { text: 'refund customer order fast' },
    { text: 'refund previous order' },
  ];
  const badAudit = auditIntentTrainingPhrases({ intentName: 'order.refund', phrases: badPhrases });
  assert.equal(badAudit.valid, false);
  assert.equal(badAudit.densityOk, false);
  assert.equal(badAudit.intentBiasDetected, true);
  assert.equal(badAudit.annotationConsistent, false);
});

test('Operational Infrastructure: recycles SessionsClient instances, validates load-test ramp, and retries 503 webhooks', async () => {
  const pool = createSessionsClientPool();
  const c1 = pool.acquire({ projectId: 'p1', location: 'us-central1' });
  const c2 = pool.acquire({ projectId: 'p1', location: 'us-central1' });
  const c3 = pool.acquire({ projectId: 'p1', location: 'europe-west1' });
  assert.equal(c1, c2, 'same project/location must reuse SessionsClient instance');
  assert.notEqual(c1, c3, 'different region gets its own regional endpoint client');
  const stats = pool.getStats();
  assert.equal(stats.createdCount, 2);
  assert.equal(stats.reuseCount, 1);
  await pool.closeAll();

  // Load-test ramp validation & test double
  const spikeEval = evaluateLoadTestRamp({ currentRps: 50, previousRps: 0, elapsedSeconds: 5, useTestDouble: false });
  assert.equal(spikeEval.safe, false);
  const gradualEval = evaluateLoadTestRamp({ currentRps: 15, previousRps: 10, elapsedSeconds: 120, useTestDouble: true });
  assert.equal(gradualEval.safe, true);

  const td = createDfcxTestDouble({ responsesByTag: { 'lookup-balance': 'Balance is $100' } });
  const simResp = await td.fulfill(dfcxRequest('lookup-balance', { account_id: 'T1' }));
  assert.equal(simResp.session_info.parameters.thumbgate_test_double, true);
  assert.equal(simResp.fulfillment_response.messages[0].text.text[0], 'Balance is $100');

  // Exponential backoff retry on 503 Service Unavailable
  let attempts = 0;
  const delays = [];
  const res = await fetchWithExponentialBackoff(
    'https://fulfillment.example.com/webhook',
    { method: 'POST' },
    {
      baseDelayMs: 50,
      maxRetries: 3,
      sleepImpl: async (ms) => { delays.push(ms); },
      fetchImpl: async () => {
        attempts += 1;
        if (attempts < 3) {
          return { status: 503, ok: false, async text() { return 'Service Unavailable'; } };
        }
        return { status: 200, ok: true, async text() { return '{"ok":true}'; } };
      },
    },
  );
  assert.equal(res.status, 200);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [50, 100]);
});
