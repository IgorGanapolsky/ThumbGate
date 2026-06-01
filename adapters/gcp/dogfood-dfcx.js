'use strict';

// adapters/gcp/dogfood-dfcx.js
// -----------------------------------------------------------------------------
// Local dogfood / demo for the ThumbGate DFCX webhook gate. Runs real Dialogflow
// CX webhook payloads through the SAME gate engine that guards our coding agents,
// and prints the allow/block decision for each — no GCP, no DFCX agent required.
//
//   node adapters/gcp/dogfood-dfcx.js
//
// What it proves end-to-end, locally:
//   * benign fulfillment -> ALLOWED (the customer's fulfillment would run)
//   * a same-session REPEAT of a risky action -> BLOCKED before the side-effect
//   * the caller-facing message stays generic; the reason goes to params/logs
//
// (Policy gates for specific tags — "block process-refund over $X without
//  approval" — are configured per pilot; the config-free repeat/risk layer shown
//  here works out of the box.)
// -----------------------------------------------------------------------------

const path = require('path');
const gates = require(path.join(__dirname, '..', '..', 'scripts', 'gates-engine'));
const { guardDfcxWebhook } = require('./dfcx-webhook-gate');

function dfcx(tag, parameters) {
  return {
    fulfillmentInfo: { tag },
    sessionInfo: { session: 'projects/demo/locations/us/agents/a/sessions/dogfood', parameters },
    languageCode: 'en',
  };
}

// The customer's "real" fulfillment — here a stub that records that it ran.
let sideEffects = 0;
async function fulfill(req) {
  sideEffects += 1;
  return { fulfillment_response: { messages: [{ text: { text: ['(fulfillment ran: ' + req.fulfillmentInfo.tag + ')'] } }] } };
}

async function main() {
  if (typeof gates.clearSessionActions === 'function') gates.clearSessionActions();

  const scenarios = [
    { label: 'benign balance lookup', req: dfcx('lookup-balance', { account_id: 'A-100' }) },
    { label: 'process-refund (1st attempt)', req: dfcx('process-refund', { account_id: 'A-200', amount: 500 }) },
    { label: 'process-refund (SAME, repeat)', req: dfcx('process-refund', { account_id: 'A-200', amount: 500 }) },
  ];

  const rows = [];
  for (const s of scenarios) {
    const before = sideEffects;
    const { blocked, response, evaluation } = await guardDfcxWebhook(s.req, fulfill);
    rows.push({
      scenario: s.label,
      decision: blocked ? 'BLOCKED' : 'allowed',
      'fulfillment ran': sideEffects > before ? 'yes' : 'NO',
      reason: evaluation.gate || '-',
      'caller message': (response.fulfillment_response.messages[0] || { text: { text: [''] } }).text.text[0],
    });
  }

  // eslint-disable-next-line no-console
  console.log('\nThumbGate DFCX gate — local dogfood\n');
  // eslint-disable-next-line no-console
  console.table(rows);
  // eslint-disable-next-line no-console
  console.log('\nside-effects executed:', sideEffects, '(the blocked repeat never reached fulfillment)\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
