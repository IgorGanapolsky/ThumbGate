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
// Supports both camelCase (standard DFCX) and snake_case (legacy/internal) formatting.
function mapDfcxToAction(reqBody) {
  const body = reqBody || {};
  const fulfillmentInfo = body.fulfillmentInfo || body.fulfillment_info || {};
  const tag = fulfillmentInfo.tag || 'unknown';
  const sessionInfo = body.sessionInfo || body.session_info || {};
  const params = sessionInfo.parameters || {};
  const sessionId = sessionInfo.session || '';
  return {
    tag,
    toolName: 'dfcx:' + tag,
    toolInput: params,
    sessionId,
  };
}

// A DFCX webhook is fully untrusted (internet-facing), unlike a local coding
// agent. These allowlists reject anything that could carry shell/path
// metacharacters before the action ever reaches the gate engine.
const SAFE_TOKEN = /^[A-Za-z0-9._\s-]{1,64}$/; // fulfillment tags, parameter names
const SAFE_VALUE = /^[^`\;|&<>]{0,2048}$/;    // parameter string values (allow standard punctuation, block command injection)

// -----------------------------------------------------------------------------
// October 2026 Google Conversational Agents Console (Dialogflow CX + Gemini 2.5)
// -----------------------------------------------------------------------------

const DEFAULT_PLAYBOOK_MODEL = 'gemini-2.5-flash';
const DEFAULT_VOICE_REWRITER_MODEL = 'gemini-2.5-flash-lite';

const VOICE_OR_REWRITER_TASKS = new Set([
  'voice',
  'telephony',
  'audio',
  'rewriter',
  'rewrite',
  'summarize',
]);

const DEFAULT_TRANSACTIONAL_TAGS = new Set([
  'process-refund',
  'confirm-appointment',
  'delete-account',
  'transfer-funds',
  'update-billing',
  'issue-credit',
  'cancel-subscription',
  'execute-payment',
]);

const WRAPPER_PAGE_NAME_PATTERN = /\b(wrapper\s*page|informational\s+handling(?:\s+page)?|rag\s+sandbox)\b/i;

// Model Isolation: default Playbooks to gemini-2.5-flash and prioritize
// gemini-2.5-flash-lite for high-volume voice and rewriter tasks.
function resolveDialogflowModel(opts = {}, env = process.env) {
  if (opts && typeof opts.model === 'string' && opts.model.trim()) {
    return opts.model.trim();
  }
  const task = String((opts && opts.task) || '').trim().toLowerCase();
  const channel = String((opts && opts.channel) || '').trim().toLowerCase();
  if (VOICE_OR_REWRITER_TASKS.has(task) || VOICE_OR_REWRITER_TASKS.has(channel)) {
    return env.THUMBGATE_GEMINI_LITE_MODEL || DEFAULT_VOICE_REWRITER_MODEL;
  }
  return env.THUMBGATE_GEMINI_PLAYBOOK_MODEL || env.THUMBGATE_GEMINI_MODEL || DEFAULT_PLAYBOOK_MODEL;
}

function isTransactionalTag(tag, customTransactionalTags) {
  const normalized = String(tag || '').trim().toLowerCase();
  if (!normalized) return false;
  if (customTransactionalTags instanceof Set && customTransactionalTags.has(normalized)) return true;
  if (Array.isArray(customTransactionalTags) && customTransactionalTags.map((t) => String(t).toLowerCase()).includes(normalized)) {
    return true;
  }
  return DEFAULT_TRANSACTIONAL_TAGS.has(normalized);
}

// 1.B) The "Wrapper Page" Pattern for Vertex AI Search RAG:
// Do not invoke data stores globally. Keep RAG inside a dedicated, sandboxed
// Informational Handling Page and handle immediate follow-ups on that page
// rather than drifting directly into transaction management.
function evaluateWrapperPageIsolation(reqBody, action, opts = {}) {
  const body = reqBody && typeof reqBody === 'object' ? reqBody : {};
  const pageInfo = body.pageInfo || body.page_info || {};
  const generativeInfo = body.generativeInfo || body.generative_info || {};
  const params = (action && action.toolInput) || {};

  const globalDataStore = Boolean(
    params.global_datastore_enabled === true
    || body.dataStoreScope === 'global'
    || pageInfo.dataStoreScope === 'global'
    || generativeInfo.dataStoreScope === 'global'
    || opts.globalDataStoreEnabled === true,
  );
  if (globalDataStore) {
    return {
      allowed: false,
      gate: 'dfcx-rag-wrapper-page-isolation',
      severity: 'high',
      reason: 'global_datastore_prohibited',
      message: 'RAG Wrapper Page violation: Vertex AI Search data stores must not be invoked globally; bind data stores to a dedicated sandboxed Informational Handling Page.',
    };
  }

  const pageName = String(pageInfo.displayName || pageInfo.display_name || params.current_page || '').trim();
  const inWrapperPage = Boolean(
    params.rag_wrapper_page_active === true
    || WRAPPER_PAGE_NAME_PATTERN.test(pageName),
  );
  const exitApproved = Boolean(
    params.wrapper_page_exit_approved === true
    || params.wrapper_page_followup_complete === true,
  );
  if (inWrapperPage && !exitApproved && isTransactionalTag(action && action.tag, opts.transactionalTags)) {
    return {
      allowed: false,
      gate: 'dfcx-rag-wrapper-page-isolation',
      severity: 'high',
      reason: 'rag_wrapper_transaction_drift',
      message: 'RAG Wrapper Page violation: informational RAG page cannot drift directly into transaction execution; complete follow-up handling and transition out of the Wrapper Page first.',
    };
  }
  return { allowed: true };
}

// 1.C) The Authorization Rule:
// Keep core business logic inside native webhooks/API layer, not solely in a
// model's prompt instructions. Transactions must only trigger after external
// system validation.
function evaluateAuthorizationRule(reqBody, action, opts = {}) {
  const body = reqBody && typeof reqBody === 'object' ? reqBody : {};
  const params = (action && action.toolInput) || {};
  const hasPlaybookContext = Boolean(
    body.playbookInfo
    || body.playbook_info
    || params.source_mode === 'playbook'
    || params.require_external_auth === true
    || opts.enforceAuthorizationRule === true,
  );
  if (!hasPlaybookContext) return { allowed: true };
  if (!isTransactionalTag(action && action.tag, opts.transactionalTags)) {
    return { allowed: true };
  }

  const externallyVerified = Boolean(
    params.external_auth_verified === true
    || params.auth_token_verified === true
    || (typeof opts.verifyAuthorization === 'function' && opts.verifyAuthorization(action, body) === true),
  );
  if (!externallyVerified) {
    return {
      allowed: false,
      gate: 'dfcx-authorization-rule-unverified',
      severity: 'critical',
      reason: 'missing_external_system_validation',
      message: 'Authorization Rule violation: transactional fulfillment from a generative Playbook requires external webhook/API validation before execution.',
    };
  }
  return { allowed: true };
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 2.B) Banned Phrase Tuning:
// Enable Full Match requirement alongside legacy Partial Match so banned
// phrases do not break legitimate conversational inputs (e.g. "pass" vs "ass").
function evaluateBannedPhrases(utterance, bannedPhrases = [], opts = {}) {
  const text = String(utterance || '').trim();
  if (!text || !Array.isArray(bannedPhrases) || bannedPhrases.length === 0) {
    return { blocked: false, matchedPhrase: null, matchMode: null };
  }
  const defaultMode = opts.defaultMatchMode === 'partial' ? 'partial' : 'full';
  const lowerText = text.toLowerCase();

  for (const item of bannedPhrases) {
    const rawPhrase = typeof item === 'string' ? item : (item && item.phrase);
    const phrase = String(rawPhrase || '').trim();
    if (!phrase) continue;
    const mode = (item && typeof item === 'object' && item.matchMode)
      ? String(item.matchMode).toLowerCase()
      : defaultMode;
    if (mode === 'partial') {
      if (lowerText.includes(phrase.toLowerCase())) {
        return { blocked: true, matchedPhrase: phrase, matchMode: 'partial' };
      }
    } else {
      const pattern = new RegExp(`(?:^|[^a-z0-9_])(${escapeRegExp(phrase)})(?:$|[^a-z0-9_])`, 'i');
      if (pattern.test(text)) {
        return { blocked: true, matchedPhrase: phrase, matchMode: 'full' };
      }
    }
  }
  return { blocked: false, matchedPhrase: null, matchMode: null };
}

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

  // 0.5) October 2026 Conversational Agents Console guardrails:
  //      (a) Banned phrase tuning (Full Match default + legacy Partial Match)
  const bannedList = Array.isArray(opts.bannedPhrases)
    ? opts.bannedPhrases
    : (reqBody && Array.isArray(reqBody.bannedPhrases) ? reqBody.bannedPhrases : []);
  if (bannedList.length > 0) {
    const utterance = (reqBody && (reqBody.text || reqBody.transcript)) || toolInput.user_utterance || '';
    const bannedCheck = evaluateBannedPhrases(utterance, bannedList, opts);
    if (bannedCheck.blocked) {
      return {
        allowed: false,
        decision: 'deny',
        gate: 'dfcx-banned-phrase',
        message: `Input matched banned phrase policy (${bannedCheck.matchMode} match).`,
        severity: 'high',
        repeat: false,
        risk: null,
        action,
        matchedPhrase: bannedCheck.matchedPhrase,
        matchMode: bannedCheck.matchMode,
      };
    }
  }

  //      (b) RAG Wrapper Page isolation (no global data stores; no RAG-to-transaction drift)
  const wrapperCheck = evaluateWrapperPageIsolation(reqBody, action, opts);
  if (!wrapperCheck.allowed) {
    return {
      allowed: false,
      decision: 'deny',
      gate: wrapperCheck.gate,
      message: wrapperCheck.message,
      severity: wrapperCheck.severity,
      repeat: false,
      risk: null,
      action,
      reason: wrapperCheck.reason,
    };
  }

  //      (c) The Authorization Rule (external system validation required before Playbook transactions)
  const authCheck = evaluateAuthorizationRule(reqBody, action, opts);
  if (!authCheck.allowed) {
    return {
      allowed: false,
      decision: 'deny',
      gate: authCheck.gate,
      message: authCheck.message,
      severity: authCheck.severity,
      repeat: false,
      risk: null,
      action,
      reason: authCheck.reason,
    };
  }

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

// -----------------------------------------------------------------------------
// 2.A & 2.C) Modern NLU & Training Orchestration:
// Intent Density (20-50 distinct phrases), Capitalization/Synonym Variety,
// Intent Bias Detection, and AI-Assisted Scaling Annotation Consistency.
// -----------------------------------------------------------------------------
const NLU_STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'at', 'by', 'with', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'can', 'could', 'would', 'should', 'will', 'shall',
  'may', 'might', 'must', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it',
  'this', 'that', 'these', 'those', 'and', 'or', 'but', 'if', 'please', 'want',
  'need', 'like', 'help', 'how', 'what', 'when', 'where', 'why', 'who',
]);

function auditIntentTrainingPhrases(intentSpec = {}, opts = {}) {
  const minPhrases = Number.isFinite(opts.minPhrases) ? opts.minPhrases : 20;
  const maxPhrases = Number.isFinite(opts.maxPhrases) ? opts.maxPhrases : 50;
  const maxKeywordRepetitionRatio = Number.isFinite(opts.maxKeywordRepetitionRatio)
    ? opts.maxKeywordRepetitionRatio
    : 0.6;

  const rawPhrases = Array.isArray(intentSpec.phrases)
    ? intentSpec.phrases
    : (Array.isArray(intentSpec.trainingPhrases) ? intentSpec.trainingPhrases : []);

  const texts = [];
  const distinctLower = new Set();
  const keywordCounts = new Map();
  const paramEntityMap = new Map();
  const annotationConflicts = [];
  let capitalizedCount = 0;
  let lowercaseStartCount = 0;

  for (let idx = 0; idx < rawPhrases.length; idx += 1) {
    const entry = rawPhrases[idx];
    const text = typeof entry === 'string'
      ? entry.trim()
      : String((entry && (entry.text || entry.phrase)) || '').trim();
    if (!text) continue;
    texts.push(text);
    distinctLower.add(text.toLowerCase());

    if (/^[A-Z]/.test(text)) capitalizedCount += 1;
    if (/^[a-z]/.test(text)) lowercaseStartCount += 1;

    const words = new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !NLU_STOPWORDS.has(w)),
    );
    for (const w of words) {
      keywordCounts.set(w, (keywordCounts.get(w) || 0) + 1);
    }

    const annotations = entry && typeof entry === 'object' && Array.isArray(entry.annotations)
      ? entry.annotations
      : [];
    for (const ann of annotations) {
      const paramId = String((ann && (ann.parameterId || ann.parameterName || ann.param)) || '').trim();
      const entityType = String((ann && (ann.entityType || ann.type)) || '').trim();
      if (!paramId || !entityType) continue;
      if (!paramEntityMap.has(paramId)) {
        paramEntityMap.set(paramId, entityType);
      } else if (paramEntityMap.get(paramId) !== entityType) {
        annotationConflicts.push({
          phraseIndex: idx,
          parameterId: paramId,
          expectedEntityType: paramEntityMap.get(paramId),
          actualEntityType: entityType,
          autoGenerated: Boolean(entry.autoGenerated || entry.autoTranslated),
        });
      }
    }
  }

  const distinctCount = distinctLower.size;
  const densityOk = distinctCount >= minPhrases && distinctCount <= maxPhrases;
  const capitalizationVaried = texts.length < 5 || (capitalizedCount > 0 && lowercaseStartCount > 0);

  const biasedKeywords = [];
  if (texts.length >= 5) {
    for (const [word, count] of keywordCounts.entries()) {
      const ratio = count / texts.length;
      if (ratio > maxKeywordRepetitionRatio) {
        biasedKeywords.push({ keyword: word, count, ratio: Number(ratio.toFixed(3)) });
      }
    }
  }
  biasedKeywords.sort((a, b) => b.ratio - a.ratio);

  const issues = [];
  if (!densityOk) {
    issues.push(
      distinctCount < minPhrases
        ? `Intent density too low (${distinctCount} distinct phrases; target ${minPhrases}-${maxPhrases}).`
        : `Intent density too high (${distinctCount} distinct phrases; target ${minPhrases}-${maxPhrases}).`,
    );
  }
  if (!capitalizationVaried) {
    issues.push('Training phrases lack capitalization variety (mix sentence-case and lowercase phrasing).');
  }
  if (biasedKeywords.length > 0) {
    issues.push(`Intent bias detected: primary keyword "${biasedKeywords[0].keyword}" repeats in ${(biasedKeywords[0].ratio * 100).toFixed(0)}% of phrases.`);
  }
  if (annotationConflicts.length > 0) {
    issues.push(`Semantic annotation inconsistency across ${annotationConflicts.length} phrase annotation(s).`);
  }

  return {
    intentName: intentSpec.intentName || intentSpec.displayName || 'unnamed-intent',
    valid: issues.length === 0,
    totalPhrases: texts.length,
    distinctPhrases: distinctCount,
    targetDensity: { min: minPhrases, max: maxPhrases },
    densityOk,
    capitalizationVaried,
    intentBiasDetected: biasedKeywords.length > 0,
    biasedKeywords,
    annotationConsistent: annotationConflicts.length === 0,
    annotationConflicts,
    issues,
  };
}

// -----------------------------------------------------------------------------
// 1.A & 1.B) Gemini 2.5 Playbook Prompt Builder & Post-RAG Wrapper Page Config
// -----------------------------------------------------------------------------
function buildPlaybookInstructionSpec(opts = {}) {
  const playbookName = opts.playbookName || 'EnterpriseCustomerResolutionPlaybook';
  const model = resolveDialogflowModel({
    task: opts.task || 'playbook',
    channel: opts.channel,
    model: opts.model,
  });
  const voiceRewriterModel = resolveDialogflowModel({ task: 'rewriter' });
  const goal = opts.goal
    || 'Resolve customer inquiries accurately while delegating all state-mutating transactions to validated deterministic Flows and webhooks.';
  const role = opts.role
    || 'Enterprise Conversational Agent operating under deterministic Flow + Playbook governance.';
  const wrapperPageName = opts.wrapperPageName || 'Informational Handling Page';
  const transactionalTools = Array.isArray(opts.transactionalTools) && opts.transactionalTools.length
    ? opts.transactionalTools
    : ['dfcx:process-refund', 'dfcx:confirm-appointment', 'dfcx:update-billing'];

  const steps = [
    `1. Classify the user turn: if the request is informational or policy/knowledge lookup, route to the sandboxed "${wrapperPageName}" (never invoke Vertex AI Search data stores globally).`,
    `2. Keep immediate informational follow-up questions anchored on "${wrapperPageName}" until the user explicitly confirms their question is answered.`,
    `3. For any transactional action (${transactionalTools.join(', ')}), NEVER promise or commit completion inside generative prompt output.`,
    '4. Invoke the deterministic fulfillment webhook tool first and wait for `external_auth_verified = true` and `thumbgate_blocked = false` before confirming any transaction.',
    `5. Isolate models by workload: run generative Playbook reasoning on \`${model}\` and route high-volume voice/rewriter turns to \`${voiceRewriterModel}\`.`,
  ];

  const renderedPrompt = [
    `# Playbook: ${playbookName}`,
    `Goal: ${goal}`,
    `Role: ${role}`,
    `Model Isolation: Playbook=${model} | Voice/Rewriter=${voiceRewriterModel}`,
    '',
    '## Execution Instructions',
    ...steps,
    '',
    '## Hard Guardrails',
    '- NEVER execute or confirm a refund, appointment, or account mutation without a verified webhook response (`external_auth_verified: true`).',
    `- NEVER attach Vertex AI Search data stores at the global agent root; invoke RAG only inside "${wrapperPageName}".`,
  ].join('\n');

  return {
    playbookName,
    consoleArchitecture: 'Google Conversational Agents Console (Flows + Playbooks)',
    modelIsolation: {
      playbookModel: model,
      voiceAndRewriterModel: voiceRewriterModel,
    },
    goal,
    role,
    wrapperPageName,
    transactionalTools,
    authorizationRule: {
      businessLogicInWebhookOnly: true,
      requireExternalValidationBeforeCommit: true,
    },
    steps,
    renderedPrompt,
  };
}

