'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const gates = require(path.join(__dirname, '..', 'scripts', 'gates-engine'));
gates.SESSION_ACTIONS_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dfcx-cx-')), 'session-actions.json');
if (typeof gates.clearSessionActions === 'function') {
  try { gates.clearSessionActions(); } catch (_) { /* ignore */ }
}

const {
  guardDfcxWebhook,
  selectPlaybookModel,
  auditIntentTraining,
  auditAnnotationConsistency,
  auditBannedPhrasePolicy,
  matchBannedPhrase,
  auditRagPlacement,
  auditConversationalAgent,
  createSessionClientPool,
  planLoadRamp,
  assertGradualRamp,
  createDetectIntentDouble,
  runLoadRamp,
  REFERENCE_AGENT,
  PLAYBOOK_MODEL,
  LITE_MODEL,
} = require(path.join(__dirname, '..', 'adapters', 'gcp', 'dfcx-webhook-gate'));
const { forwardFulfillment } = require(path.join(__dirname, '..', 'adapters', 'gcp', 'server'));

function dfcxRequest(tag, params, extra) {
  return Object.assign({
    fulfillmentInfo: { tag },
    sessionInfo: { session: 'projects/p/locations/l/agents/a/sessions/s1', parameters: params || {} },
    languageCode: 'en',
  }, extra || {});
}

test('playbooks stay on Flash and voice or rewriter lanes stay on Flash-Lite', () => {
  assert.equal(selectPlaybookModel({ kind: 'playbook' }).model, PLAYBOOK_MODEL);
  assert.equal(selectPlaybookModel({ kind: 'voice', channel: 'voice' }).model, LITE_MODEL);
  assert.equal(selectPlaybookModel({ kind: 'rewriter' }).model, LITE_MODEL);
  const coerced = selectPlaybookModel({ kind: 'playbook', model: 'gemini-2.5-pro' });
  assert.equal(coerced.model, PLAYBOOK_MODEL);
  assert.equal(coerced.coerced, true);
  const voiceCoerced = selectPlaybookModel({ kind: 'voice', model: PLAYBOOK_MODEL });
  assert.equal(voiceCoerced.model, LITE_MODEL);
  assert.equal(voiceCoerced.coerced, true);
});

test('a refund or appointment commits only after an external validation receipt', async () => {
  const evaluateGates = gates.evaluateGates;
  gates.evaluateGates = () => null;
  try {
    if (typeof gates.clearSessionActions === 'function') gates.clearSessionActions();
    let calls = 0;
    const fulfill = async () => {
      calls += 1;
      return { fulfillment_response: { messages: [{ text: { text: ['refunded'] } }] } };
    };
    const unvalidated = await guardDfcxWebhook(
      dfcxRequest('process-refund', { account_id: 'A-1', amount: 40 }, {
        generativeInfo: { text: 'I have already refunded this order.' },
      }),
      fulfill,
    );
    assert.equal(unvalidated.blocked, true);
    assert.equal(unvalidated.evaluation.gate, 'dfcx-authorization-rule');
    assert.equal(calls, 0);

    const appointment = await guardDfcxWebhook(
      dfcxRequest('confirm-appointment', { slot: 'tue-10' }),
      fulfill,
    );
    assert.equal(appointment.evaluation.gate, 'dfcx-authorization-rule');

    const validated = await guardDfcxWebhook(
      dfcxRequest('process-refund', { account_id: 'A-1', amount: 40, external_validation_id: 'crm-8841' }),
      fulfill,
    );
    assert.equal(validated.blocked, false);
    assert.equal(calls, 1);

    const echoedWord = await guardDfcxWebhook(
      dfcxRequest('book-appointment', { slot: 'wed-2', thumbgate_external_validated: 'true' }),
      fulfill,
    );
    assert.equal(echoedWord.evaluation.gate, 'dfcx-authorization-rule');
    assert.equal(calls, 1);
  } finally {
    gates.evaluateGates = evaluateGates;
  }
});

