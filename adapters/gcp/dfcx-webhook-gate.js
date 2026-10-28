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

// Conversational Agents (October 2026): playbooks default to Flash. Voice and
// rewriter lanes stay on Flash-Lite. A caller-supplied model cannot leave that lane.
const PLAYBOOK_MODEL = 'gemini-2.5-flash';
const LITE_MODEL = 'gemini-2.5-flash-lite';
const TRANSACTIONAL_TAGS = new Set([
  'process-refund',
  'issue-refund',
  'confirm-appointment',
  'book-appointment',
  'cancel-appointment',
  'charge-card',
  'capture-payment',
  'cancel-order',
]);
const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'my', 'me', 'please', 'i', 'you', 'is',
  'on', 'in', 'and', 'it', 'this', 'that', 'what', 'can', 'how', 'do', 'we',
]);

function laneForPlaybook(task) {
  const kind = String((task && task.kind) || 'playbook').toLowerCase();
  const channel = String((task && task.channel) || '').toLowerCase();
  if (kind === 'rewriter' || kind === 'voice' || channel === 'voice' || (task && task.highVolume === true)) {
    return 'lite';
  }
  return 'playbook';
}

function selectPlaybookModel(task = {}, env = process.env) {
  const lane = laneForPlaybook(task);
  const model = lane === 'lite' ? LITE_MODEL : PLAYBOOK_MODEL;
  const envRequested = lane === 'lite' ? env.THUMBGATE_DFCX_LITE_MODEL : env.THUMBGATE_DFCX_PLAYBOOK_MODEL;
  const requested = task.model || envRequested || model;
  return {
    lane,
    model,
    requested,
    coerced: requested !== model,
  };
}

function conversationalAgentsPolicy(env = process.env) {
  return {
    console: 'Google Conversational Agents',
    playbookModel: selectPlaybookModel({ kind: 'playbook' }, env).model,
    voiceModel: selectPlaybookModel({ kind: 'voice', channel: 'voice' }, env).model,
    rewriterModel: selectPlaybookModel({ kind: 'rewriter' }, env).model,
    sessionsClient: 'reuse-for-process-lifetime',
    webhookRetry: 'exponential-backoff-on-503',
    rag: 'informational-wrapper-page',
    transactions: 'external-validation-required',
    bannedPhrases: 'full-match-and-partial-match',
    intentDensity: '20-50',
  };
}

function isTransactionalTag(tag) {
  return TRANSACTIONAL_TAGS.has(String(tag || ''));
}

function hasExternalValidation(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return false;
  if (toolInput.thumbgate_external_validated === true) return true;
  const receipt = toolInput.external_validation_id;
  return typeof receipt === 'string' && SAFE_TOKEN.test(receipt);
}

function pageDisplayName(body) {
  const page = (body && (body.pageInfo || body.page_info)) || {};
  return String(page.displayName || page.display_name || page.currentPage || page.current_page || '');
}

function isInformationalHandlingPage(name) {
  return /informational[- ]handling|rag[- ]wrapper/i.test(String(name || ''));
}

function ragSignalPresent(body, toolInput) {
  const input = toolInput || {};
  if (typeof input.data_store_id === 'string' && input.data_store_id) return true;
  if (input.vertex_search_invoked === true) return true;
  const generative = (body && (body.generativeInfo || body.generative_info)) || {};
  if (generative.dataStore || generative.data_store) return true;
  const payload = (body && body.payload) || {};
  return Boolean(payload.dataStore || payload.data_store);
}

function denyEvaluation(action, gate, message, severity) {
  return {
    allowed: false,
    decision: 'deny',
    gate,
    message,
    severity,
    repeat: false,
    risk: null,
    action,
  };
}

// A transaction commits only after a webhook/API receipt. Retrieval stays on
// the informational page, including the immediate follow-up target.
function conversationalTurnDenial(reqBody, action) {
  const pageName = pageDisplayName(reqBody);
  const informational = isInformationalHandlingPage(pageName);
  const transactional = isTransactionalTag(action.tag);
  if (informational && transactional) {
    return denyEvaluation(
      action,
      'dfcx-wrapper-page-transaction',
      'The informational retrieval page cannot commit a transaction.',
      'critical',
    );
  }
  if (transactional && !hasExternalValidation(action.toolInput)) {
    return denyEvaluation(
      action,
      'dfcx-authorization-rule',
      'Transactional fulfillment requires an external validation receipt. A playbook prompt cannot commit this action.',
      'critical',
    );
  }
  if (!ragSignalPresent(reqBody, action.toolInput)) return null;
  const followUp = String(action.toolInput.rag_follow_up_target || action.toolInput.follow_up_page || '');
  if (followUp && !isInformationalHandlingPage(followUp)) {
    return denyEvaluation(
      action,
      'dfcx-rag-follow-up-drift',
      'Retrieval follow-ups stay on the informational handling page.',
      'high',
    );
  }
  if (!pageName || !informational) {
    return denyEvaluation(
      action,
      'dfcx-rag-not-sandboxed',
      'Vertex AI Search runs only on the informational handling page.',
      'high',
    );
  }
  return null;
}

