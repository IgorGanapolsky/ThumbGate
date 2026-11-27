#!/usr/bin/env node
'use strict';

const { tenantDataScope, assertScopedDataPath } = require('./feedback-scope');

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');

// Free keeps at most this many learned rules on disk (and enforces the first FREE_TIER_MAX_GATES of them). Pro is not capped:
// the site promises Pro keeps every learned rule active. Stale rules still expire after the rule TTL, which bounds the file.
const MAX_AUTO_GATES = 10;

// The most auto-promoted gates to keep for this caller. `options.isPro` (boolean or function) lets a test pick the tier.
function autoGateLimit(options = {}) {
  const pro = typeof options.isPro === 'function' ? options.isPro() : typeof options.isPro === 'boolean' ? options.isPro : require('./rate-limiter').isProTier();
  return pro ? Infinity : MAX_AUTO_GATES;
}
// 1+ failure auto-promotes to a warning gate. Cold buyers expect "one 👎 → blocked next time"
// — a 2-capture threshold made first-capture invisible and broke the activation loop. Block
// escalation still requires 3 captures (BLOCK_THRESHOLD) so noise doesn't auto-hard-block.
const WARN_THRESHOLD = 1;
const BLOCK_THRESHOLD = 3; // 3+ repeated failures hard-block the action
const HUMAN_BLOCK_THRESHOLD = 2; // AGENT-3667: two thumbs-downs from a person on one command hard-block it
const WINDOW_DAYS = 30;