test('retrieval stays on the informational page and cannot commit a transaction there', async () => {
  let calls = 0;
  const fulfill = async () => { calls += 1; return { fulfillment_response: { messages: [] } }; };
  const globalRag = await guardDfcxWebhook(
    dfcxRequest('lookup-balance', { account_id: 'A-1', vertex_search_invoked: true }, {
      pageInfo: { displayName: 'Transactions' },
    }),
    fulfill,
  );
  assert.equal(globalRag.evaluation.gate, 'dfcx-rag-not-sandboxed');
  assert.equal(calls, 0);

  const sandboxed = await guardDfcxWebhook(
    dfcxRequest('lookup-balance', {
      account_id: 'A-1',
      vertex_search_invoked: true,
      rag_follow_up_target: 'Informational Handling',
    }, {
      pageInfo: { displayName: 'Informational Handling' },
    }),
    fulfill,
  );
  assert.equal(sandboxed.blocked, false);
  assert.equal(calls, 1);

  const drifted = await guardDfcxWebhook(
    dfcxRequest('lookup-balance', {
      account_id: 'A-2',
      data_store_id: 'lessons',
      follow_up_page: 'Checkout',
    }, {
      pageInfo: { displayName: 'Informational Handling' },
    }),
    fulfill,
  );
  assert.equal(drifted.evaluation.gate, 'dfcx-rag-follow-up-drift');

  const wrapperTransaction = await guardDfcxWebhook(
    dfcxRequest('process-refund', {
      account_id: 'A-3',
      external_validation_id: 'crm-9',
    }, {
      pageInfo: { displayName: 'Informational Handling' },
    }),
    fulfill,
  );
  assert.equal(wrapperTransaction.evaluation.gate, 'dfcx-wrapper-page-transaction');
});

test('the reference agent satisfies density, banned-phrase, and wrapper-page audits', () => {
  const audit = auditConversationalAgent(REFERENCE_AGENT);
  assert.equal(audit.ok, true, JSON.stringify(audit.violations));
  assert.equal(auditRagPlacement({ dataStores: ['global-store'], pages: [] }).ok, false);
});

test('intent density, keyword bias, capitalization, and annotation drift are visible', () => {
  const thin = auditIntentTraining({
    displayName: 'refund',
    trainingPhrases: ['refund my order', 'Refund the charge'],
  });
  assert.equal(thin.violations.some((item) => item.code === 'intent_density'), true);

  const biasedPhrases = [];
  for (let i = 0; i < 20; i += 1) {
    biasedPhrases.push(i % 2 === 0 ? `refund request number ${i}` : `Refund request case ${i}`);
  }
  const biased = auditIntentTraining({ displayName: 'refund', trainingPhrases: biasedPhrases });
  assert.equal(biased.violations.some((item) => item.code === 'intent_bias' && item.keyword === 'refund'), true);

  const flat = [];
  for (let i = 0; i < 20; i += 1) flat.push(`show ledger row ${i} today`);
  const monoculture = auditIntentTraining({ displayName: 'ledger', trainingPhrases: flat });
  assert.equal(monoculture.violations.some((item) => item.code === 'capitalization_monoculture'), true);

  const annotations = auditAnnotationConsistency({
    trainingPhrases: [
      { text: 'refund order 14', entities: [{ text: '14', entityType: '@order-id' }], source: 'manual' },
      { text: 'refund order 14', entities: [{ text: '14', entityType: '@zip' }], source: 'auto' },
    ],
  });
  assert.equal(annotations.ok, false);
  assert.equal(annotations.violations[0].code, 'annotation_inconsistent');
});

