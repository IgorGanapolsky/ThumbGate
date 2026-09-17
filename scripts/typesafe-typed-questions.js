#!/usr/bin/env node
'use strict';

/**
 * TypeSafe typed-question FORMAT steal — not a product clone.
 *
 * Sources (signed-in console 2026-09-17, igor@igorganapolsky.com):
 *   https://console.typesafe.ai/hook
 *   https://console.typesafe.ai/playground (Support agent audit example)
 *   https://docs.typesafe.ai/cookbooks/llm_guardrails.md
 *   https://docs.typesafe.ai/patterns/confidence-routing.md
 *
 * Transfers (process only):
 *   1. Atomic typed questions (noul / choice / score) over one tool-call state
 *   2. Independent parallel evaluation — questions cannot see each other
 *   3. Code owns route() (pass | review | block) — the model does not emit the verdict
 *   4. Confidence is a second axis; low confidence on high-stakes fails closed
 *
 * Does NOT install typesafe-sdk, clone Jev, or wire an LLM adjudicator
 * (#3690 / #3687, ECI pause) as the PreToolUse gate. Deterministic matchers
 * own route(). Optional `--live` shadows the same battery against
 * POST /v1/systemone (Jev) for calibration — never as the verdict.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SOURCE_URLS = Object.freeze([
  'https://console.typesafe.ai/hook',
  'https://docs.typesafe.ai/api',
  'https://docs.typesafe.ai/cookbooks/llm_guardrails.md',
  'https://docs.typesafe.ai/patterns/confidence-routing.md',
]);

const SYSTEMONE_URL = 'https://api.typesafe.ai/v1/systemone';
const SHADOW_NOUL_DELTA = 0.4;

const TYPED_KINDS = Object.freeze(['noul', 'choice', 'score']);
const ROUTE_PRECEDENCE = Object.freeze(['block', 'review', 'pass']);
const ROUTE_ACTIONS = Object.freeze(['block', 'review', 'pass']);
const WRITE_TOOLS = Object.freeze(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']);

const POLICIES = Object.freeze({
  strict: { reviewThreshold: 0.35, actionThreshold: 0.7, severityBlock: 2 },
  permissive: { reviewThreshold: 0.35, actionThreshold: 0.85, severityBlock: 2 },
});

const HAZARD_ACTION = Object.freeze({
  secret_exfil: 'block',
  destructive: 'block',
  outbound_send: 'block',
  guardrail_tamper: 'block',
  clone_jev: 'block',
});

const CLONE_RE =
  /\b(typesafe-sdk|@typesafe\/|api\.typesafe\.ai|clone\s+jev|install\s+jev|llm[- ]adjudicat|wire\s+jev\s+as\s+(?:the\s+)?gate)\b/i;

const DEFAULT_BATTERY = Object.freeze({
  secret_exfil: {
    type: 'noul',
    instructions: 'This tool call exfiltrates or writes secrets, keys, or credentials.',
    criteria: {
      true: 'The call reads, prints, posts, or commits secret material',
      false: 'The call does not handle secret material',
    },
    matcher:
      'sk_live_|AKIA[0-9A-Z]{16}|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|aws_secret_access_key|ghp_[A-Za-z0-9]{20,}|xox[baprs]-',
    stakes: 'high',
  },
  destructive: {
    type: 'noul',
    instructions: 'This tool call is a destructive git or filesystem action.',
    criteria: {
      true: 'Force-push, hard reset, or rm -rf of a root/home path',
      false: 'No destructive rewrite or wipe',
    },
    matcher: 'git\\s+push\\s+(?:[^\\n]*\\s)?(?:--force|-f)(?:\\s|$)|git\\s+reset\\s+--hard|rm\\s+-rf\\s+[/~]',
    warnMatcher: 'git\\s+add\\s+(-A|--all)|rm\\s+-rf\\s+\\.',
    stakes: 'high',
  },
  outbound_send: {
    type: 'noul',
    instructions: 'This tool call sends outbound email or a public message as the operator.',
    criteria: {
      true: 'A send/dispatch tool is invoked',
      false: 'Draft-only or no outbound send',
    },
    matcher: 'gmail.*\\bsend\\b|send_email|messages\\.send|\\bsmtp\\b.*\\bsend\\b|send_draft',
    stakes: 'high',
  },
  guardrail_tamper: {
    type: 'noul',
    instructions: 'This tool call edits ThumbGate gates, prevention rules, or the spend guard.',
    criteria: {
      true: 'A gate, prevention-rule, or spend-guard file is being rewritten',
      false: 'No guardrail file is in the write set',
    },
    matcher: 'config/gates|prevention-rules\\.md|gate-templates\\.json|thumbgate-spend-guard',
    writeTools: WRITE_TOOLS,
    writeCommandMatcher: '(?:^|[\\s;|&])(?:tee|rm|mv|cp|sed\\s+-i|>|>>)',
    stakes: 'high',
  },
  clone_jev: {
    type: 'noul',
    instructions: 'This tool call installs TypeSafe/Jev or an LLM adjudicator as the PreToolUse gate.',
    criteria: {
      true: 'typesafe-sdk, api.typesafe.ai, Jev-as-gate, or LLM adjudication is being wired',
      false: 'Deterministic gates stay in charge',
    },
    matcher:
      'typesafe-sdk|@typesafe/|api\\.typesafe\\.ai|clone\\s+jev|llm[- ]adjudicat|jev-latest.*pretooluse|pretooluse.*jev',
    stakes: 'high',
  },
  hazard_family: {
    type: 'choice',
    instructions: 'Which hazard family does this tool call belong to?',
    criteria: {
      none: 'No listed hazard matched',
      secret: 'Secret exfiltration',
      destructive: 'Destructive git or filesystem',
      outbound: 'Outbound send',
      tamper: 'Guardrail tamper',
      clone: 'TypeSafe/Jev/LLM-adjudicator clone',
    },
  },
  severity: {
    type: 'score',
    instructions: 'How much harm would complying with this tool call do?',
    criteria: [
      'None: ordinary safe call',
      'Mild: warn-level match, no hard floor',
      'Serious: default hard-block family',
      'Severe: secret exfil or guardrail tamper',
    ],
  },
});

const RAIL_MAP = Object.freeze([
  { typesafe: 'noul (one hazard each)', thumbgate: 'existing secret / destructive / outbound / tamper matchers' },
  { typesafe: 'choice over a closed set', thumbgate: 'hazard_family composed in code from which noul fired' },
  { typesafe: 'score rubric', thumbgate: 'severity 0–3 from the same matchers' },
  { typesafe: 'route() in application code', thumbgate: 'pass | review | block — never a model-emitted verdict' },
  { typesafe: 'confidence as a second axis', thumbgate: 'warn-level noul=0.55 → review; high-stakes + severity≥2 → block' },
  { typesafe: 'Jev / typesafe-sdk / System One API', thumbgate: 'refused (ECI; #3690/#3687 LLM adjudicator parked)' },
]);

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function readText(filePath) {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) {
    const err = new Error(`file not found: ${filePath}`);
    err.code = 'ENOENT';
    throw err;
  }
  return fs.readFileSync(filePath, 'utf8');
}

function flattenState(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  const parts = [JSON.stringify(payload)];
  if (payload.tool_name || payload.toolName) {
    parts.push(String(payload.tool_name || payload.toolName));
  }
  const input = payload.tool_input || payload.toolInput || {};
  if (input && typeof input === 'object') {
    for (const key of ['command', 'file_path', 'path', 'content', 'prompt', 'url']) {
      if (input[key] != null) parts.push(String(input[key]));
    }
  }
  if (payload.command) parts.push(String(payload.command));
  return parts.join('\n');
}

function compileMatcher(source) {
  if (!source) return null;
  try {
    return new RegExp(source, 'i');
  } catch {
    return null;
  }
}

function toolNameOf(payload) {
  return String((payload && (payload.tool_name || payload.toolName)) || '').trim();
}

function commandOf(payload) {
  const input = (payload && (payload.tool_input || payload.toolInput)) || {};
  return String((input && input.command) || (payload && payload.command) || '');
}

function isWriteCapable(question, payload) {
  const allowed = Array.isArray(question.writeTools) ? question.writeTools : null;
  if (!allowed || allowed.length === 0) return true;
  const name = toolNameOf(payload);
  const hit = allowed.some((tool) => String(tool).toLowerCase() === name.toLowerCase());
  if (!hit) return false;
  if (name.toLowerCase() === 'bash' && question.writeCommandMatcher) {
    const re = compileMatcher(question.writeCommandMatcher);
    if (re && !re.test(commandOf(payload))) return false;
  }
  return true;
}

function noulFromMatchers(blob, question, payload) {
  if (!isWriteCapable(question, payload || {})) {
    return { noul: 0, band: 'pass' };
  }
  const hard = compileMatcher(question.matcher);
  const warn = compileMatcher(question.warnMatcher);
  if (hard && hard.test(blob)) return { noul: 1, band: 'action' };
  if (warn && warn.test(blob)) return { noul: 0.55, band: 'review' };
  return { noul: 0, band: 'pass' };
}

function actionForNoul(id, question) {
  if (HAZARD_ACTION[id]) return HAZARD_ACTION[id];
  const action = String((question && question.action) || '').toLowerCase();
  if (ROUTE_ACTIONS.includes(action)) return action;
  return null;
}

function validateQuestion(id, question) {
  const errors = [];
  if (!question || typeof question !== 'object') {
    errors.push({ id: 'malformed_question', questionId: id, message: `Question ${id} is not an object.` });
    return errors;
  }
  const type = String(question.type || '').toLowerCase();
  if (!TYPED_KINDS.includes(type)) {
    errors.push({
      id: 'freeform_question',
      questionId: id,
      message: `Question ${id} type=${question.type || '(missing)'} is not noul|choice|score. Free-form judges are refused.`,
    });
    return errors;
  }
  if (!question.instructions) {
    errors.push({ id: 'missing_instructions', questionId: id, message: `Question ${id} is missing instructions.` });
  }
  if (type === 'noul') {
    if (actionForNoul(id, question) == null) {
      errors.push({
        id: 'noul_without_route_action',
        questionId: id,
        message: `Noul ${id} has no route action. Use a built-in hazard id or set action=block|review|pass.`,
      });
    }
    const c = question.criteria || {};
    if (c.true == null || c.false == null) {
      errors.push({
        id: 'noul_criteria_shape',
        questionId: id,
        message: `Noul ${id} needs criteria.true and criteria.false.`,
      });
    }
  }
  if (type === 'choice') {
    const c = question.criteria;
    if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).length < 2) {
      errors.push({
        id: 'choice_criteria_shape',
        questionId: id,
        message: `Choice ${id} needs a map of at least two options.`,
      });
    }
  }
  if (type === 'score') {
    if (!Array.isArray(question.criteria) || question.criteria.length < 2) {
      errors.push({
        id: 'score_criteria_shape',
        questionId: id,
        message: `Score ${id} needs an ordered criteria array of at least two levels.`,
      });
    }
  }
  return errors;
}

function parseBattery(raw) {
  if (raw == null || raw === '') {
    return { ok: true, battery: { ...DEFAULT_BATTERY }, error: null };
  }
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, battery: null, error: 'battery_parse_error' };
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, battery: null, error: 'battery_shape_error' };
  }
  const questions = data.questions && typeof data.questions === 'object' ? data.questions : data;
  if (!questions || typeof questions !== 'object' || Array.isArray(questions) || Object.keys(questions).length === 0) {
    return { ok: false, battery: null, error: 'empty_battery' };
  }
  return { ok: true, battery: questions, error: null };
}

function parsePayload(raw) {
  if (raw == null || raw === '') return { ok: true, payload: {}, error: null };
  if (typeof raw === 'object') return { ok: true, payload: raw, error: null };
  try {
    return { ok: true, payload: JSON.parse(raw), error: null };
  } catch {
    return { ok: true, payload: { command: String(raw) }, error: null };
  }
}

function composeHazardFamily(nouls) {
  if ((nouls.secret_exfil || 0) >= 0.7) return 'secret';
  if ((nouls.guardrail_tamper || 0) >= 0.7) return 'tamper';
  if ((nouls.clone_jev || 0) >= 0.7) return 'clone';
  if ((nouls.outbound_send || 0) >= 0.7) return 'outbound';
  if ((nouls.destructive || 0) >= 0.7) return 'destructive';
  if ((nouls.destructive || 0) >= 0.35) return 'destructive';
  return 'none';
}

function composeSeverity(nouls) {
  if ((nouls.secret_exfil || 0) >= 0.7 || (nouls.guardrail_tamper || 0) >= 0.7) return 3;
  if ((nouls.clone_jev || 0) >= 0.7 || (nouls.outbound_send || 0) >= 0.7 || (nouls.destructive || 0) >= 0.7) {
    return 2;
  }
  const anyReview = Object.values(nouls).some((v) => Number(v) >= 0.35);
  return anyReview ? 1 : 0;
}

function route({ nouls, severity, policy, battery }) {
  const triggered = [];
  for (const [hazard, probability] of Object.entries(nouls)) {
    const action = actionForNoul(hazard, battery && battery[hazard]);
    if (!action || action === 'pass') continue;
    if (probability >= policy.actionThreshold) triggered.push(action);
    else if (probability >= policy.reviewThreshold) triggered.push('review');
  }
  if (severity >= policy.severityBlock) {
    for (let i = 0; i < triggered.length; i += 1) {
      if (triggered[i] === 'review') triggered[i] = 'block';
    }
    if (triggered.length === 0 && severity >= policy.severityBlock) triggered.push('block');
  }
  return ROUTE_PRECEDENCE.find((action) => triggered.includes(action)) || 'pass';
}

function evaluateBattery({ battery, blob, flags, payload }) {
  const nouls = {};
  const answers = {};
  const unevaluated = [];

  for (const [id, question] of Object.entries(battery)) {
    if (!question || typeof question !== 'object') continue;
    const type = String(question.type || '').toLowerCase();
    if (type === 'noul') {
      let result;
      if (flags.cloneJev && id === 'clone_jev') result = { noul: 1, band: 'action' };
      else if (flags.useTypesafeApi && id === 'clone_jev') result = { noul: 1, band: 'action' };
      else if (flags.llmAdjudicate && id === 'clone_jev') result = { noul: 1, band: 'action' };
      else if (question.matcher || question.warnMatcher) {
        result = noulFromMatchers(blob, question, payload);
      } else if (DEFAULT_BATTERY[id] && DEFAULT_BATTERY[id].matcher) {
        result = noulFromMatchers(blob, DEFAULT_BATTERY[id], payload);
      } else {
        unevaluated.push(id);
        result = { noul: null, band: 'unevaluated' };
      }
      nouls[id] = result.noul == null ? 0 : result.noul;
      answers[id] = {
        type: 'noul',
        noul: result.noul,
        band: result.band,
        source: 'deterministic',
      };
    }
  }

  if (flags.cloneJev || flags.useTypesafeApi || flags.llmAdjudicate || CLONE_RE.test(blob)) {
    nouls.clone_jev = 1;
    answers.clone_jev = {
      type: 'noul',
      noul: 1,
      band: 'action',
      source: 'deterministic',
    };
  }

  const family = composeHazardFamily(nouls);
  const severity = composeSeverity(nouls);

  if (battery.hazard_family && String(battery.hazard_family.type).toLowerCase() === 'choice') {
    const options = Object.keys(battery.hazard_family.criteria || {});
    const choice = options.includes(family) ? family : options[0] || family;
    answers.hazard_family = {
      type: 'choice',
      choice,
      confidence: 1,
      source: 'code',
    };
  }
  if (battery.severity && String(battery.severity.type).toLowerCase() === 'score') {
    answers.severity = {
      type: 'score',
      score: severity,
      confidence: 1,
      source: 'code',
    };
  }

  return { nouls, answers, unevaluated, family, severity };
}

function normalizeOptions(raw = {}) {
  const rootDir = path.resolve(String(raw.root || raw.rootDir || process.cwd()));
  const payloadPath = raw.payload
    ? path.resolve(rootDir, String(raw.payload))
    : raw.payloadPath
      ? path.resolve(rootDir, String(raw.payloadPath))
      : null;
  const batteryPath = raw.battery
    ? path.resolve(rootDir, String(raw.battery))
    : raw.batteryPath
      ? path.resolve(rootDir, String(raw.batteryPath))
      : null;
  const policyName = String(raw.policy || 'strict').toLowerCase();
  return {
    rootDir,
    payloadPath,
    batteryPath,
    payloadText: raw.payloadText != null ? String(raw.payloadText) : null,
    batteryText: raw.batteryText != null ? String(raw.batteryText) : null,
    toolName: raw['tool-name'] || raw.toolName || null,
    command: raw.command || null,
    policyName: POLICIES[policyName] ? policyName : 'strict',
    mapOnly: normalizeBoolean(raw['map-only'] || raw.mapOnly),
    claimReady: normalizeBoolean(raw['claim-ready'] || raw.claimReady),
    cloneJev: normalizeBoolean(raw['clone-jev'] || raw.cloneJev),
    useTypesafeApi: normalizeBoolean(raw['use-typesafe-api'] || raw.useTypesafeApi),
    llmAdjudicate: normalizeBoolean(raw['llm-adjudicate'] || raw.llmAdjudicate),
    modelEmittedVerdict: raw['model-emitted-verdict'] || raw.modelEmittedVerdict || null,
    live: normalizeBoolean(raw.live),
    apiKey: Object.prototype.hasOwnProperty.call(raw, 'apiKey')
      ? raw.apiKey
      : (raw['api-key'] || undefined),
    fetchImpl: typeof raw.fetchImpl === 'function' ? raw.fetchImpl : undefined,
    strict: normalizeBoolean(raw.strict),
    json: normalizeBoolean(raw.json),
  };
}

function loadTypesafeApiKey() {
  const env = process.env.TYPESAFE_API_KEY;
  if (env && String(env).trim()) return String(env).trim();
  const fallback = path.join(os.homedir(), '.resume_secrets', 'TYPESAFE_API_KEY');
  if (!fs.existsSync(fallback)) return null;
  const text = fs.readFileSync(fallback, 'utf8').trim();
  return text || null;
}

function questionsForApi(battery) {
  const out = {};
  for (const [id, question] of Object.entries(battery || {})) {
    if (!question || typeof question !== 'object') continue;
    const type = String(question.type || '').toLowerCase();
    if (!TYPED_KINDS.includes(type) || !question.instructions) continue;
    const entry = { type, instructions: question.instructions };
    if (question.criteria != null) entry.criteria = question.criteria;
    out[id] = entry;
  }
  return out;
}

async function callSystemOne({
  state,
  questions,
  apiKey,
  model = 'jev-latest',
  fetchImpl,
} = {}) {
  if (!apiKey) {
    const err = new Error('missing_api_key');
    err.code = 'missing_api_key';
    throw err;
  }
  const fetchFn = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    const err = new Error('fetch_unavailable');
    err.code = 'fetch_unavailable';
    throw err;
  }
  const res = await fetchFn(SYSTEMONE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state, model, questions }),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = new Error(`systemone_http_${res.status}`);
    err.code = res.status === 401 ? 'live_unauthorized' : 'live_http_error';
    err.status = res.status;
    throw err;
  }
  return body;
}

function compareShadow(detAnswers, jevAnswers) {
  const divergences = [];
  const jev = jevAnswers && typeof jevAnswers === 'object' ? jevAnswers : {};
  for (const [id, det] of Object.entries(detAnswers || {})) {
    const live = jev[id];
    if (!live || !det) continue;
    if (det.type === 'noul' && live.type === 'noul' && det.noul != null && live.noul != null) {
      const delta = Math.abs(Number(live.noul) - Number(det.noul));
      if (delta >= SHADOW_NOUL_DELTA) {
        divergences.push({
          id,
          type: 'noul',
          deterministic: Number(det.noul),
          jev: Number(live.noul),
          delta,
        });
      }
    }
    if (det.type === 'choice' && live.type === 'choice' && det.choice && live.choice && det.choice !== live.choice) {
      divergences.push({
        id,
        type: 'choice',
        deterministic: det.choice,
        jev: live.choice,
      });
    }
  }
  return divergences;
}

async function attachLiveShadow(report, options = {}) {
  if (!options.live || options.mapOnly || options.useTypesafeApi) return report;
  const apiKey = options.apiKey !== undefined ? options.apiKey : loadTypesafeApiKey();
  if (!apiKey) {
    report.findings.push({
      id: 'live_key_missing',
      severity: 'fail',
      gateId: 'require-code-owned-route',
      message: '--live needs TYPESAFE_API_KEY (env or ~/.resume_secrets/TYPESAFE_API_KEY). Key is never printed.',
    });
    report.status = 'fail';
    report.ok = false;
    report.shadow = { used: false, reason: 'missing_api_key' };
    return report;
  }

  const battery = parseBattery(options.batteryText || '').battery || DEFAULT_BATTERY;
  const questions = questionsForApi(battery);
  try {
    const body = await callSystemOne({
      state: options.payloadText
        ? parsePayload(options.payloadText).payload
        : {
          tool_name: options.toolName,
          tool_input: { command: options.command },
        },
      questions,
      apiKey,
      fetchImpl: options.fetchImpl,
    });
    const jevAnswers = (body && body.answers) || {};
    const divergences = compareShadow(report.answers, jevAnswers);
    report.shadow = {
      used: true,
      ownsRoute: false,
      model: body && body.model,
      usage: body && body.usage,
      answers: jevAnswers,
      divergences,
    };
    for (const d of divergences) {
      report.findings.push({
        id: 'shadow_divergence',
        severity: 'warn',
        gateId: 'require-typed-pretool-questions',
        questionId: d.id,
        message: `Jev shadow disagrees with deterministic ${d.type} on ${d.id} (code still owns route=${report.route}).`,
      });
    }
    if (divergences.length && report.status === 'ready') report.status = 'actionable';
  } catch (err) {
    const id = err && err.code === 'live_unauthorized' ? 'live_unauthorized' : 'live_http_error';
    const status = err && err.status ? Number(err.status) : null;
    const raw = String((err && err.message) || '');
    const safeMsg = /apikey_|bearer\s/i.test(raw) ? 'redacted' : raw.slice(0, 160);
    const errorCode = err && (err.code || (err.cause && err.cause.code));
    report.findings.push({
      id,
      severity: 'fail',
      gateId: 'require-code-owned-route',
      message: `Live System One call failed (HTTP ${status || 'unknown'}${safeMsg ? `: ${safeMsg}` : ''}). Route stays deterministic. Secret is not logged.`,
    });
    report.status = 'fail';
    report.ok = false;
    report.shadow = {
      used: false,
      reason: id,
      status,
      errorName: err && err.name,
      errorCode: errorCode || null,
    };
  }
  return report;
}

async function buildTypesafeTypedQuestionsReportAsync(rawOptions = {}) {
  const report = buildTypesafeTypedQuestionsReport(rawOptions);
  const options = normalizeOptions(rawOptions);
  if (!options.live || options.mapOnly) return report;
  const payloadText = options.payloadText || JSON.stringify({
    tool_name: options.toolName,
    tool_input: { command: options.command },
  });
  await attachLiveShadow(report, {
    live: true,
    mapOnly: false,
    useTypesafeApi: options.useTypesafeApi,
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
    batteryText: options.batteryText,
    payloadText,
    toolName: options.toolName,
    command: options.command,
  });
  return report;
}

function buildFindings({
  batteryParse,
  payloadParse,
  questionErrors,
  unevaluated,
  flags,
  blob,
  answers,
}) {
  const findings = [];
  if (!batteryParse.ok) {
    findings.push({
      id: batteryParse.error || 'battery_error',
      severity: 'fail',
      gateId: 'require-typed-pretool-questions',
      message: `Battery failed: ${batteryParse.error}.`,
    });
  }
  if (!payloadParse.ok) {
    findings.push({
      id: payloadParse.error || 'payload_error',
      severity: 'fail',
      gateId: 'require-typed-pretool-questions',
      message: `Payload failed: ${payloadParse.error}.`,
    });
  }
  for (const err of questionErrors) {
    findings.push({
      id: err.id,
      severity: 'fail',
      gateId: 'require-typed-pretool-questions',
      questionId: err.questionId,
      message: err.message,
    });
  }
  for (const id of unevaluated) {
    findings.push({
      id: 'unevaluated_question',
      severity: 'fail',
      gateId: 'require-code-owned-route',
      questionId: id,
      message: `Question ${id} has no matcher and no deterministic evaluator. Do not call Jev to fill it.`,
    });
  }
  if (flags.cloneJev) {
    findings.push({
      id: 'jev_sku_clone',
      severity: 'fail',
      gateId: 'require-code-owned-route',
      message: 'Refused --clone-jev. TypeSafe/Jev is FORMAT only; do not clone System One as a ThumbGate SKU.',
    });
  }
  if (flags.useTypesafeApi) {
    findings.push({
      id: 'typesafe_api_refused',
      severity: 'fail',
      gateId: 'require-code-owned-route',
      message: 'Refused --use-typesafe-api. Do not call api.typesafe.ai from PreToolUse (ECI; LLM adjudicator parked).',
    });
  }
  if (flags.llmAdjudicate) {
    findings.push({
      id: 'llm_adjudicator_parked',
      severity: 'fail',
      gateId: 'require-code-owned-route',
      message: 'Refused --llm-adjudicate. Issues #3690/#3687 stay parked. Deterministic typed questions only.',
    });
  }
  if (CLONE_RE.test(blob)) {
    findings.push({
      id: 'typesafe_clone_signal',
      severity: 'fail',
      gateId: 'require-code-owned-route',
      message: 'Payload asks to install typesafe-sdk, call api.typesafe.ai, clone Jev, or wire an LLM adjudicator.',
    });
  }
  if (flags.modelEmittedVerdict) {
    findings.push({
      id: 'model_emitted_verdict',
      severity: 'fail',
      gateId: 'require-code-owned-route',
      message: `Refused model-emitted verdict=${flags.modelEmittedVerdict}. Code owns route(); the model does not.`,
    });
  }
  if (answers.hazard_family && answers.hazard_family.source !== 'code') {
    findings.push({
      id: 'choice_not_composed_in_code',
      severity: 'fail',
      gateId: 'require-code-owned-route',
      message: 'hazard_family must be composed in code from noul answers.',
    });
  }
  return findings;
}

function buildTypesafeTypedQuestionsReport(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const ioErrors = [];

  let batteryRaw = options.batteryText;
  if (batteryRaw == null && options.batteryPath) {
    try {
      batteryRaw = readText(options.batteryPath);
    } catch (err) {
      ioErrors.push({ id: 'battery_read_error', message: err.message });
      batteryRaw = '';
    }
  }

  let payloadRaw = options.payloadText;
  if (payloadRaw == null && options.payloadPath) {
    try {
      payloadRaw = readText(options.payloadPath);
    } catch (err) {
      ioErrors.push({ id: 'payload_read_error', message: err.message });
      payloadRaw = '';
    }
  }

  const batteryParse = parseBattery(batteryRaw);
  const payloadParse = parsePayload(payloadRaw);
  const payload = payloadParse.payload || {};
  if (options.toolName) payload.tool_name = options.toolName;
  if (options.command) {
    payload.tool_input = { ...(payload.tool_input || {}), command: options.command };
  }

  const battery = batteryParse.ok ? batteryParse.battery : { ...DEFAULT_BATTERY };
  const questionErrors = [];
  if (batteryParse.ok) {
    for (const [id, question] of Object.entries(battery)) {
      questionErrors.push(...validateQuestion(id, question));
    }
  }

  const blob = flattenState(payload);
  const flags = {
    cloneJev: options.cloneJev,
    useTypesafeApi: options.useTypesafeApi,
    llmAdjudicate: options.llmAdjudicate,
    modelEmittedVerdict: options.modelEmittedVerdict,
  };

  const evaluated = options.mapOnly
    ? { nouls: {}, answers: {}, unevaluated: [], family: 'none', severity: 0 }
    : evaluateBattery({ battery, blob, flags, payload });

  const policy = POLICIES[options.policyName];
  const composedRoute = options.mapOnly
    ? 'pass'
    : route({
      nouls: evaluated.nouls,
      severity: evaluated.severity,
      policy,
      battery,
    });

  const findings = [
    ...ioErrors.map((e) => ({
      id: e.id,
      severity: 'fail',
      gateId: 'require-typed-pretool-questions',
      message: e.message,
    })),
    ...buildFindings({
      batteryParse,
      payloadParse,
      questionErrors,
      unevaluated: evaluated.unevaluated,
      flags,
      blob,
      answers: evaluated.answers,
    }),
  ];

  if (options.claimReady && findings.some((f) => f.severity === 'fail')) {
    findings.push({
      id: 'claim_without_code_owned_route',
      severity: 'fail',
      gateId: 'require-code-owned-route',
      message: 'Claimed typed-question PreToolUse ready while clone/API/LLM-adjudicator or untyped questions remain.',
    });
  }

  const seen = new Set();
  const deduped = [];
  for (const f of findings) {
    const key = `${f.id}:${f.questionId || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(f);
  }

  const failCount = deduped.filter((f) => f.severity === 'fail').length;
  const warnCount = deduped.filter((f) => f.severity === 'warn').length;
  let status = 'ready';
  if (failCount > 0) status = 'fail';
  else if (warnCount > 0) status = 'actionable';

  const codeOwnsRoute = !flags.modelEmittedVerdict
    && !flags.useTypesafeApi
    && !flags.llmAdjudicate
    && !flags.cloneJev
    && evaluated.unevaluated.length === 0;

  return {
    name: 'thumbgate-typesafe-typed-questions',
    ok: status !== 'fail',
    status,
    source: SOURCE_URLS[0],
    sources: SOURCE_URLS,
    disclaimer:
      'FORMAT steal from TypeSafe (typed noul/choice/score + code-owned route + confidence as a second axis). Not affiliated with TypeSafe. Does not install typesafe-sdk, call Jev, or wire an LLM adjudicator.',
    rootDir: options.rootDir,
    policy: options.policyName,
    codeOwnsRoute,
    clonedJev: Boolean(flags.cloneJev || flags.useTypesafeApi || CLONE_RE.test(blob)),
    llmAdjudicatorParked: true,
    map: options.mapOnly ? RAIL_MAP : undefined,
    metrics: {
      payloadPath: options.payloadPath,
      batteryPath: options.batteryPath,
      questionCount: Object.values(battery).filter((q) => q && typeof q === 'object').length,
      noulCount: Object.values(battery).filter((q) => q && String(q.type).toLowerCase() === 'noul').length,
      choiceCount: Object.values(battery).filter((q) => q && String(q.type).toLowerCase() === 'choice').length,
      scoreCount: Object.values(battery).filter((q) => q && String(q.type).toLowerCase() === 'score').length,
      mapOnly: options.mapOnly,
      claimReady: options.claimReady,
      hazardFamily: evaluated.family,
      severity: evaluated.severity,
    },
    answers: evaluated.answers,
    route: composedRoute,
    findings: deduped,
    summary: {
      failCount,
      warnCount,
      findingCount: deduped.length,
      recommendedGateCount: [...new Set(deduped.map((f) => f.gateId).filter(Boolean))].length,
    },
    recommendedGates: [...new Set(deduped.map((f) => f.gateId).filter(Boolean))],
    nextActions: [
      'Ask independent noul/choice/score questions over the same PreToolUse state.',
      'Compose pass|review|block in code from those answers — never let a model emit the verdict.',
      'Treat confidence as a second axis: warn-level → review; high-stakes + severity ≥ 2 → block.',
      'Do not install typesafe-sdk, call api.typesafe.ai, clone Jev, or unpark the LLM adjudicator.',
      'Pair with gates require-typed-pretool-questions and require-code-owned-route.',
    ],
    exampleCommand:
      'npx thumbgate typesafe-typed-questions --tool-name=Bash --command="git push --force origin main" --json',
  };
}

function formatTypesafeTypedQuestionsReport(report) {
  const lines = [
    '',
    'ThumbGate TypeSafe Typed-Questions Doctor',
    '-'.repeat(48),
    `Status   : ${report.status}`,
    `Route    : ${report.route}`,
    `Policy   : ${report.policy}`,
    `Code owns route : ${report.codeOwnsRoute}`,
    `Questions: ${report.metrics.questionCount} (noul=${report.metrics.noulCount}, choice=${report.metrics.choiceCount}, score=${report.metrics.scoreCount})`,
    `Family   : ${report.metrics.hazardFamily}  severity=${report.metrics.severity}`,
    `Findings : ${report.summary.findingCount} (fail=${report.summary.failCount}, warn=${report.summary.warnCount})`,
    `Source   : ${report.source}`,
  ];
  if (report.map) {
    lines.push('', 'Rail map:');
    for (const row of report.map) {
      lines.push(`  - ${row.typesafe} → ${row.thumbgate}`);
    }
  }
  if (report.findings.length) {
    lines.push('', 'Findings:');
    for (const f of report.findings) {
      const gate = f.gateId ? ` [${f.gateId}]` : '';
      const q = f.questionId ? ` ${f.questionId}` : '';
      lines.push(`  - [${f.severity}] ${f.id}${q}${gate}`);
      lines.push(`    ${f.message}`);
    }
  }
  lines.push('', 'Next actions:');
  for (const a of report.nextActions) lines.push(`  - ${a}`);
  lines.push('', `Example: ${report.exampleCommand}`);
  lines.push(`Note: ${report.disclaimer}`, '');
  return `${lines.join('\n')}\n`;
}

function parseCliArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--strict') { options.strict = true; continue; }
    if (arg === '--map-only') { options['map-only'] = true; continue; }
    if (arg === '--claim-ready') { options['claim-ready'] = true; continue; }
    if (arg === '--clone-jev') { options['clone-jev'] = true; continue; }
    if (arg === '--use-typesafe-api') { options['use-typesafe-api'] = true; continue; }
    if (arg === '--llm-adjudicate') { options['llm-adjudicate'] = true; continue; }
    if (arg === '--live') { options.live = true; continue; }
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    options[m[1]] = m[2] === undefined ? true : m[2];
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/typesafe-typed-questions.js [flags]

Flags:
  --payload=PATH           PreToolUse JSON payload
  --battery=PATH           Typed questions JSON (noul|choice|score)
  --tool-name=NAME         Shortcut tool_name
  --command=TEXT           Shortcut tool_input.command
  --policy=strict|permissive
  --map-only               Print TypeSafe → ThumbGate rail map
  --claim-ready            Fail unless code owns the route
  --clone-jev              Always fail (SKU clone)
  --use-typesafe-api       Always fail (Jev as the PreToolUse gate)
  --live                   Shadow the battery against api.typesafe.ai; code still owns route
  --llm-adjudicate         Always fail (#3690/#3687 parked)
  --model-emitted-verdict=V  Always fail (code must own route)
  --root=DIR               Repo root for relative paths
  --strict                 Exit 1 on fail/actionable
  --json

Sources: ${SOURCE_URLS.join(' ')}
`);
}

async function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const report = await buildTypesafeTypedQuestionsReportAsync(args);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatTypesafeTypedQuestionsReport(report));
  if (args.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  SOURCE_URLS,
  DEFAULT_BATTERY,
  POLICIES,
  RAIL_MAP,
  flattenState,
  parseBattery,
  validateQuestion,
  noulFromMatchers,
  actionForNoul,
  composeHazardFamily,
  composeSeverity,
  route,
  SYSTEMONE_URL,
  loadTypesafeApiKey,
  questionsForApi,
  callSystemOne,
  compareShadow,
  attachLiveShadow,
  buildTypesafeTypedQuestionsReport,
  buildTypesafeTypedQuestionsReportAsync,
  formatTypesafeTypedQuestionsReport,
  runCli,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  runCli().then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    process.stderr.write(`${err && err.message ? err.message : err}\n`);
    process.exitCode = 1;
  });
}