function buildPostRagWrapperPageConfig(opts = {}) {
  const pageName = opts.pageName || 'Informational Handling Page';
  const dataStoreId = opts.dataStoreId
    || 'projects/PROJECT_ID/locations/global/collections/default_collection/dataStores/enterprise-kb';
  const returnTargetPage = opts.returnTargetPage || 'START_PAGE';
  const maxFollowupTurns = Number.isFinite(opts.maxFollowupTurns) ? opts.maxFollowupTurns : 3;

  return {
    pageName,
    pattern: 'Post-RAG Wrapper Page',
    globalDataStoreEnabled: false,
    dataStoreScope: 'page-sandboxed',
    dataStoreConnections: [
      {
        dataStoreId,
        dataStoreType: opts.dataStoreType || 'UNSTRUCTURED',
        groundingConfidenceThreshold: opts.groundingConfidenceThreshold || 0.7,
      },
    ],
    entryFulfillment: {
      setParameterActions: [
        { parameter: 'rag_wrapper_page_active', value: true },
        { parameter: 'wrapper_page_exit_approved', value: false },
        { parameter: 'wrapper_page_followup_count', value: 0 },
      ],
    },
    followupHandling: {
      handleImmediateFollowupsOnPage: true,
      stayOnWrapperPage: true,
      maxFollowupTurns,
      preventTransactionDrift: true,
      blockedTransactionalTagsWhileActive: Array.from(DEFAULT_TRANSACTIONAL_TAGS),
    },
    transitionRoutes: [
      {
        description: 'Keep immediate RAG follow-up questions sandboxed on the Wrapper Page',
        condition: `$session.params.wrapper_page_followup_count < ${maxFollowupTurns} AND $session.params.wrapper_page_followup_complete != true`,
        targetPage: pageName,
        setParameterActions: [
          { parameter: 'rag_wrapper_page_active', value: true },
        ],
      },
      {
        description: 'Deterministic exit transition back to Flow after RAG follow-ups complete',
        intent: opts.exitIntent || 'intent.rag_followup_complete',
        condition: '$session.params.wrapper_page_followup_complete = true',
        targetPage: returnTargetPage,
        setParameterActions: [
          { parameter: 'rag_wrapper_page_active', value: false },
          { parameter: 'wrapper_page_exit_approved', value: true },
        ],
      },
    ],
  };
}