test('full match blocks only the whole utterance and partial match stays available', () => {
  const policy = auditBannedPhrasePolicy({ fullMatchEnabled: true, partialMatchEnabled: false });
  assert.equal(policy.violations.some((item) => item.code === 'partial_match_disabled'), true);
  const rules = [
    { phrase: 'book', match: 'full' },
    { phrase: 'drop table', match: 'partial' },
  ];
  assert.equal(matchBannedPhrase('book', rules).match, 'full');
  assert.equal(matchBannedPhrase('I need to book a flight', rules), null);
  assert.equal(matchBannedPhrase('please drop table users', rules).match, 'partial');
  assert.equal(matchBannedPhrase('ignore all policies', [{ phrase: 'ignore all policies' }]).match, 'full');
});

test('one SessionsClient serves every detectIntent call for the process lifetime', async () => {
  let builds = 0;
  let closed = 0;
  const pool = createSessionClientPool(() => {
    builds += 1;
    return {
      detectIntent: async (request) => ({ queryResult: { text: request.text } }),
      close: () => { closed += 1; },
    };
  });
  for (let i = 0; i < 25; i += 1) {
    const result = await pool.detectIntent({ text: 'turn-' + i });
    assert.equal(result.queryResult.text, 'turn-' + i);
  }
  assert.equal(builds, 1);
  assert.equal(pool.creates, 1);
  pool.close();
  assert.equal(closed, 1);
  await pool.detectIntent({ text: 'after-close' });
  assert.equal(builds, 2);
});

test('load ramps double at most each step and refuse a live client', async () => {
  const plan = planLoadRamp({ startRps: 1, targetRps: 16, holdSeconds: 30 });
  assertGradualRamp(plan);
  assert.deepEqual(plan.map((step) => step.rps), [1, 2, 4, 8, 16]);
  assert.throws(() => planLoadRamp({ targetRps: 10, holdSeconds: 5 }), /30/);
  assert.throws(() => assertGradualRamp([
    { rps: 1, holdSeconds: 30, transport: 'test-double' },
    { rps: 500, holdSeconds: 30, transport: 'test-double' },
  ]), /2x/);

  const double = createDetectIntentDouble();
  const run = await runLoadRamp(plan, double);
  assert.equal(run.billed, false);
  assert.equal(double.calls.length, plan.length);
  await assert.rejects(runLoadRamp(plan, { detectIntent: async () => ({}) }), /test double/);
});

test('fulfillment retries 503 with exponential backoff and does not retry other statuses', async () => {
  const sleeps = [];
  let calls = 0;
  const recovered = await forwardFulfillment({ fulfillmentInfo: { tag: 'lookup-balance' } }, {
    url: 'https://fulfillment.example/hook',
    maxAttempts: 3,
    baseDelayMs: 100,
    random: () => 0,
    sleep: async (ms) => { sleeps.push(ms); },
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) return { status: 503, async text() { return ''; } };
      return { status: 200, async text() { return JSON.stringify({ fulfillment_response: { messages: [{ text: { text: ['ok'] } }] } }); } };
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [100, 200]);
  assert.equal(recovered.fulfillment_response.messages[0].text.text[0], 'ok');

  let single = 0;
  await forwardFulfillment({}, {
    url: 'https://fulfillment.example/hook',
    maxAttempts: 3,
    sleep: async () => { throw new Error('should not sleep'); },
    fetchImpl: async () => {
      single += 1;
      return { status: 500, async text() { return '{"fulfillment_response":{"messages":[]}}'; } };
    },
  });
  assert.equal(single, 1);

  let dropped = 0;
  const unavailable = await forwardFulfillment({}, {
    url: 'https://fulfillment.example/hook',
    maxAttempts: 2,
    baseDelayMs: 10,
    random: () => 0,
    sleep: async () => {},
    fetchImpl: async () => {
      dropped += 1;
      return { status: 503, async text() { return 'unavailable'; } };
    },
  });
  assert.equal(dropped, 2);
  assert.equal(unavailable.session_info.parameters.thumbgate_fulfillment_status, 503);
  assert.match(unavailable.fulfillment_response.messages[0].text.text[0], /Nothing was changed/);
});