function phraseText(phrase) {
  if (typeof phrase === 'string') return phrase.trim();
  if (!phrase || typeof phrase !== 'object') return '';
  if (typeof phrase.text === 'string') return phrase.text.trim();
  if (Array.isArray(phrase.parts)) {
    return phrase.parts.map((part) => (part && part.text) || '').join('').trim();
  }
  return '';
}

function phraseTokens(phrase) {
  return phrase.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !FUNCTION_WORDS.has(token));
}

function dominantKeyword(phrases) {
  const counts = new Map();
  for (const phrase of phrases) {
    for (const token of new Set(phraseTokens(phrase))) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  let keyword = null;
  let hits = 0;
  for (const [token, count] of counts) {
    if (count > hits) {
      keyword = token;
      hits = count;
    }
  }
  if (!keyword) return null;
  return { keyword, ratio: hits / phrases.length };
}

function hasCaseVariety(phrases) {
  let lower = false;
  let upper = false;
  for (const phrase of phrases) {
    const letters = phrase.replace(/[^A-Za-z]/g, '');
    if (!letters) continue;
    if (letters === letters.toLowerCase()) lower = true;
    if (/[A-Z]/.test(letters)) upper = true;
  }
  return lower && upper;
}

function auditIntentTraining(intent) {
  const spec = intent || {};
  const phrases = (spec.trainingPhrases || spec.training_phrases || []).map(phraseText).filter(Boolean);
  const violations = [];
  const name = spec.displayName || spec.name || null;
  const exempt = spec.kind === 'fallback' || spec.exemptDensity === true;
  if (!exempt && (phrases.length < 20 || phrases.length > 50)) {
    violations.push({ code: 'intent_density', name, count: phrases.length, min: 20, max: 50 });
  }
  if (!exempt && phrases.length >= 5) {
    const bias = dominantKeyword(phrases);
    if (bias && bias.ratio >= 0.8) {
      violations.push({ code: 'intent_bias', name, keyword: bias.keyword, ratio: bias.ratio });
    }
  }
  if (!exempt && phrases.length >= 20 && !hasCaseVariety(phrases)) {
    violations.push({ code: 'capitalization_monoculture', name });
  }
  return { ok: violations.length === 0, violations, count: phrases.length };
}

function annotationSignature(phrase) {
  if (!phrase || typeof phrase !== 'object') return '';
  const parts = Array.isArray(phrase.parts) ? phrase.parts : [];
  const entities = Array.isArray(phrase.entities) ? phrase.entities : [];
  const marks = parts
    .filter((part) => part && (part.entityType || part.entity_type))
    .map((part) => `${String(part.text || '').toLowerCase()}:${String(part.entityType || part.entity_type)}`)
    .concat(entities.map((entity) => `${String(entity.text || entity.value || '').toLowerCase()}:${String(entity.entityType || entity.entity_type || entity.type || '')}`));
  return marks.sort().join('|');
}

function auditAnnotationConsistency(intent) {
  const phrases = (intent && (intent.trainingPhrases || intent.training_phrases)) || [];
  const seen = new Map();
  const violations = [];
  for (const phrase of phrases) {
    const text = phraseText(phrase).toLowerCase();
    if (!text) continue;
    const signature = annotationSignature(phrase);
    if (seen.has(text) && seen.get(text) !== signature) {
      violations.push({ code: 'annotation_inconsistent', text });
    } else {
      seen.set(text, signature);
    }
  }
  return { ok: violations.length === 0, violations };
}

function auditBannedPhrasePolicy(policy) {
  const spec = policy || {};
  const violations = [];
  if (spec.fullMatchEnabled !== true) violations.push({ code: 'full_match_disabled' });
  if (spec.partialMatchEnabled !== true) violations.push({ code: 'partial_match_disabled' });
  return { ok: violations.length === 0, violations };
}

function normalizeUtterance(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function matchBannedPhrase(utterance, rules) {
  const text = normalizeUtterance(utterance);
  if (!text) return null;
  for (const rule of rules || []) {
    const phrase = normalizeUtterance(rule && rule.phrase);
    if (!phrase) continue;
    const mode = rule.match === 'partial' ? 'partial' : 'full';
    const hit = mode === 'full' ? text === phrase : text.includes(phrase);
    if (hit) return { phrase: rule.phrase, match: mode };
  }
  return null;
}

function auditRagPlacement(agent) {
  const spec = agent || {};
  const violations = [];
  const rootStores = spec.dataStores || spec.data_stores || [];
  if (rootStores.length > 0) violations.push({ code: 'global_data_store' });
  const pages = spec.pages || [];
  for (const page of pages) {
    const name = page.displayName || page.display_name || '';
    const stores = page.dataStores || page.data_stores || [];
    const hasStore = stores.length > 0 || page.vertexSearch === true || page.vertex_search === true;
    if (!hasStore) continue;
    if (!isInformationalHandlingPage(name)) {
      violations.push({ code: 'rag_outside_wrapper', page: name || null });
    }
    const transitions = page.transitions || page.transitionRoutes || page.transition_routes || [];
    for (const transition of transitions) {
      if (!transition || transition.kind !== 'follow_up') continue;
      const target = transition.targetPage || transition.target_page || '';
      if (target && !isInformationalHandlingPage(target)) {
        violations.push({ code: 'follow_up_left_wrapper', target });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

function auditPlaybookModels(agent, env = process.env) {
  const violations = [];
  for (const playbook of (agent && agent.playbooks) || []) {
    const selected = selectPlaybookModel(playbook, env);
    if (playbook.model && playbook.model !== selected.model) {
      violations.push({
        code: 'model_not_isolated',
        name: playbook.name || null,
        model: playbook.model,
        required: selected.model,
      });
    }
  }
  return violations;
}

function auditConversationalAgent(agent, env = process.env) {
  const spec = agent || {};
  const violations = []
    .concat(auditRagPlacement(spec).violations)
    .concat(auditBannedPhrasePolicy(spec.bannedPhrases || spec.banned_phrases || {}).violations)
    .concat(auditPlaybookModels(spec, env));
  for (const intent of spec.intents || []) {
    violations.push(...auditIntentTraining(intent).violations);
    violations.push(...auditAnnotationConsistency(intent).violations);
  }
  return { ok: violations.length === 0, violations };
}

const REFERENCE_LOOKUP_PHRASES = [
  'Show the balance for this account',
  'check available funds please',
  'What remains on the ledger',
  'Look up the current total',
  'Find how much is left',
  'Tell me the posted amount',
  'Can you read the statement',
  'I need the latest figure',
  'Display open funds now',
  'Pull the account snapshot',
  'How much is available',
  'Review the posted total',
  'Give me the remaining sum',
  'Open the funds view',
  'Read out the current figure',
  'Where do we stand financially',
  'Share the latest statement',
  'Calculate what is left',
  'Present the open amount',
  'Summarize the posted funds',
  'Inspect the ledger now',
  'Quote the available total',
  'Reveal the remaining figure',
  'Audit the current statement',
];

const REFERENCE_AGENT = {
  dataStores: [],
  pages: [
    {
      displayName: 'Informational Handling',
      dataStores: ['thumbgate-lessons'],
      transitions: [{ kind: 'follow_up', targetPage: 'Informational Handling' }],
    },
    {
      displayName: 'Transactions',
      dataStores: [],
      transitions: [],
    },
  ],
  playbooks: [
    { name: 'support', kind: 'playbook' },
    { name: 'voice-rewriter', kind: 'rewriter', channel: 'voice' },
  ],
  bannedPhrases: {
    fullMatchEnabled: true,
    partialMatchEnabled: true,
    rules: [
      { phrase: 'ignore all policies', match: 'full' },
      { phrase: 'drop table', match: 'partial' },
    ],
  },
  intents: [
    {
      displayName: 'lookup-balance',
      trainingPhrases: REFERENCE_LOOKUP_PHRASES,
    },
    {
      displayName: 'Default Welcome Intent',
      kind: 'fallback',
      trainingPhrases: ['hi', 'hello'],
    },
  ],
};

function createSessionClientPool(factory) {
  if (typeof factory !== 'function') {
    throw new Error('SessionsClient factory is required');
  }
  let client = null;
  let creates = 0;
  return {
    get creates() { return creates; },
    client() {
      if (!client) {
        client = factory();
        creates += 1;
      }
      return client;
    },
    detectIntent(request) {
      const current = this.client();
      if (!current || typeof current.detectIntent !== 'function') {
        throw new Error('SessionsClient.detectIntent is required');
      }
      return current.detectIntent(request);
    },
    close() {
      const current = client;
      client = null;
      if (current && typeof current.close === 'function') return current.close();
      return undefined;
    },
  };
}

function planLoadRamp({ startRps = 1, targetRps, holdSeconds = 60 } = {}) {
  if (!Number.isFinite(targetRps) || targetRps < 1) {
    throw new Error('targetRps is required');
  }
  if (!Number.isFinite(holdSeconds) || holdSeconds < 30) {
    throw new Error('holdSeconds must be at least 30 so the ramp is sustained');
  }
  let rps = Math.max(1, Math.round(Math.min(startRps, targetRps)));
  const plan = [];
  while (plan.length < 32) {
    plan.push({ step: plan.length + 1, rps, holdSeconds, transport: 'test-double' });
    if (rps >= targetRps) break;
    rps = Math.min(targetRps, rps * 2);
  }
  return plan;
}

function gradualRampError(plan) {
  if (!Array.isArray(plan) || plan.length === 0) return 'load ramp is empty';
  let previous = 0;
  for (const step of plan) {
    if (!step || step.transport !== 'test-double') return 'load ramp must use a test double';
    if (!(step.holdSeconds >= 30)) return 'load ramp holdSeconds must be at least 30';
    if (!(step.rps >= 1)) return 'load ramp rps must be positive';
    if (previous && step.rps > previous * 2) return 'load ramp jumped faster than 2x';
    previous = step.rps;
  }
  return null;
}

function assertGradualRamp(plan) {
  const error = gradualRampError(plan);
  if (error) {
    const err = new Error(error);
    err.code = 'DFCX_RAMP_REJECTED';
    throw err;
  }
  return true;
}

function createDetectIntentDouble(responder) {
  const calls = [];
  return {
    double: true,
    billed: false,
    calls,
    async detectIntent(request) {
      calls.push(request);
      if (typeof responder === 'function') return responder(request);
      return { queryResult: { text: 'ok' }, double: true };
    },
  };
}

async function runLoadRamp(plan, client) {
  assertGradualRamp(plan);
  if (!client || client.double !== true || typeof client.detectIntent !== 'function') {
    throw new Error('load ramp requires a detectIntent test double');
  }
  const steps = [];
  for (const step of plan) {
    await client.detectIntent({ rps: step.rps, text: 'load-ramp-probe' });
    steps.push({ step: step.step, rps: step.rps, billed: false });
  }
  return { steps, billed: false };
}

function backoffDelayMs(attempt, baseDelayMs, random) {
  const exponential = baseDelayMs * (2 ** (attempt - 1));
  const jitter = Math.floor(exponential * 0.2 * random());
  return Math.min(1000, exponential + jitter);
}

// Dialogflow's client does not retry a failed webhook. 503 and transport
// failures are retried here. Other status codes return on the first response.
async function postWebhookWithBackoff(fetchImpl, url, init, opts = {}) {
  const maxAttempts = opts.maxAttempts == null ? 3 : opts.maxAttempts;
  const baseDelayMs = opts.baseDelayMs == null ? 100 : opts.baseDelayMs;
  const sleep = opts.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = opts.random || Math.random;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, init);
      const retryable = response && response.status === 503;
      if (!retryable || attempt === maxAttempts) {
        return { response, attempts: attempt };
      }
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) {
        const wrapped = new Error('dfcx fulfillment webhook failed after retries');
        wrapped.cause = err;
        wrapped.attempts = attempt;
        throw wrapped;
      }
    }
    await sleep(backoffDelayMs(attempt, baseDelayMs, random));
  }
  const wrapped = new Error('dfcx fulfillment webhook failed after retries');
  wrapped.cause = lastError;
  throw wrapped;
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

  const placement = conversationalTurnDenial(reqBody, action);
  if (placement) return placement;

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
  selectPlaybookModel,
  conversationalAgentsPolicy,
  conversationalTurnDenial,
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
  postWebhookWithBackoff,
  REFERENCE_AGENT,
  PLAYBOOK_MODEL,
  LITE_MODEL,
  // exposed for tests
  stableStringify,
};