// -----------------------------------------------------------------------------
// 3.A, 3.B, 3.C) Operational Infrastructure & Testing:
// - SessionsClient Instance Recycling
// - Load Test Ramp-Up & Zero-Billing Test Doubles
// - Webhook Resilience with Exponential Backoff for 503 Service Unavailable
// -----------------------------------------------------------------------------
function createSessionsClientPool(opts = {}) {
  const instances = new Map();
  let createdCount = 0;
  let reuseCount = 0;
  const clientFactory = typeof opts.clientFactory === 'function'
    ? opts.clientFactory
    : (config) => ({
        config,
        createdAt: Date.now(),
        closed: false,
        async detectIntent(request) {
          if (typeof opts.detectIntentImpl === 'function') {
            return opts.detectIntentImpl(request, config);
          }
          return [{ queryResult: { responseMessages: [], parameters: {} } }];
        },
        async close() {
          this.closed = true;
        },
      });

  function getKey(config = {}) {
    const location = String(config.location || config.region || 'us-central1').trim();
    const apiEndpoint = String(config.apiEndpoint || `${location}-dialogflow.googleapis.com`).trim();
    const projectId = String(config.projectId || 'default-project').trim();
    return `${projectId}:${location}:${apiEndpoint}`;
  }

  function acquire(config = {}) {
    const key = getKey(config);
    if (instances.has(key)) {
      reuseCount += 1;
      return instances.get(key);
    }
    const location = String(config.location || config.region || 'us-central1').trim();
    const apiEndpoint = String(config.apiEndpoint || `${location}-dialogflow.googleapis.com`).trim();
    const client = clientFactory(Object.assign({}, config, { location, apiEndpoint }));
    instances.set(key, client);
    createdCount += 1;
    return client;
  }

  async function closeAll() {
    const clients = Array.from(instances.values());
    instances.clear();
    for (const c of clients) {
      if (c && typeof c.close === 'function') {
        try { await c.close(); } catch (_) { /* ignore */ }
      }
    }
  }

  function getStats() {
    return {
      activeInstances: instances.size,
      createdCount,
      reuseCount,
      keys: Array.from(instances.keys()),
    };
  }

  return { acquire, closeAll, getStats };
}

