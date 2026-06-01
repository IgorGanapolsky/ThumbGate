'use strict';

// adapters/gcp/dfcx-webhook-gate.js
// -----------------------------------------------------------------------------
// ThumbGate Enterprise — Dialogflow CX fulfillment webhook guardrail.
//
// Routes a Dialogflow CX (DFCX) fulfillment request through ThumbGate's
// pre-action gate engine BEFORE the real fulfillment side-effect runs (DB/CRM/
// billing write). If a configured policy gate denies the action, or the action
// is a known same-session repeat, the side-effect is blocked and a safe DFCX
// WebhookResponse is returned instead of executing it.
//
// Design: ThumbGate is a *guard in front of* the customer's existing fulfillment
// function — it decides whether that function is allowed to run. It does not
// replace it, mutate Playbooks, or call any Google API itself.
//
// This is enterprise add-on code and is intentionally NOT part of the published
// npm bundle (not listed in package.json "files"). It lives in-repo so the pilot
// implementation can deploy it as Cloud Run / Cloud Functions middleware.
// -----------------------------------------------------------------------------

const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const gates = require(path.join(REPO_ROOT, 'scripts', 'gates-engine'));

// Risk scorer is optional: it needs a trained model on disk. Degrade to null.
let riskScorer = null;
try {
  riskScorer = require(path.join(REPO_ROOT, 'scripts', 'risk-scorer'));
} catch (_) {
  riskScorer = null;
}

// Deterministic stringify so the same parameter object always yields the same
// action id (used for same-session repeat detection).
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

// Map a DFCX WebhookRequest into a ThumbGate (toolName, toolInput) action.
// DFCX fulfillment tag -> toolName ("dfcx:<tag>"); session parameters -> toolInput.
function mapDfcxToAction(reqBody) {
  const body = reqBody || {};
  const tag = (body.fulfillmentInfo && body.fulfillmentInfo.tag) || 'unknown';
  const params = (body.sessionInfo && body.sessionInfo.parameters) || {};
  return {
    tag,
    toolName: 'dfcx:' + tag,
    toolInput: params,
    sessionId: (body.sessionInfo && body.sessionInfo.session) || '',
  };
}

// Evaluate whether a DFCX fulfillment should be allowed to execute.
// Returns { allowed, decision, gate, message, severity, repeat, risk, action }.
function evaluateDfcxFulfillment(reqBody, opts = {}) {
  const action = mapDfcxToAction(reqBody);

  // 1) Configured policy gates. The pilot configures DFCX-relevant gates (e.g.
  //    "block dfcx:process-refund when amount > limit and not approved"). With no
  //    custom config this is simply a no-op (allow).
  let gateResult = null;
  try {
    gateResult = gates.evaluateGates(action.toolName, action.toolInput, opts.configPath);
  } catch (_) {
    gateResult = null;
  }
  const denied = Boolean(gateResult && gateResult.decision === 'deny');

  // 2) Same-session repeat detection — works with zero custom config.
  const actionId = action.toolName + ':' + stableStringify(action.toolInput);
  let repeat = false;
  if (typeof gates.hasAction === 'function') {
    try { repeat = Boolean(gates.hasAction(actionId)); } catch (_) { repeat = false; }
  }
  if (typeof gates.trackAction === 'function') {
    try { gates.trackAction(actionId, { source: 'dfcx', tag: action.tag }); } catch (_) { /* non-fatal */ }
  }

  // 3) Optional risk score (best-effort; null when no model is trained).
  let risk = null;
  if (riskScorer && typeof riskScorer.predictRisk === 'function') {
    try {
      const candidate = typeof riskScorer.buildRiskCandidate === 'function'
        ? riskScorer.buildRiskCandidate({ toolName: action.toolName, toolInput: action.toolInput })
        : { toolName: action.toolName, toolInput: action.toolInput };
      const r = riskScorer.predictRisk(candidate);
      risk = typeof r === 'number' ? r : (r && typeof r.risk === 'number' ? r.risk : null);
    } catch (_) {
      risk = null;
    }
  }

  const blockOnRepeat = opts.blockOnRepeat !== false && repeat;
  const allowed = !denied && !blockOnRepeat;

  return {
    allowed,
    decision: allowed ? 'allow' : 'deny',
    gate: denied ? gateResult.gate : (blockOnRepeat ? 'dfcx-repeat-action' : null),
    message: denied
      ? gateResult.message
      : (blockOnRepeat ? 'This action was already attempted in this session and is blocked as a repeat.' : null),
    severity: denied ? gateResult.severity : (blockOnRepeat ? 'high' : null),
    repeat,
    risk,
    action,
  };
}

// Build a DFCX WebhookResponse that safely halts the turn without side-effects.
function buildBlockResponse(evaluation, opts = {}) {
  const message = opts.blockedMessage
    || 'This request was held by a safety policy and was not completed. A team member may follow up.';
  return {
    fulfillment_response: { messages: [{ text: { text: [message] } }] },
    session_info: {
      parameters: {
        thumbgate_blocked: true,
        thumbgate_gate: evaluation.gate || null,
        thumbgate_severity: evaluation.severity || null,
      },
    },
  };
}

// Annotate an allowed (passed-through) response so downstream flows can observe
// that ThumbGate evaluated and permitted the turn. Never throws on odd shapes.
function annotateAllowed(response, evaluation) {
  const base = response && typeof response === 'object' ? response : {};
  const sessionInfo = base.session_info && typeof base.session_info === 'object' ? base.session_info : {};
  const params = sessionInfo.parameters && typeof sessionInfo.parameters === 'object' ? sessionInfo.parameters : {};
  return Object.assign({}, base, {
    session_info: Object.assign({}, sessionInfo, {
      parameters: Object.assign({}, params, {
        thumbgate_blocked: false,
        thumbgate_risk: evaluation.risk,
      }),
    }),
  });
}

// Guard a DFCX webhook: run the gate; only invoke the real fulfillment when
// allowed. `fulfill(reqBody) -> WebhookResponse` is the customer's existing
// fulfillment function. Returns { blocked, response, evaluation }.
async function guardDfcxWebhook(reqBody, fulfill, opts = {}) {
  const evaluation = evaluateDfcxFulfillment(reqBody, opts);
  if (!evaluation.allowed) {
    return { blocked: true, response: buildBlockResponse(evaluation, opts), evaluation };
  }
  const fulfilled = typeof fulfill === 'function'
    ? await fulfill(reqBody)
    : { fulfillment_response: { messages: [] } };
  return { blocked: false, response: annotateAllowed(fulfilled, evaluation), evaluation };
}

// Read a JSON request body from a Node IncomingMessage stream.
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// Plain Node HTTP handler for Cloud Run / Cloud Functions (no framework dep).
function createHttpHandler(fulfill, opts = {}) {
  return async function handler(req, res) {
    try {
      const body = req && req.body && typeof req.body === 'object'
        ? req.body
        : await readJsonBody(req);
      const { response, evaluation } = await guardDfcxWebhook(body, fulfill, opts);
      if (typeof opts.onDecision === 'function') {
        try { opts.onDecision(evaluation); } catch (_) { /* observability must not break the turn */ }
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(response));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'thumbgate-dfcx-gate-failure', detail: String((err && err.message) || err) }));
    }
  };
}

module.exports = {
  mapDfcxToAction,
  evaluateDfcxFulfillment,
  buildBlockResponse,
  annotateAllowed,
  guardDfcxWebhook,
  createHttpHandler,
  // exposed for tests
  stableStringify,
};