// Default TTL on auto-promoted gates. Reddit reviewer @MomSausageandPeppers
// (2026-05-13) flagged that without expiry, "accidental dislikes become policy
// forever." Gates expire 90 days after promotion UNLESS they keep firing —
// every fire refreshes lastFiredAt, and expireGates() keeps any gate fired
// within the last TTL window regardless of original promotion date. Manual
// force-promote bypasses TTL (operator says "permanent"). Override via
// THUMBGATE_RULE_TTL_DAYS env var.
const DEFAULT_RULE_TTL_DAYS = 90;
function getRuleTtlDays() {
  const raw = Number(process.env.THUMBGATE_RULE_TTL_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RULE_TTL_DAYS;
}
function getRuleTtlMs() {
  return getRuleTtlDays() * 24 * 60 * 60 * 1000;
}

const NEG_SIGNALS = new Set(['negative', 'negative_strong', 'down', 'thumbs_down']);

function getFeedbackLogPath() {
  const scope = tenantDataScope();
  if (scope) return assertScopedDataPath(path.join(scope.feedbackDir, 'feedback-log.jsonl'));
  if (process.env.THUMBGATE_FEEDBACK_DIR) {
    return path.join(process.env.THUMBGATE_FEEDBACK_DIR, 'feedback-log.jsonl');
  }
  const localFallback = path.join(process.cwd(), '.thumbgate', 'feedback-log.jsonl');
  const localClaude = path.join(process.cwd(), '.claude', 'memory', 'feedback', 'feedback-log.jsonl');
  if (fs.existsSync(localFallback)) return localFallback;
  if (fs.existsSync(localClaude)) return localClaude;
  // Fall back to resolveFeedbackDir() for proper home-dir resolution
  const resolved = path.join(resolveFeedbackDir(), 'feedback-log.jsonl');
  if (fs.existsSync(resolved)) return resolved;
  return localFallback; // default even if doesn't exist
}

function getAutoGatesPath(options = {}) {
  const feedbackDir = options.feedbackDir ? resolveFeedbackDir(options) : path.dirname(getFeedbackLogPath());
  return assertScopedDataPath(path.join(feedbackDir, 'auto-promoted-gates.json'));
}

function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

// --- Self-Harness stage 3: regression-gated promotion -----------------------
// Inspired by "Self-Harness: Harnesses That Improve Themselves" (arXiv 2606.09498).
// Stages 1-2 (weakness mining -> rule extraction) already exist via lesson
// inference + this promoter. Stage 3 — accept a harness change only after
// regression-testing it does not degrade behavior — was missing: a noisy 3x
// capture could hard-block an over-broad pattern with no check that it wouldn't
// have wrongly blocked actions that were previously ALLOWED. This replays a
// candidate BLOCK rule against the audit trail's prior `allow` decisions; if it
// would have blocked safe actions, the caller quarantines it to `warn` instead.
const REGRESSION_FALSE_BLOCK_LIMIT = 0; // any prior safe action it would block => quarantine

function getAuditTrailPath() {
  return assertScopedDataPath(path.join(path.dirname(getFeedbackLogPath()), 'audit-trail.jsonl'));
}

// Returns { falseBlocks, allowSampleSize, falseFireUpper95, evidence } or null when there is no history /
// matcher available — in which case the caller promotes as usual (fail-open to
// existing behavior, since regression gating is an enhancement, not a hard gate).
function regressionCheck(gate, options = {}) {
  const auditPath = options.auditTrailPath || getAuditTrailPath();
  const entries = readJSONL(auditPath);
  if (!entries.length) return null;
  // Lazy-require to avoid the gates-engine <-> auto-promote-gates require cycle.
  let matchesGate;
  try { ({ matchesGate } = require('./gates-engine')); } catch { return null; }
  if (typeof matchesGate !== 'function') return null;
  let allowed = entries.filter((e) => e && e.decision === 'allow' && e.toolName && require('./project-identity').matchesProject(e, gate.projectKey));
  if (!allowed.length) return null;

  // The command we just learned to block was, by definition, ALLOWED before we
  // learned it — that prior allow IS the incident the operator thumbs-downed.
  // Counting it as a false block quarantines every gate learned from a real
  // failure, which is the normal path (run it, get burned, 👎 it). Exclude the
  // originating contexts so the check only measures collateral damage to
  // genuinely unrelated actions.
  // Match on normalized command EQUALITY, not substring containment: a longer,
  // genuinely different command that merely quotes the incident text (e.g.
  // `notify-team --dry-run "<incident>"`) is real collateral damage and must
  // still count toward quarantine.
  const incidentSignatures = new Set(
    (options.incidentContexts || [])
      .map((c) => normalizeCommandSignature(String(c || '')))
      .filter(Boolean),
  );
  if (incidentSignatures.size > 0) {
    allowed = allowed.filter((e) => {
      const cmd = (e.toolInput && (e.toolInput.command || e.toolInput.pattern)) || '';
      return !incidentSignatures.has(normalizeCommandSignature(String(cmd)));
    });
    if (!allowed.length) return { falseBlocks: 0, allowSampleSize: 0, ...triggerEvidence(0, 0) };
  }

  let falseBlocks = 0;
  for (const e of allowed) {
    try {
      if (matchesGate(gate, e.toolName, e.toolInput || {}, { projectKey: gate.projectKey })) falseBlocks += 1;
    } catch { /* a bad pattern/entry never counts as a false block */ }
  }
  return { falseBlocks, allowSampleSize: allowed.length, ...triggerEvidence(falseBlocks, allowed.length) };
}

// --- Trigger audit: how much a "0 false blocks" result is worth -------------
// From "A CPU Inside an LLM" (arXiv 2611.26450): an exact rule grafted into a
// system is only trusted after it is shown not to fire on unrelated input, and
// the paper reports that as a count over a large held-out sample (0 of 11,134
// out-of-distribution triggers), not as "it didn't fire". Zero false blocks on
// 2 prior allowed actions says almost nothing; zero on 300 says a lot. So the
// regression result also carries a 95% upper bound on the false-fire rate and
// an evidence label. It does not change what gets quarantined.
const TRIGGER_AUDIT_STRONG_UPPER = 0.05; // 95% upper bound at or under 5% => strong
const Z_ONE_SIDED_95 = 1.6448536269514722;

// One-sided 95% upper bound on a false-fire rate seen as k fires in n trials.
// k = 0 uses the exact bound 1 - 0.05^(1/n) (about 3/n, the "rule of three");
// k > 0 uses the Wilson score interval. n = 0 has no bound (1).
function falseFireUpperBound(k, n) {
  const fires = Math.max(0, Number(k) || 0);
  const trials = Math.max(0, Number(n) || 0);
  if (trials === 0) return 1;
  if (fires === 0) return 1 - Math.pow(0.05, 1 / trials);
  const p = Math.min(1, fires / trials);
  const z2 = Z_ONE_SIDED_95 * Z_ONE_SIDED_95;
  const centre = p + z2 / (2 * trials);
  const margin = Z_ONE_SIDED_95 * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return Math.min(1, (centre + margin) / (1 + z2 / trials));
}

function triggerEvidence(falseBlocks, allowSampleSize) {
  const upper = falseFireUpperBound(falseBlocks, allowSampleSize);
  let evidence;
  if (!allowSampleSize) evidence = 'none';
  else if (falseBlocks > 0) evidence = 'fires-on-safe-actions';
  else evidence = upper <= TRIGGER_AUDIT_STRONG_UPPER ? 'strong' : 'weak';
  return { falseFireUpper95: Number(upper.toFixed(4)), evidence };
}

// The quoted incident text in an auto-promoted gate's message. That command was
// allowed before the gate existed (it is the mistake that was thumbs-downed), so
// an audit of an existing gate must not count it as collateral damage.
function incidentContextsForGate(gate) {
  const out = [];
  if (gate && Array.isArray(gate.incidentContexts)) out.push(...gate.incidentContexts.map(String));
  if (gate && gate.incidentContext) out.push(String(gate.incidentContext));
  const m = /^Auto-promoted [^:]+: "(.*)" \(/.exec(String((gate && gate.message) || ''));
  if (m && m[1]) out.push(m[1]);
  return out;
}

// Untruncated, deduplicated incident contexts kept on a gate (bounded so the file stays small).
function keepIncidentContexts(contexts) {
  return [...new Set((contexts || []).map((c) => String(c || '')).filter(Boolean))].slice(0, 10).map((c) => c.slice(0, 2000));
}

// Replay every stored auto-promoted gate against the audit trail's prior allowed
// actions and report fires, sample size, the 95% upper bound and the evidence
// label per gate. Read-only: it never edits a gate.
function auditGateTriggers(options = {}) {
  const data = options.data || loadAutoGates(options);
  const gates = Array.isArray(data.gates) ? data.gates : [];
  return gates.map((gate) => {
    const res = safeRegressionCheck(gate, { ...options, incidentContexts: incidentContextsForGate(gate) });
    const r = res || { falseBlocks: 0, allowSampleSize: 0, ...triggerEvidence(0, 0) };
    return {
      gateId: gate.id,
      action: gate.action,
      pattern: gate.pattern,
      falseBlocks: r.falseBlocks,
      allowSampleSize: r.allowSampleSize,
      falseFireUpper95: r.falseFireUpper95,
      evidence: r.evidence,
    };
  });
}

function formatTriggerAudit(rows) {
  if (!rows.length) return 'No auto-promoted gates to audit.';
  const lines = rows.map((r) => {
    const bound = r.allowSampleSize ? `<= ${(r.falseFireUpper95 * 100).toFixed(1)}% at 95%` : 'no bound';
    return `${r.evidence.padEnd(22)} ${String(r.falseBlocks).padStart(3)} / ${String(r.allowSampleSize).padEnd(5)} ${bound.padEnd(18)} ${r.action.padEnd(5)} ${r.gateId}`;
  });
  return ['evidence               fires / allowed  false-fire rate    action gate', ...lines].join('\n');
}

function safeRegressionCheck(gate, options) {
  try { return regressionCheck(gate, options); } catch { return null; }
}

function loadAutoGates(options = {}) {
  const autoGatesPath = getAutoGatesPath(options);
  if (!fs.existsSync(autoGatesPath)) {
    return { version: 1, gates: [], promotionLog: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(autoGatesPath, 'utf-8'));
  } catch {
    return { version: 1, gates: [], promotionLog: [] };
  }
}

function saveAutoGates(data, options = {}) {
  const autoGatesPath = getAutoGatesPath(options);
  const dir = path.dirname(autoGatesPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(autoGatesPath, JSON.stringify(data, null, 2) + '\n');
}

function isNegative(entry) {
  const sig = (entry.signal || entry.feedback || '').toLowerCase();
  return NEG_SIGNALS.has(sig);
}

/**
 * Normalize a captured command/context string so trivial variants collapse
 * to the same gate signature.
 *
 * Reddit critique (MomSausageandPeppers, 2026-05-17): "commands are matched
 * by string equality, so `rm -rf node_modules` and `rm -rf ./node_modules`
 * create separate gates."
 *
 * Conservative — only collapse variants that are *unambiguously* the same
 * intent. Does NOT reorder flags, strip `&&` chains, or canonicalize
 * subcommands (each can change semantics).
 *
 *  1. Lowercase
 *  2. Strip `/Users/<name>` and `/home/<name>` home-dir prefixes (→ `~`)
 *  3. Drop `:LINE` and `:LINE:COL` refs
 *  4. Per-token: strip one layer of matching outer quotes/backticks
 *  5. Per-token: drop leading `./`
 *  6. Collapse whitespace + trim
 */
function normalizeCommandSignature(input) {
  let text = String(input || '');
  if (!text) return '';
  text = text.toLowerCase();
  text = text.replace(/\/users\/[^\s/]+/g, '~').replace(/\/home\/[^\s/]+/g, '~');
  text = text.replace(/:\d+(?::\d+)?\b/g, '');
  const tokens = text.split(/\s+/).filter(Boolean).map((tok) => {
    let t = tok;
    if (t.length >= 2) {
      const first = t[0];
      const last = t[t.length - 1];
      if ((first === '"' || first === "'" || first === '`') && first === last) {
        t = t.slice(1, -1);
      }
    }
    if (t.startsWith('./')) t = t.slice(2);
    return t;
  }).filter(Boolean);
  return tokens.join(' ').trim();
}

/**
 * Prefer an executable action we can match at PreToolUse time.
 * Tag-only or pure prose feedback is useful memory — not an enforcement pattern.
 */
function extractExecutableAction(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const fromTool =
    (entry.toolInput && (entry.toolInput.command || entry.toolInput.pattern))
    || (entry.tool_input && (entry.tool_input.command || entry.tool_input.pattern))
    || entry.command
    || entry.failedCommand
    || null;
  if (fromTool && String(fromTool).trim().length >= 4) {
    return String(fromTool).trim();
  }

  const ctx = String(entry.context || entry.whatWentWrong || '').trim();
  if (ctx.length < 4) return null;

  // Strong signal: known tool prefixes — accept immediately.
  const known = /^(?:sudo\s+)?(?:kubectl|git|npm|npx|yarn|pnpm|python|python3|node|curl|wget|docker|podman|rm|mv|cp|chmod|chown|psql|mysql|mongo|terraform|pulumi|aws|gcloud|az|helm|ssh|scp|rsync|make|cargo|go|ruby|perl|bash|sh|zsh)\b/i.test(ctx);
  if (known && ctx.length <= 240) return ctx;

  // Reject agent-narration prose before the weak "looks like a command" heuristic.
  // "Agent (grok) auto-sent …" was previously accepted because it starts with a
  // single token + spaces, then became an inert force-gate pattern (AGENT-259).
  if (/^(?:agent|the|user|ceo|claude|grok|codex|gemini|assistant|operator)\b/i.test(ctx)) {
    return null;
  }
  if (/\b(?:without\s+(?:human\s+)?review|thumbs?-?down|auto-sent|always-approve)\b/i.test(ctx)) {
    return null;
  }
  // Parenthetical asides ("Agent (grok, always-approve)") are prose, not argv.
  if (/\([^)]{0,40}\b(?:grok|claude|codex|always-approve|agent)\b/i.test(ctx)) {
    return null;
  }

  // Looks like a shell / CLI invocation (not free-form prose).
  const looksExecutable = /^(?:sudo\s+)?(?:~\/|\.\/|\/)?(?:[A-Za-z0-9._+-]+\/)*[A-Za-z0-9._+-]+(?:\s|$)/.test(ctx)
    && /\s|^[a-z0-9._+-]+(?:\s|$)/i.test(ctx)
    && !/\s+(?:broke|failed|wrong|should|never|please|the agent|auto-sent|emailed)\b/i.test(ctx.slice(0, 100));
  // Weak path: require a flag or path-like token so "Agent wrote a bad summary" fails.
  const hasCliShape = /(?:\s-{1,2}[A-Za-z][\w-]*|\/[A-Za-z0-9._-]{2,}|\.(?:js|ts|py|sh|json|yml|yaml)\b)/.test(ctx);
  if (looksExecutable && hasCliShape && ctx.length <= 200) {
    return ctx;
  }
  return null;
}

// ---- Condition gate "repeat-after-deny" ----
// An identical tool call (same tool, same input digest) already denied in this session is refused until the person
// takes another turn. The gate's `pattern` never matches, so an engine without `condition` leaves every call alone.
const CONDITION = 'repeat-after-deny';
const NEVER_MATCHES = '(?!)';
const GATE_ID = 'repeat-after-deny';
const STATE_FILE = 'repeat-after-deny-state.json';
const DENY_TTL_MS = 24 * 60 * 60 * 1000;
const DENY_KEEP = 200;

const RETRY = '(?:re-?tr(?:y|ied|ies|ying)|re-?r[au]n(?:ning)?|repeat(?:ed|ing|s)?)';
const DENIED = '(?:denied|blocked|refused|rejected)';
const RETRY_DENIED_RE = new RegExp(`\\b${RETRY}\\b[^.\\n]{0,60}\\b${DENIED}\\b|\\b${DENIED}\\b[^.\\n]{0,60}\\b${RETRY}\\b`, 'i');
const WITHOUT_YES_RE = /\bwithout\b[^.\n]{0,40}\b(?:yes|approval|permission|ok(?:ay)?|consent|asking)\b/i;

/** The condition a piece of negative feedback describes, or null when it names none we can check. */
function conditionFor(text) {
  const value = String(text || '');
  return RETRY_DENIED_RE.test(value) && WITHOUT_YES_RE.test(value) ? CONDITION : null;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function callDigest(toolName, toolInput = {}) {
  // A shell call is its command: the description beside it is reworded on every retry.
  const input = toolInput && toolInput.command ? { command: toolInput.command } : toolInput;
  return require('node:crypto').createHash('sha256').update(`${toolName}\n${stable(input)}`).digest('hex');
}

function readState(feedbackDir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(feedbackDir, STATE_FILE), 'utf8'));
    return Array.isArray(data.denied) ? data.denied : [];
  } catch {
    return [];
  }
}

function writeState(feedbackDir, denied) {
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.writeFileSync(path.join(feedbackDir, STATE_FILE), `${JSON.stringify({ denied: denied.slice(-DENY_KEEP) })}\n`);
}

function recordDeny({ feedbackDir, sessionId, toolName, toolInput, now = Date.now() }) {
  if (!feedbackDir || !sessionId || !toolName) return;
  const denied = readState(feedbackDir).filter((d) => now - d.at < DENY_TTL_MS);
  const digest = callDigest(toolName, toolInput);
  const others = denied.filter((d) => !(d.sessionId === sessionId && d.digest === digest));
  others.push({ sessionId, digest, at: now });
  writeState(feedbackDir, others);
}

// The UserPromptSubmit hook already logs each prompt with its time; a prompt after the deny is the person's new turn.
// The log carries no session id, so a prompt in another session of this project releases too.
function lastUserTurnAt(feedbackDir) {
  const { readRecentConversationWindow } = require('./feedback-history-distiller');
  return readRecentConversationWindow({ feedbackDir, limit: 50 })
    .filter((e) => e.author === 'user')
    .reduce((latest, e) => Math.max(latest, Date.parse(e.timestamp) || 0), 0);
}

function wasDenied({ feedbackDir, sessionId, toolName, toolInput, now = Date.now() }) {
  if (!feedbackDir || !sessionId || !toolName) return false;
  const digest = callDigest(toolName, toolInput);
  const hit = readState(feedbackDir).find((d) => d.sessionId === sessionId && d.digest === digest && now - d.at < DENY_TTL_MS);
  if (!hit) return false;
  const turn = lastUserTurnAt(feedbackDir);
  // No recent prompt on record means we cannot see the person's turns here, so never hold: a yes could not release it.
  return turn > 0 && turn <= hit.at && hit.at - turn < DENY_TTL_MS;
}

const repeatAfterDeny = { CONDITION, NEVER_MATCHES, GATE_ID, conditionFor, callDigest, recordDeny, wasDenied };

function extractPatternKey(entry) {
  // Enforcement groups by executable action only. Tags remain diagnostic metadata
  // and must not create hard-block thresholds for a single unrelated latest command.
  const condition = repeatAfterDeny.conditionFor([entry && entry.context, entry && entry.whatWentWrong].filter(Boolean).join('\n'));
  if (condition) return 'condition:' + condition;
  const action = extractExecutableAction(entry);
  if (!action) return null;
  return normalizeCommandSignature(action).slice(0, 100);
}

function extractDiagnosticKeys(entry) {
  const keys = [];
  const diagnosis = entry && entry.diagnosis ? entry.diagnosis : null;
  if (!diagnosis) return keys;

  if (diagnosis.rootCauseCategory) {
    keys.push(`diagnosis:${diagnosis.rootCauseCategory}`);
  }

  const violations = Array.isArray(diagnosis.violations) ? diagnosis.violations : [];
  violations.slice(0, 3).forEach((violation) => {
    const key = violation.constraintId || violation.message;
    if (key) {
      keys.push(`constraint:${key}`);
    }
  });

  return keys;
}

function groupNegativeFeedback(entries, windowDays) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const groups = {};

  for (const entry of entries) {
    if (!isNegative(entry)) continue;

    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
    if (ts < cutoff) continue;

    // Enforcement groups ONLY by executable action. Tag/diagnosis metadata is
    // useful for memory and dashboards, but must not create hard-block thresholds
    // that attach to an unrelated latest command.
    const patternKey = extractPatternKey(entry);
    if (!patternKey) continue;
    const project = require('./project-identity').projectForRecord(entry);
    const key = project.projectKey + ':' + patternKey;

    if (!groups[key]) {
      groups[key] = {
        ...project,
        key: patternKey,
        count: 0,
        humanCount: 0,
        entries: [],
        latestContext: '',
        latestTimestamp: '',
        latestExecutable: '',
      };
    }
    groups[key].count++;
    if (String(entry.reviewOrigin || '').toLowerCase() === 'human') groups[key].humanCount++;
    groups[key].entries.push(entry);
    if (!groups[key].latestTimestamp || (entry.timestamp && entry.timestamp > groups[key].latestTimestamp)) {
      groups[key].latestTimestamp = entry.timestamp || '';
      const action = extractExecutableAction(entry);
      groups[key].latestContext = action || entry.context || entry.whatWentWrong || '';
      groups[key].latestExecutable = action || '';
    }
  }

  return groups;
}