const defaultSessionsClientPool = createSessionsClientPool();

function evaluateLoadTestRamp(profile = {}) {
  const currentRps = Number(profile.currentRps || 0);
  const previousRps = Number(profile.previousRps || 0);
  const elapsedSeconds = Number(profile.elapsedSeconds || 0);
  const minRampSeconds = Number.isFinite(profile.minRampSeconds) ? profile.minRampSeconds : 60;
  const maxStepMultiplier = Number.isFinite(profile.maxStepMultiplier) ? profile.maxStepMultiplier : 2.0;
  const maxUnrampedStartRps = Number.isFinite(profile.maxUnrampedStartRps) ? profile.maxUnrampedStartRps : 10;
  const useTestDouble = Boolean(profile.useTestDouble);

  const issues = [];
  if (previousRps <= 0 && currentRps > maxUnrampedStartRps && elapsedSeconds < minRampSeconds) {
    issues.push(`Sharp initial traffic spike (${currentRps} RPS at ${elapsedSeconds}s; start <= ${maxUnrampedStartRps} RPS and ramp over >= ${minRampSeconds}s).`);
  }
  if (previousRps > 0 && currentRps > previousRps * maxStepMultiplier) {
    issues.push(`Step increase too steep (${previousRps} -> ${currentRps} RPS exceeds ${maxStepMultiplier}x step limit).`);
  }
  if (currentRps >= 25 && !useTestDouble) {
    issues.push('High-volume load test is not using test doubles; enable createDfcxTestDouble to avoid standard Dialogflow/LLM billing spikes.');
  }

  return {
    safe: issues.length === 0,
    currentRps,
    previousRps,
    elapsedSeconds,
    useTestDouble,
    issues,
  };
}

