'use strict';

// adapters/gcp/server.js
// -----------------------------------------------------------------------------
// Cloud Run / Cloud Functions entrypoint for the ThumbGate DFCX webhook gate.
//
// Deploys as a drop-in PROXY in front of the customer's existing DFCX fulfillment:
//   DFCX  ->  this service (ThumbGate gate)  ->  [allowed]  customer fulfillment URL
//                                            ->  [blocked]  safe response, no side-effect
//
// You point your Dialogflow CX webhook at this service's URL and set
// THUMBGATE_DFCX_FULFILLMENT_URL to your existing fulfillment endpoint. Allowed
// turns are forwarded unchanged; blocked turns never reach your fulfillment.
//
// Config (env):
//   PORT                            listen port (Cloud Run sets this; default 8080)
//   THUMBGATE_DFCX_FULFILLMENT_URL  the customer's existing fulfillment webhook URL
//   THUMBGATE_DFCX_BLOCK_MESSAGE    optional caller-facing message shown on block
//
// Enterprise add-on code — not part of the published npm bundle.
// -----------------------------------------------------------------------------

const http = require('http');
const path = require('path');
const { createHttpHandler, postWebhookWithBackoff } = require('./dfcx-webhook-gate');

const UPSTREAM = process.env.THUMBGATE_DFCX_FULFILLMENT_URL || '';

function fulfillmentUnavailable(attempts) {
  const parameters = {
    thumbgate_fulfillment_status: 503,
    thumbgate_fulfillment_attempts: attempts,
  };
  return {
    fulfillment_response: {
      messages: [{ text: { text: ['The request could not be completed because the fulfillment service was unavailable. Nothing was changed.'] } }],
    },
    fulfillmentResponse: {
      messages: [{ text: { text: ['The request could not be completed because the fulfillment service was unavailable. Nothing was changed.'] } }],
    },
    session_info: { parameters },
    sessionInfo: { parameters },
  };
}

// fulfill: forward an allowed request to the customer's real fulfillment webhook.
// 503 and dropped connections retry with exponential backoff. Dialogflow does not.
async function forwardFulfillment(reqBody, opts = {}) {
  const url = Object.prototype.hasOwnProperty.call(opts, 'url') ? opts.url : UPSTREAM;
  if (!url) {
    return { fulfillment_response: { messages: [] } };
  }
  const env = opts.env || process.env;
  const fromEnv = Number(env.THUMBGATE_DFCX_WEBHOOK_MAX_ATTEMPTS);
  const requested = opts.maxAttempts != null
    ? opts.maxAttempts
    : (Number.isFinite(fromEnv) && fromEnv >= 1 ? Math.floor(fromEnv) : 3);
  const maxAttempts = Math.min(5, Math.max(1, requested));
  const fetchImpl = opts.fetchImpl || fetch;
  let delivered;
  try {
    delivered = await postWebhookWithBackoff(fetchImpl, url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(reqBody),
    }, {
      maxAttempts,
      baseDelayMs: opts.baseDelayMs != null ? opts.baseDelayMs : 100,
      sleep: opts.sleep,
      random: opts.random,
    });
  } catch (err) {
    return fulfillmentUnavailable(err && err.attempts ? err.attempts : maxAttempts);
  }
  if (delivered.attempts > 1) {
    try {
      console.log(JSON.stringify({
        component: 'thumbgate-dfcx-gate',
        event: 'fulfillment-retry',
        attempts: delivered.attempts,
        status: delivered.response && delivered.response.status,
      }));
    } catch (_) { /* logging must never break the turn */ }
  }
  if (!delivered.response || delivered.response.status === 503) {
    return fulfillmentUnavailable(delivered.attempts);
  }
  const text = await delivered.response.text();
  try { return JSON.parse(text); } catch (_) { return { fulfillment_response: { messages: [] } }; }
}

const handler = createHttpHandler(forwardFulfillment, {
  blockedMessage: process.env.THUMBGATE_DFCX_BLOCK_MESSAGE || undefined,
  onDecision(evaluation) {
    // Structured decision log — Cloud Logging ingests stdout JSON automatically.
    try {
      console.log(JSON.stringify({
        component: 'thumbgate-dfcx-gate',
        tag: evaluation.action && evaluation.action.tag,
        allowed: evaluation.allowed,
        gate: evaluation.gate,
        repeat: evaluation.repeat,
        risk: evaluation.risk,
        severity: evaluation.severity,
      }));
    } catch (_) { /* logging must never break the turn */ }
  },
});

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/healthz')) {
      res.statusCode = 200;
      res.end('ok');
      return;
    }
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('method not allowed');
      return;
    }
    handler(req, res);
  });
}

// Entrypoint guard — use path.resolve(argv[1]) vs __filename per project
// convention (more robust than require.main under some bundlers/loaders).
if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  // If VERTEX_PROJECT_ID is provided, fetch enterprise rules from Cloud Storage on boot
  // synced via `npx thumbgate sync-gcp`
  const projectId = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  if (projectId) {
    // eslint-disable-next-line no-console
    console.log(`[Boot] Fetching enterprise policies from gs://thumbgate-enterprise-policies-${projectId}...`);
    // Placeholder: implementation to parse memory-log.jsonl and prevention-rules.md
  }

  const port = Number(process.env.PORT) || 8080;
  createServer().listen(port, () => {
    // eslint-disable-next-line no-console
    console.log('thumbgate-dfcx-gate listening on :' + port);
  });
}

module.exports = { createServer, forwardFulfillment };
