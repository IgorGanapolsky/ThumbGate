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
// This enterprise adapter is also listed in package.json "files" because
// src/api/server.js loads it for the local enterprise Dialogflow dashboard routes.
// The same module can still be deployed as Cloud Run / Cloud Functions middleware.
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

// A DFCX webhook is fully untrusted (internet-facing), unlike a local coding
// agent. These allowlists reject anything that could carry shell/path
// metacharacters before the action ever reaches the gate engine.
const SAFE_TOKEN = /^[A-Za-z0-9._-]{1,64}$/; // fulfillment tags, parameter names
const SAFE_VALUE = /^[\w .,@:+-]{0,512}$/;    // parameter string values

// Evaluate whether a DFCX fulfillment should be allowed to execute.
// Returns { allowed, decision, gate, message, severity, repeat, risk, action }.
function evaluateDfcxFulfillment(reqBody, opts = {}) {
  const raw = mapDfcxToAction(reqBody);

  // 0) Validate the untrusted webhook input and rebuild a SAFE action inline,
  //    before any value reaches the gate engine. Block on any unsafe token/value
  //    so attacker-controlled input cannot reach a path/command sink downstream.
  const blockedUnsafe = (reason) => ({
    allowed: false,
    decision: 'deny',
    gate: 'dfcx-unsafe-input',
    message: 'The request contained unsafe input and was blocked.',
    severity: 'critical',
    repeat: false,
    risk: null,
    action: { tag: String(raw.tag), toolName: 'dfcx:unsafe', toolInput: {}, sessionId: raw.sessionId },
    reason,
  });
  const tag = String(raw.tag);
  if (!SAFE_TOKEN.test(tag)) return blockedUnsafe('unsafe fulfillment tag');
  const toolName = 'dfcx:' + tag;
  const toolInput = {};
  const rawParams = raw.toolInput && typeof raw.toolInput === 'object' ? raw.toolInput : {};
  for (const key of Object.keys(rawParams)) {
    if (!SAFE_TOKEN.test(key)) return blockedUnsafe('unsafe parameter name');
    const value = rawParams[key];
    if (typeof value === 'string') {
      if (!SAFE_VALUE.test(value)) return blockedUnsafe('unsafe parameter value');
      toolInput[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      toolInput[key] = value;
    }
    // non-scalar values are intentionally dropped (never forwarded downstream).
  }
  const action = { tag, toolName, toolInput, sessionId: raw.sessionId };

  // 1) Configured policy gates. The pilot configures DFCX-relevant gates (e.g.
  //    "block dfcx:process-refund when amount > limit and not approved"). With no
  //    custom config this is simply a no-op (allow).
  let gateResult = null;
  try {
    gateResult = gates.evaluateGates(toolName, toolInput, opts.configPath);
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
// Supports both camelCase (standard DFCX) and snake_case (legacy/internal) formatting.
function buildBlockResponse(evaluation, opts = {}) {
  const message = opts.blockedMessage
    || 'This request was held by a safety policy and was not completed. A team member may follow up.';
  const payload = {
    fulfillment_response: { messages: [{ text: { text: [message] } }] },
    fulfillmentResponse: { messages: [{ text: { text: [message] } }] },
    session_info: {
      parameters: {
        thumbgate_blocked: true,
        thumbgate_gate: evaluation.gate || null,
        thumbgate_severity: evaluation.severity || null,
      },
    },
    sessionInfo: {
      parameters: {
        thumbgate_blocked: true,
        thumbgate_gate: evaluation.gate || null,
        thumbgate_severity: evaluation.severity || null,
      },
    },
  };
  return payload;
}

// Annotate an allowed (passed-through) response so downstream flows can observe
// that ThumbGate evaluated and permitted the turn. Never throws on odd shapes.
// Populates both camelCase and snake_case variants to ensure compatibility.
function annotateAllowed(response, evaluation) {
  const base = response && typeof response === 'object' ? response : {};
  
  const sessionInfo = base.sessionInfo || base.session_info || {};
  const params = sessionInfo.parameters && typeof sessionInfo.parameters === 'object' ? sessionInfo.parameters : {};
  
  const updatedParams = Object.assign({}, params, {
    thumbgate_blocked: false,
    thumbgate_risk: evaluation.risk,
  });
  
  const updatedSessionInfo = Object.assign({}, sessionInfo, {
    parameters: updatedParams,
  });
  
  const updated = Object.assign({}, base, {
    session_info: updatedSessionInfo,
    sessionInfo: updatedSessionInfo,
  });
  
  if (base.fulfillment_response) {
    updated.fulfillmentResponse = base.fulfillment_response;
  } else if (base.fulfillmentResponse) {
    updated.fulfillment_response = base.fulfillmentResponse;
  }
  
  return updated;
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

// Reject bodies larger than this. A DFCX WebhookRequest is small (a few KB); an
// unbounded reader on an internet-facing endpoint is a memory-exhaustion vector.
const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

// Read a JSON request body from a Node IncomingMessage stream, with a hard size
// cap so a malicious/misconfigured caller cannot exhaust memory.
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytes = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        aborted = true;
        const err = new Error('request body exceeds ' + MAX_BODY_BYTES + ' bytes');
        err.statusCode = 413;
        try { req.destroy(); } catch (_) { /* ignore */ }
        return reject(err);
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (aborted) return;
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
      // Log internally for operators; never leak error/stack details to the
      // external caller (Dialogflow CX / the open internet).
      try { console.error('thumbgate-dfcx-gate error:', err); } catch (_) { /* ignore */ }
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'thumbgate-dfcx-gate-failure' }));
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