function createDfcxTestDouble(fixtures = {}) {
  const responsesByTag = fixtures.responsesByTag || {};
  const defaultText = fixtures.defaultText || '[TestDouble] Simulated Dialogflow CX response ($0 billing footprint).';
  let calls = 0;

  async function fulfill(reqBody) {
    calls += 1;
    const action = mapDfcxToAction(reqBody);
    const canned = responsesByTag[action.tag];
    const msgText = typeof canned === 'string' ? canned : defaultText;
    return {
      fulfillment_response: { messages: [{ text: { text: [msgText] } }] },
      fulfillmentResponse: { messages: [{ text: { text: [msgText] } }] },
      session_info: {
        parameters: Object.assign({}, action.toolInput, {
          thumbgate_test_double: true,
          thumbgate_simulated_tag: action.tag,
        }),
      },
      sessionInfo: {
        parameters: Object.assign({}, action.toolInput, {
          thumbgate_test_double: true,
          thumbgate_simulated_tag: action.tag,
        }),
      },
    };
  }

  async function detectIntent(request = {}) {
    calls += 1;
    return [{
      queryResult: {
        text: request.text || '',
        responseMessages: [{ text: { text: [defaultText] } }],
        parameters: { thumbgate_test_double: true },
      },
    }];
  }

  return {
    fulfill,
    detectIntent,
    getCallCount() { return calls; },
  };
}