function patternToGateId(key) {
  return 'auto-' + key.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50).toLowerCase();
}

/**
 * Turn a captured context string into a pattern the gates engine can actually
 * match. `gates-engine.js` compiles `gate.pattern` with `new RegExp(...)` and
 * tests it against the tool-call text, so the pattern MUST be regex-safe text
 * drawn from the command itself.
 *
 * It must NOT be the group key: keys are frequently tag-derived
 * ("entity:Customer+entity:Funnel"), which is both meaningless against a command
 * string and actively hazardous as a regex ('+' is a quantifier). Grouping by tag
 * is correct — reusing that key as the match pattern is not.
 */
function contextToPattern(context) {
  const raw = String(context || '').trim();
  if (raw.length < 4) return null;
  // Escape every regex metacharacter: the captured command is literal text.
  return raw.slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Known incident classes that appear as English prose in force-gate / feedback
 * but map to a deterministic tool-call surface. Without this, force-promote of
 * "agent emailed X without review" stores the sentence as a regex and never
 * matches any tool call (AGENT-259, June 2026 + Aug 2026 recurrence).
 */
function deriveSurfacePattern(context) {
  const text = String(context || '');
  if (!text.trim()) return null;

  const emailish = /\b(gmail|e-?mail|smtp|sendmail|msmtp|mailx|nodemailer|smtplib|messages\/send|send_message|send_draft|send-mail|outbound\s+email|cold\s+outreach)\b/i.test(text);
  const sendish = /\b(send|sent|sending|emailed|mail(ed)?)\b/i.test(text);
  if (emailish && sendish) {
    // Mirrors config/gates/default.json outbound-email-send + the live
    // ~/.thumbgate/bin/outbound-email-guard.js surface set.
    return '(?:(?:^|[_.])send[_-]?(?:message|mail|email|now|draft)s?\\b|emailer[_-]?messages?[_-]?send|users\\/[^/\\s"\']+\\/messages\\/send|\\bmessages\\/send\\b|messages\\s*\\(\\s*\\)\\s*\\.\\s*send\\s*\\(|\\bsendmail\\b|\\bmsmtp\\b|\\bsmtplib\\b|\\bnodemailer\\b)';
  }

  if (/\bforce[- ]?push\b|git\s+push\s+(?:-f|--force)\b/i.test(text)) {
    return 'git\\s+push\\s+(--force|-f)';
  }

  if (/\b(rm\s+-rf\s+\/|sudo\s+rm\s+-rf)\b/i.test(text)) {
    return '(?:sudo\\s+)?rm\\s+-rf\\s+/';
  }

  return null;
}

/**
 * True when a gate pattern is essentially an English sentence — many words,
 * no executable tokens — and therefore cannot fire against tool-call text.
 */
function isInertProsePattern(pattern) {
  if (!pattern || typeof pattern !== 'string') return true;
  // Intentional multi-alternative surface matchers (email send, force-push classes).
  if (/\(\?:/.test(pattern) && pattern.includes('|')) return false;
  // Unescape common contextToPattern escapes so we can inspect the words.
  const unescaped = pattern
    .replace(/\\([.*+?^${}()|[\]\\])/g, '$1')
    .replace(/\\\\/g, '\\');
  const words = (unescaped.match(/[A-Za-z]{3,}/g) || []);
  if (words.length < 6) return false;
  // Short CLI / known surface tokens only — a long English sentence that merely
  // *mentions* "gmail" is still inert (it will never equal a tool-call string).
  const trimmed = unescaped.trim();
  const looksLikeCli =
    /^(?:sudo\s+)?(?:kubectl|git|npm|npx|yarn|pnpm|python|python3|node|curl|wget|docker|podman|rm|bash|sh|zsh)\b/i.test(trimmed)
    && trimmed.length <= 160;
  const looksLikeSurfaceToken =
    words.length <= 8
    && /(?:send_message|send_draft|messages\/send|sendmail|force-push|git\s+push\s+(?:-f|--force))/i.test(trimmed);
  if (looksLikeCli || looksLikeSurfaceToken) return false;
  return true;
}



/**
 * A gate that cannot match the very context that produced it is inert — it
 * shows up in the dashboard as an active blocking rule while enforcing nothing.
 * That failure mode is worse than no gate at all, so callers drop these.
 */
function gateMatchesOwnContext(gate, context) {
  if (!gate || !gate.pattern) return false;
  try {
    return new RegExp(gate.pattern).test(String(context || ''));
  } catch {
    return false;
  }
}

const GATE_PROMPT = 'Saved as a lesson, but nothing can enforce it yet. Reply with the tool and the condition to check, '
  + 'for example "Bash: npm publish" or "retried a denied action without my yes".';

/** A question for the person when negative feedback is prose only, or null when a check can be built from it. */
function gatePromptFor(entry) {
  const text = [entry && entry.context, entry && entry.whatWentWrong, entry && entry.whatToChange].filter(Boolean).join('\n');
  if (repeatAfterDeny.conditionFor(text) || deriveSurfacePattern(text)) return null;
  const executable = extractExecutableAction(entry);
  return executable && !isInertProsePattern(contextToPattern(executable)) ? null : GATE_PROMPT;
}

// Feedback that names a condition we can check becomes a condition gate, not a text pattern.
function checkableCondition(g) {
  const texts = [g.latestContext, ...(g.entries || []).flatMap((e) => [e && e.context, e && e.whatWentWrong])];
  return texts.map(repeatAfterDeny.conditionFor).find(Boolean) || null;
}

function buildConditionRule(g) {
  const project = require('./project-identity').projectForRecord(g);
  const manual = g.count === 'MANUAL';
  return {
    ...project,
    scope: 'project',
    active: project.projectKey !== 'unassigned',
    id: repeatAfterDeny.GATE_ID + '-' + require('./project-identity').hash(project.projectKey).slice(0, 16),
    trigger: 'condition:' + repeatAfterDeny.CONDITION,
    condition: repeatAfterDeny.CONDITION,
    pattern: repeatAfterDeny.NEVER_MATCHES,
    action: 'block',
    message: 'This exact call was already denied in this session. Do not retry it; ask the person and wait for their answer.',
    severity: 'critical',
    occurrences: manual ? 1 : Number(g.count) || 0,
    promotedAt: new Date().toISOString(),
    expiresAt: manual ? null : new Date(Date.now() + getRuleTtlMs()).toISOString(),
    lastFiredAt: null,
    source: g.source || 'auto-promote',
  };
}

function buildGateRule(group, actionOverride) {
  // Tests and callers may pass partial groups; never crash on missing fields.
  const g = group && typeof group === 'object' ? group : {};
  if (checkableCondition(g)) return buildConditionRule(g);
  // Two thumbs-downs from a person on the same command are enough; agent-written entries still need three.
  const blocks = g.count >= BLOCK_THRESHOLD || Number(g.humanCount || 0) >= HUMAN_BLOCK_THRESHOLD;
  const action = actionOverride || (g.count === 'MANUAL' ? g.manualAction || 'block' : (blocks ? 'block' : 'warn'));
  const severity = action === 'block' ? 'critical' : action === 'approve' ? 'high' : 'medium';
  const fromExecutable = (g.latestExecutable
    || extractExecutableAction({ context: g.latestContext })
    || '').slice(0, 120);
  // Prefer real executable text; else a derived surface regex (email send, force-push).
  // NEVER fall back to free-form English prose — that produced permanently inert gates.
  const surfacePattern = g.surfacePattern || deriveSurfacePattern(g.latestContext || g.key || '');
  const pattern = fromExecutable
    ? contextToPattern(fromExecutable)
    : (surfacePattern || null);
  const context = (fromExecutable || g.latestContext || g.key || '').slice(0, 120);
  const kind = String(g.key || '').startsWith('diagnosis:')
    ? 'repeated diagnosis'
    : String(g.key || '').startsWith('constraint:')
      ? 'repeated constraint violation'
      : (fromExecutable ? 'repeated executable action' : 'derived surface guard');

  const occurrencesText = g.count === 'MANUAL' ? 'manual' : `${g.count == null ? 0 : g.count} occurrences`;
  const suggestedMessage = `Auto-promoted ${kind}: "${context}" (${occurrencesText} in ${WINDOW_DAYS} days)`;

  // TTL: auto-promoted rules expire after the configured window unless
  // refreshed by a fresh fire. Manual force-promote bypasses TTL — operator
  // says "permanent" by going through the force path.
  const nowMs = Date.now();
  const isManual = g.count === 'MANUAL';
  const expiresAt = isManual ? null : new Date(nowMs + getRuleTtlMs()).toISOString();

  return {
    ...require('./project-identity').projectForRecord(g),
    scope: 'project',
    active: require('./project-identity').projectForRecord(g).projectKey !== 'unassigned',
    id: patternToGateId(String(g.key || 'unknown')) + '-' + require('./project-identity').hash(require('./project-identity').projectForRecord(g).projectKey).slice(0, 16),
    trigger: `auto:${g.key || 'unknown'}`,
    // Derived from executable action OR known surface class — never raw prose.
    pattern,
    action,
    message: suggestedMessage,
    severity,
    // Always numeric — string 'MANUAL' concatenated into gate-stats totals (0MANUAL…).
    occurrences: g.count === 'MANUAL' ? 1 : Number(g.count) || 0,
    promotedAt: new Date().toISOString(),
    expiresAt,
    lastFiredAt: null,
    source: g.source || 'auto-promote',
    // Two thumbs-downs from a person on one command is the person's own "never again": deny it, not just warn.
    ...(action === 'block' && Number(g.humanCount || 0) >= HUMAN_BLOCK_THRESHOLD ? { hardDeny: true } : {}),
    ...(surfacePattern && !fromExecutable ? { surfaceDerived: true } : {}),
  };
}

/**
 * Drop expired gates from the data and return the gates removed.
 *
 * A gate is expired when its `expiresAt` is in the past AND its
 * `lastFiredAt` (if set) is also outside the TTL window — high-signal
 * gates that keep firing get continuously renewed and never expire.
 *
 * `expiresAt: null` is treated as "permanent" (used by force-promote /
 * legacy gates without TTL data).
 */
function expireGates(data, now = Date.now()) {
  const safeData = data && typeof data === 'object'
    ? { version: data.version || 1, gates: Array.isArray(data.gates) ? data.gates : [], promotionLog: Array.isArray(data.promotionLog) ? data.promotionLog : [] }
    : { version: 1, gates: [], promotionLog: [] };
  const ttlMs = getRuleTtlMs();
  const kept = [];
  const expired = [];
  for (const gate of safeData.gates) {
    if (!gate || typeof gate !== 'object') continue;
    // No expiresAt → treat as permanent (manual force-promote, legacy gates).
    if (gate.expiresAt == null) {
      kept.push(gate);
      continue;
    }
    const expiresMs = Date.parse(gate.expiresAt);
    if (!Number.isFinite(expiresMs)) {
      kept.push(gate);
      continue;
    }
    // If last fire is within TTL window, refresh the gate (extend expiresAt).
    const lastFiredMs = gate.lastFiredAt ? Date.parse(gate.lastFiredAt) : NaN;
    if (Number.isFinite(lastFiredMs) && now - lastFiredMs < ttlMs) {
      kept.push({ ...gate, expiresAt: new Date(lastFiredMs + ttlMs).toISOString() });
      continue;
    }
    if (now < expiresMs) {
      kept.push(gate);
    } else {
      expired.push({ id: gate.id, expiresAt: gate.expiresAt, lastFiredAt: gate.lastFiredAt });
    }
  }
  safeData.gates = kept;
  if (expired.length > 0) {
    safeData.promotionLog.push(
      ...expired.map((e) => ({ type: 'expired', gateId: e.id, expiredAt: e.expiresAt, timestamp: new Date(now).toISOString() }))
    );
  }
  return { data: safeData, expired };
}

/**
 * Mark a gate as fired now. Refreshes lastFiredAt AND extends expiresAt by
 * the full TTL — a gate that keeps catching repeats sharpens, doesn't
 * decay. Caller passes the gate ID; returns the updated gate (or null).
 */
function recordGateFire(data, gateId, now = Date.now()) {
  if (!data || !Array.isArray(data.gates)) return null;
  const idx = data.gates.findIndex((g) => g && g.id === gateId);
  if (idx === -1) return null;
  const gate = data.gates[idx];
  const lastFiredAtIso = new Date(now).toISOString();
  const updated = {
    ...gate,
    lastFiredAt: lastFiredAtIso,
    expiresAt: gate.expiresAt == null ? null : new Date(now + getRuleTtlMs()).toISOString(),
  };
  data.gates[idx] = updated;
  return updated;
}

function forcePromote(context, action = 'block', options = {}) {
  if (!context) throw new Error('context is required for force-promote');
  let executable = extractExecutableAction({ context });
  // If extractExecutableAction returned narration that would become inert prose,
  // drop it and fall through to surface derivation (email send, force-push, …).
  if (executable && isInertProsePattern(contextToPattern(executable))) {
    executable = null;
  }
  const surfacePattern = deriveSurfacePattern(context);
  // Prefer a known surface class over a weak "command-shaped" string when both exist
  // and the command is not a known CLI prefix — prevents dual wrong-pattern promotion.
  if (executable && surfacePattern && !/^(?:sudo\s+)?(?:kubectl|git|npm|npx|curl|python|python3|node|bash|sh|zsh|rm)\b/i.test(executable)) {
    executable = null;
  }
  if (!executable && !surfacePattern && !repeatAfterDeny.conditionFor(context)) {
    throw new Error(
      'force-promote refused: context is prose without a matchable tool surface. '
      + 'Pass an executable command (e.g. "git push --force") or describe a known '
      + 'class (email send / Gmail messages/send, force-push, rm -rf /).',
    );
  }

  const data = loadAutoGates(options);
  const project = require('./project-identity').projectForCapture(options, options);
  const gate = buildGateRule({
    ...project,
    key: context,
    latestContext: context,
    latestExecutable: executable || '',
    surfacePattern: surfacePattern || undefined,
    count: 'MANUAL',
    manualAction: action,
    source: 'force-promote',
  });

  if (!gate.pattern || isInertProsePattern(gate.pattern)) {
    throw new Error(
      'force-promote refused: derived pattern is inert prose and would never fire. '
      + `pattern=${JSON.stringify(gate.pattern)}`,
    );
  }

  const gateId = gate.id;
  data.gates = data.gates.filter((existing) => existing.id !== gateId || existing.projectKey !== project.projectKey);
  data.gates.unshift(gate);

  const keepLimit = autoGateLimit(options);
  if (data.gates.length > keepLimit) {
    data.gates = data.gates.slice(0, keepLimit);
  }

  data.promotionLog = data.promotionLog || [];
  data.promotionLog.push({
    gateId,
    context,
    action,
    pattern: gate.pattern,
    surfaceDerived: Boolean(gate.surfaceDerived),
    promotedAt: new Date().toISOString(),
    source: 'force-promote',
  });

  saveAutoGates(data, options);
  return {
    gateId,
    action,
    pattern: gate.pattern,
    surfaceDerived: Boolean(gate.surfaceDerived),
    totalGates: data.gates.length,
  };
}

function promote(feedbackLogPath, options) {
  const opts = { ...(options || {}), ...(feedbackLogPath ? { feedbackDir: path.dirname(feedbackLogPath) } : {}) };
  const logPath = feedbackLogPath || getFeedbackLogPath();
  const entries = readJSONL(logPath);
  const groups = groupNegativeFeedback(entries, WINDOW_DAYS);
  // Expire stale gates BEFORE running the promotion loop so an expiring
  // gate that's about to be re-promoted gets a fresh TTL via the normal
  // path rather than carrying a near-stale expiresAt.
  const { data: expiredData, expired } = expireGates(loadAutoGates(opts));
  const data = expiredData;
  // Drop permanently inert prose gates left by older force-promote / promotion bugs.
  const inertRemoved = [];
  data.gates = (data.gates || []).filter((g) => {
    if (g && !g.condition && isInertProsePattern(g.pattern)) {
      inertRemoved.push(g);
      return false;
    }
    return true;
  });
  if (expired.length > 0 || inertRemoved.length > 0) {
    saveAutoGates(data, opts);
  }
  const promotions = [
    ...expired.map((e) => ({ type: 'expired', gateId: e.id, expiredAt: e.expiresAt })),
    ...inertRemoved.map((e) => ({ type: 'quarantined-inert-prose', gateId: e.id, pattern: e.pattern })),
  ];

  let upgradeLine;
  for (const group of Object.values(groups)) {
    if (group.count < WARN_THRESHOLD) continue;

    const gateId = buildGateRule(group).id;

    // Contexts that produced this gate. Their prior "allow" decisions are the
    // incident the operator thumbs-downed, not false positives — both the
    // new-gate and the warn->block upgrade path must exclude them from the
    // regression check, or every gate learned from a real failure is held at warn.
    const incidentContexts = [
      group.latestContext,
      ...(group.entries || []).map((e) => e && (e.context || e.whatWentWrong)),
    ].filter(Boolean);
    const regressionOpts = { ...opts, auditTrailPath: opts.auditTrailPath || path.join(path.dirname(logPath), 'audit-trail.jsonl'), incidentContexts };

    // Check for existing gate — possibly upgrade
    const existingIdx = data.gates.findIndex((g) => g.id === gateId);
    if (existingIdx !== -1) {
      const existing = data.gates[existingIdx];
      const newAction = (group.count >= BLOCK_THRESHOLD || Number(group.humanCount || 0) >= HUMAN_BLOCK_THRESHOLD) ? 'block' : 'warn';
      if (existing.action !== newAction && newAction === 'block') {
        // Self-Harness stage 3: regression-test before upgrading warn -> block.
        const regression = opts.skipRegression ? null : safeRegressionCheck(buildGateRule(group, 'block'), regressionOpts);
        if (regression && regression.falseBlocks > REGRESSION_FALSE_BLOCK_LIMIT) {
          // Would block prior safe actions — hold at warn instead of upgrading.
          promotions.push({ type: 'upgrade-quarantined', gateId, from: existing.action, occurrences: group.count, falseBlocks: regression.falseBlocks });
        } else {
          // Upgrade from warn to block
          data.gates[existingIdx] = {
            ...existing,
            action: 'block',
            severity: 'critical',
            occurrences: group.count,
            upgradedAt: new Date().toISOString(),
            ...(Number(group.humanCount || 0) >= HUMAN_BLOCK_THRESHOLD ? { hardDeny: true } : {}),
          };
          promotions.push({ type: 'upgrade', gateId, from: existing.action, to: 'block', occurrences: group.count });
        }
      }
      // Update occurrence count even if no action change
      data.gates[existingIdx].occurrences = group.count;
      data.gates[existingIdx].incidentContexts = keepIncidentContexts(incidentContexts);
      // The deny text quotes the count; keep it in step so a block does not say "1 occurrences".
      if (String(data.gates[existingIdx].message || '').startsWith('Auto-promoted ')) {
        data.gates[existingIdx].message = buildGateRule(group, data.gates[existingIdx].action).message;
      }
      continue;
    }

    // New gate — respect explicit gateAction override (e.g. 'approve' for human-approval rules)
    const gate = buildGateRule(group, opts.gateAction);
    // Full incident text (the message truncates it at 120 chars) so a later gate-audit can skip it.
    gate.incidentContexts = keepIncidentContexts(incidentContexts);

    // Never persist a gate that cannot match the context that produced it. Such a
    // gate renders in the dashboard as an active blocking rule while enforcing
    // nothing, which reads as "the agent learned" when it did not.
    // Surface-derived patterns (email send, force-push) intentionally do NOT match
    // the English prose incident text — they match the tool surface instead.
    if (!gate.condition && !gate.surfaceDerived && !gateMatchesOwnContext(gate, group.latestContext)) {
      promotions.push({
        type: 'skipped-unmatchable',
        gateId: gate.id,
        reason: 'derived pattern does not match originating context',
        occurrences: group.count,
      });
      continue;
    }
    if (!gate.condition && (!gate.pattern || isInertProsePattern(gate.pattern))) {
      promotions.push({
        type: 'skipped-inert-prose',
        gateId: gate.id,
        reason: 'pattern is English prose and would never match a tool call',
        occurrences: group.count,
      });
      continue;
    }

    // Self-Harness stage 3: before a feedback rule goes live as a hard block,
    // regression-test it against prior allowed actions. If it would have blocked
    // safe actions, quarantine it to `warn` instead of `block`.
    let regression = null;
    if (gate.action === 'block' && !opts.gateAction && !opts.skipRegression) {
      regression = safeRegressionCheck(gate, regressionOpts);
      if (regression && regression.falseBlocks > REGRESSION_FALSE_BLOCK_LIMIT) {
        gate.action = 'warn';
        gate.severity = 'medium';
        gate.quarantined = true;
        gate.regression = regression;
      } else if (regression) {
        // Keep the audit on a gate that went live too, so "0 false blocks" shows its sample size.
        gate.triggerAudit = { ...regression, auditedAt: new Date().toISOString() };
      }
    }

    // Enforce max limit — rotate oldest
    if (data.gates.length >= autoGateLimit(opts)) {
      const removed = data.gates.shift();
      promotions.push({ type: 'rotated', removedGateId: removed.id });
    }

    data.gates.push(gate);
    promotions.push({
      type: gate.quarantined ? 'new-quarantined' : 'new',
      gateId: gate.id,
      action: gate.action,
      occurrences: group.count,
      ...(gate.quarantined ? { falseBlocks: regression.falseBlocks, allowSampleSize: regression.allowSampleSize } : {}),
      ...(gate.triggerAudit ? { evidence: gate.triggerAudit.evidence, allowSampleSize: gate.triggerAudit.allowSampleSize } : {}),
    });

    // Free tier enforces only the first FREE_TIER_MAX_GATES learned rules (see gates-engine
    // loadGates). A rule past that is stored but not enforced: count it and say so once.
    const rateLimiter = require('./rate-limiter');
    if (data.gates.length > rateLimiter.FREE_TIER_MAX_GATES && !rateLimiter.isProTier()) {
      const line = rateLimiter.capUpgradeLine(group.latestContext || gate.id);
      promotions.push({ type: 'cap-hit', gateId: gate.id, enforced: false, cap: rateLimiter.FREE_TIER_MAX_GATES, activeGates: data.gates.length });
      require('./cap-hit-counter').recordCapHit({ feedbackDir: opts.feedbackDir, cap: rateLimiter.FREE_TIER_MAX_GATES, activeGates: data.gates.length });
      if (line) upgradeLine = line;
    }
  }

  // Log promotions
  for (const p of promotions) {
    data.promotionLog = data.promotionLog || [];
    data.promotionLog.push({ ...p, timestamp: new Date().toISOString() });
  }

  saveAutoGates(data, opts);

  return { promotions, totalGates: data.gates.length, data, ...(upgradeLine ? { upgradeLine } : {}) };
}

function runCli(argv = process.argv.slice(2)) {
  if (argv.includes('--audit')) {
    const rows = auditGateTriggers();
    console.log(argv.includes('--json') ? JSON.stringify(rows, null, 2) : formatTriggerAudit(rows));
    return 0;
  }
  const forceContext = argv.find((arg) => arg.startsWith('--force-block='))?.split('=')[1];
  if (forceContext) {
    const result = forcePromote(forceContext, 'block');
    console.log(`Forced block gate created: ${result.gateId}`);
    console.log(`Total auto-promoted gates: ${result.totalGates}`);
    return 0;
  }

  const logPath = argv[0] && !argv[0].startsWith('--') ? argv[0] : undefined;
  const result = promote(logPath);
  if (result.promotions.length === 0) {
    console.log('No new promotions.');
  } else {
    for (const promotion of result.promotions) {
      if (promotion.type === 'new') {
        const audit = promotion.evidence ? `, trigger audit ${promotion.evidence} on ${promotion.allowSampleSize} allowed actions` : '';
        console.log(`NEW gate: ${promotion.gateId} (${promotion.action}, ${promotion.occurrences} occurrences${audit})`);
      } else if (promotion.type === 'upgrade') {
        console.log(`UPGRADE: ${promotion.gateId} ${promotion.from} -> ${promotion.to} (${promotion.occurrences} occurrences)`);
      } else if (promotion.type === 'rotated') {
        console.log(`ROTATED out: ${promotion.removedGateId}`);
      }
    }
  }
  console.log(`Total auto-promoted gates: ${result.totalGates}`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = runCli();
  } catch (err) {
    console.error('auto-promote-gates error:', err.message);
    process.exit(1);
  }
}

module.exports = {
  promote,
  forcePromote,
  runCli,
  gatePromptFor,
  repeatAfterDeny,
  loadAutoGates,
  saveAutoGates,
  getAutoGatesPath,
  groupNegativeFeedback,
  patternToGateId,
  buildGateRule,
  contextToPattern,
  deriveSurfacePattern,
  isInertProsePattern,
  gateMatchesOwnContext,
  regressionCheck,
  falseFireUpperBound,
  triggerEvidence,
  incidentContextsForGate,
  auditGateTriggers,
  formatTriggerAudit,
  getAuditTrailPath,
  REGRESSION_FALSE_BLOCK_LIMIT,
  extractPatternKey,
  extractExecutableAction,
  normalizeCommandSignature,
  isNegative,
  expireGates,
  recordGateFire,
  getRuleTtlDays,
  getRuleTtlMs,
  MAX_AUTO_GATES,
  autoGateLimit,
  WARN_THRESHOLD,
  BLOCK_THRESHOLD,
  WINDOW_DAYS,
  DEFAULT_RULE_TTL_DAYS,
};
