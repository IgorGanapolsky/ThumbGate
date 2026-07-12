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
  mapDfcxToAction,
  evaluateDfcxFulfillment,
  buildBlockResponse,
  guardDfcxWebhook,
  createHttpHandler,
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
  resetSession();
  let calls = 0;
  const fulfill = async () => { calls += 1; return { fulfillment_response: { messages: [] } }; };
  // Keep policy gates out of this unit: this case isolates fallback repeat detection.
  const req = dfcxRequest('lookup-balance', { account_id: 'DUP-1' });

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
});

test('blockOnRepeat=false disables the repeat block', async () => {
  resetSession();
  let calls = 0;
  const fulfill = async () => { calls += 1; return { fulfillment_response: { messages: [] } }; };
  const req = dfcxRequest('send-receipt', { account_id: 'OK-2' });
  await guardDfcxWebhook(req, fulfill, { blockOnRepeat: false });
  const second = await guardDfcxWebhook(req, fulfill, { blockOnRepeat: false });
  assert.equal(second.blocked, false);
  assert.equal(calls, 2, 'both attempts run when repeat-blocking is off');
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
  resetSession();
  const r = evaluateDfcxFulfillment(dfcxRequest('lookup-balance', { account_id: 'A-100', amount: 500, name: 'Jane Doe' }));
  assert.notEqual(r.gate, 'dfcx-unsafe-input');
  assert.equal(r.allowed, true);
});

test('evaluateDfcxFulfillment: never throws on a malformed request', () => {
  resetSession();
  const r = evaluateDfcxFulfillment({ fulfillmentInfo: null, sessionInfo: null });
  assert.equal(typeof r.allowed, 'boolean');
});