// 3.C) Webhook Resilience:
// Dialogflow's native client library does not automatically retry failed webhook
// attempts. Explicitly retry temporary 503 Service Unavailable (and 502/504)
// errors with exponential backoff.
async function fetchWithExponentialBackoff(url, init = {}, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) throw new Error('no fetch implementation available');

  const maxRetries = Number.isFinite(opts.maxRetries) ? opts.maxRetries : 3;
  const baseDelayMs = Number.isFinite(opts.baseDelayMs) ? opts.baseDelayMs : 100;
  const maxDelayMs = Number.isFinite(opts.maxDelayMs) ? opts.maxDelayMs : 2000;
  const retryableStatuses = new Set(opts.retryableStatuses || [503, 502, 504]);
  const sleepImpl = typeof opts.sleepImpl === 'function'
    ? opts.sleepImpl
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let attempt = 0;
  let lastError = null;
  while (attempt <= maxRetries) {
    try {
      const res = await fetchImpl(url, init);
      if (res && !retryableStatuses.has(Number(res.status))) {
        return res;
      }
      if (attempt === maxRetries) {
        return res;
      }
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) {
        throw lastError;
      }
    }
    const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
    attempt += 1;
    if (typeof opts.onRetry === 'function') {
      try { opts.onRetry({ attempt, delayMs: delay, url }); } catch (_) { /* ignore */ }
    }
    await sleepImpl(delay);
  }
  throw lastError || new Error('Webhook retry exhausted');
}

module.exports = {
  DEFAULT_PLAYBOOK_MODEL,
  DEFAULT_VOICE_REWRITER_MODEL,
  DEFAULT_TRANSACTIONAL_TAGS,
  resolveDialogflowModel,
  isTransactionalTag,
  mapDfcxToAction,
  evaluateWrapperPageIsolation,
  evaluateAuthorizationRule,
  evaluateBannedPhrases,
  evaluateDfcxFulfillment,
  buildBlockResponse,
  annotateAllowed,
  guardDfcxWebhook,
  createHttpHandler,
  auditIntentTrainingPhrases,
  buildPlaybookInstructionSpec,
  buildPostRagWrapperPageConfig,
  createSessionsClientPool,
  defaultSessionsClientPool,
  evaluateLoadTestRamp,
  createDfcxTestDouble,
  fetchWithExponentialBackoff,
  // exposed for tests
  stableStringify,
};
